import { internalMutation, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { householdQuery, requireActor } from "./lib/session";
import { addDays, localDay, localTime, minutesOf, zonedToMs } from "./lib/time";
import { assigneeOf } from "./lib/jobs";
import { queuePing } from "./lib/notify";
import { DEFAULT_DIGEST_TIME } from "./lib/constants";

/**
 * One quiet evening digest per person instead of a stream of pings. It looks
 * ahead to tomorrow. It doesn't nag about chores that are still undone.
 */

function list(items: string[], max = 2) {
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown} +${items.length - max} more` : shown;
}

async function composeDigest(
  ctx: QueryCtx,
  household: Doc<"households">,
  member: Doc<"members">,
  now: number,
): Promise<string[]> {
  const tz = household.timezone;
  const today = localDay(now, tz);
  const tomorrow = addDays(today, 1);
  const startOfToday = zonedToMs(today, "00:00", tz);
  const lines: string[] = [];

  // Lead with the warm stuff.
  const reactions = await ctx.db
    .query("reactions")
    .withIndex("by_household_at", (q) => q.eq("householdId", household._id).gte("at", startOfToday))
    .collect();
  let thanks = 0;
  for (const r of reactions) {
    if (r.kind !== "thanks") continue;
    if (r.toMemberId === member._id) thanks++;
    else if (r.completionId) {
      const c = await ctx.db.get(r.completionId);
      if (c?.memberId === member._id) thanks++;
    }
  }
  if (thanks) lines.push(`💛 ${thanks} thank-you${thanks > 1 ? "s" : ""} for you today`);

  const events = (
    await ctx.db
      .query("calendarEvents")
      .withIndex("by_household_start", (q) =>
        q
          .eq("householdId", household._id)
          .gte("start", zonedToMs(addDays(tomorrow, -31), "00:00", tz))
          .lt("start", zonedToMs(addDays(tomorrow, 1), "00:00", tz)),
      )
      .collect()
  ).filter((e) => e.startDay <= tomorrow && e.endDay >= tomorrow);
  if (events.length) {
    const titles = events
      .sort((a, b) => a.start - b.start)
      .map((e) => (e.allDay ? e.title : `${e.title} ${localTime(e.start, tz)}`));
    lines.push(`📅 Tomorrow: ${list(titles)}`);
  }

  const jobs = (
    await ctx.db
      .query("jobs")
      .withIndex("by_household", (q) => q.eq("householdId", household._id))
      .collect()
  ).filter((j) => j.archivedAt === undefined && j.nextDue === tomorrow && assigneeOf(j) === member._id);
  if (jobs.length) lines.push(`🧹 Your turn tomorrow: ${list(jobs.map((j) => j.title))}`);

  const toMe = await ctx.db
    .query("requests")
    .withIndex("by_to", (q) => q.eq("toId", member._id))
    .collect();
  const waiting = toMe.filter((r) => r.status === "open");
  if (waiting.length) {
    lines.push(`🙋 ${waiting.length} request${waiting.length > 1 ? "s" : ""} waiting for your answer`);
  }
  const promised = toMe.filter((r) => r.status === "accepted" && r.dueDate === tomorrow);
  if (promised.length) lines.push(`✅ Tomorrow you said you'd: ${list(promised.map((r) => r.title))}`);

  const fromMe = await ctx.db
    .query("requests")
    .withIndex("by_from", (q) => q.eq("fromId", member._id))
    .collect();
  const answered = fromMe.filter(
    (r) => (r.status === "proposed" || r.status === "declined") && r.updatedAt >= startOfToday,
  );
  if (answered.length) lines.push(`💬 Replies to your requests: ${list(answered.map((r) => r.title))}`);

  const notes = (
    await ctx.db
      .query("notes")
      .withIndex("by_household_archived", (q) => q.eq("householdId", household._id).eq("archivedAt", undefined))
      .collect()
  ).filter((n) => n.toId === member._id && n.createdAt >= startOfToday);
  if (notes.length) lines.push(`📝 ${notes.length} note${notes.length > 1 ? "s" : ""} on the fridge for you`);

  return lines;
}

/** "What would tonight's digest say?" - shown in My settings. */
export const preview = householdQuery({
  args: {},
  handler: async (ctx) => {
    const me = requireActor(ctx.s);
    return await composeDigest(ctx, ctx.s.household, me, Date.now());
  },
});

/** Cron, every 15 minutes: send each person's digest once, at their time. */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let sent = 0;
    for (const h of await ctx.db.query("households").collect()) {
      const today = localDay(now, h.timezone);
      const nowMin = minutesOf(localTime(now, h.timezone));
      const members = await ctx.db
        .query("members")
        .withIndex("by_household", (q) => q.eq("householdId", h._id))
        .collect();
      for (const m of members) {
        if (m.removedAt !== undefined || m.lastDigestDay === today) continue;
        const digestTime = m.digestTime === "" ? null : m.digestTime ?? DEFAULT_DIGEST_TIME;
        if (!digestTime) continue;
        const due = minutesOf(digestTime);
        if (nowMin < due || nowMin >= due + 60) continue;
        const hasDevice = await ctx.db
          .query("pushSubscriptions")
          .withIndex("by_member", (q) => q.eq("memberId", m._id))
          .first();
        if (!hasDevice) continue;
        await ctx.db.patch(m._id, { lastDigestDay: today });
        const lines = await composeDigest(ctx, h, m, now);
        if (lines.length === 0) continue;
        await queuePing(ctx, h, m._id, {
          title: "Tomorrow on the fridge",
          body: lines.join("\n"),
          url: "/",
          tag: "digest",
        });
        sent++;
      }
    }
    return sent;
  },
});

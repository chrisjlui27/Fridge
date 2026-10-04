import { v } from "convex/values";
import { fail, householdQuery } from "./lib/session";
import { isDay, zonedToMs } from "./lib/time";
import { assigneeOf } from "./lib/jobs";

/**
 * What matters today: jobs due (and done), and requests due. The client
 * passes its idea of "today" (household time) so the subscription rolls
 * over at midnight on its own.
 */
export const summary = householdQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    if (!isDay(today)) fail("INVALID", "Bad date.");
    const householdId = ctx.s.household._id;
    const tz = ctx.s.household.timezone;

    const jobs = (
      await ctx.db
        .query("jobs")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect()
    )
      .filter((j) => j.archivedAt === undefined && j.nextDue <= today)
      .sort((a, b) => a.nextDue.localeCompare(b.nextDue))
      .map((j) => ({
        _id: j._id,
        title: j.title,
        emoji: j.emoji,
        assigneeId: assigneeOf(j),
        nextDue: j.nextDue,
        overdue: j.nextDue < today,
      }));

    const startOfToday = zonedToMs(today, "00:00", tz);
    const doneToday = (
      await ctx.db
        .query("completions")
        .withIndex("by_household_at", (q) => q.eq("householdId", householdId).gte("at", startOfToday))
        .collect()
    )
      .filter((c) => c.day === today && c.undoneAt === undefined)
      .map((c) => ({
        completionId: c._id,
        kind: c.kind,
        jobId: c.jobId ?? null,
        title: c.title,
        emoji: c.emoji ?? null,
        memberId: c.memberId,
        at: c.at,
      }));

    const requests = (
      await ctx.db
        .query("requests")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .order("desc")
        .take(300)
    )
      .filter(
        (r) =>
          (r.status === "open" || r.status === "accepted" || r.status === "proposed") &&
          r.dueDate !== undefined &&
          r.dueDate <= today,
      )
      .map((r) => ({
        _id: r._id,
        fromId: r.fromId,
        toId: r.toId,
        title: r.title,
        dueDate: r.dueDate!,
        dueTime: r.dueTime ?? null,
        status: r.status,
      }));

    return { today, jobs, doneToday, requests };
  },
});

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  fail,
  getMemberInHousehold,
  getOwned,
  householdMutation,
  householdQuery,
  requireActor,
} from "./lib/session";
import { localDay } from "./lib/time";

/**
 * Family contributions + specific thanks. No points, no stars, no ranking:
 * what got done is visible, and people thank each other for it.
 */

const THANKS_MAX = 280;

export const feed = householdQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const since = Date.now() - Math.min(days ?? 7, 31) * 86_400_000;
    const householdId = ctx.s.household._id;
    const completions = (
      await ctx.db
        .query("completions")
        .withIndex("by_household_at", (q) => q.eq("householdId", householdId).gt("at", since))
        .order("desc")
        .take(300)
    ).filter((c) => c.undoneAt === undefined);
    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_household_at", (q) => q.eq("householdId", householdId).gt("at", since))
      .collect();
    const thanksFor = new Map<Id<"completions">, { fromId: Id<"members">; text: string; at: number }[]>();
    const shoutouts = [];
    for (const r of reactions) {
      if (r.kind !== "thanks") continue;
      if (r.completionId) {
        const arr = thanksFor.get(r.completionId) ?? [];
        arr.push({ fromId: r.fromId, text: r.text ?? "", at: r.at });
        thanksFor.set(r.completionId, arr);
      } else if (r.toMemberId) {
        shoutouts.push({
          type: "shoutout" as const,
          _id: r._id,
          fromId: r.fromId,
          toId: r.toMemberId,
          text: r.text ?? "",
          at: r.at,
        });
      }
    }
    const items = [
      ...completions.map((c) => ({
        type: "completion" as const,
        _id: c._id,
        memberId: c.memberId,
        kind: c.kind,
        title: c.title,
        emoji: c.emoji ?? null,
        at: c.at,
        day: c.day,
        thanks: (thanksFor.get(c._id) ?? []).sort((a, b) => a.at - b.at),
      })),
      ...shoutouts,
    ].sort((a, b) => b.at - a.at);
    return {
      items,
      weekCount: completions.filter((c) => c.at > Date.now() - 7 * 86_400_000).length,
      helpers: new Set(completions.map((c) => c.memberId)).size,
    };
  },
});

/** Thank someone for a specific thing they did, or for something nobody saw. */
export const thank = householdMutation({
  args: {
    completionId: v.optional(v.id("completions")),
    toMemberId: v.optional(v.id("members")),
    text: v.string(),
  },
  handler: async (ctx, a) => {
    const me = requireActor(ctx.s);
    if ((a.completionId === undefined) === (a.toMemberId === undefined)) {
      fail("INVALID", "Thank one thing or one person.");
    }
    const text = a.text.trim();
    if (!text) fail("INVALID", "Say what you noticed.");
    if (text.length > THANKS_MAX) fail("INVALID", `Keep it under ${THANKS_MAX} characters.`);
    let toId: Id<"members">;
    if (a.completionId) {
      const c = await getOwned(ctx, ctx.s, a.completionId);
      if (c.undoneAt !== undefined) fail("NOT_FOUND", "That was undone.");
      toId = c.memberId;
    } else {
      toId = (await getMemberInHousehold(ctx, ctx.s, a.toMemberId!))._id;
    }
    if (toId === me._id) fail("INVALID", "You can't thank yourself - but nice work!");
    return await ctx.db.insert("reactions", {
      householdId: ctx.s.household._id,
      fromId: me._id,
      kind: "thanks",
      completionId: a.completionId,
      toMemberId: a.completionId ? undefined : toId,
      text,
      at: Date.now(),
    });
  },
});

/** The latest few thanks, for the wall. */
export const recent = householdQuery({
  args: {},
  handler: async (ctx) => {
    const tz = ctx.s.household.timezone;
    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_household_at", (q) =>
        q.eq("householdId", ctx.s.household._id).gt("at", Date.now() - 3 * 86_400_000),
      )
      .order("desc")
      .take(50);
    const out = [];
    for (const r of reactions) {
      if (r.kind !== "thanks") continue;
      let toId = r.toMemberId ?? null;
      let what: string | null = null;
      if (r.completionId) {
        const c = await ctx.db.get(r.completionId);
        if (!c || c.undoneAt !== undefined) continue;
        toId = c.memberId;
        what = c.title;
      }
      out.push({ _id: r._id, fromId: r.fromId, toId, what, text: r.text ?? "", day: localDay(r.at, tz) });
      if (out.length >= 6) break;
    }
    return out;
  },
});

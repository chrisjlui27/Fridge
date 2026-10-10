import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  cleanText,
  fail,
  getOwned,
  householdMutation,
  householdQuery,
  requireActor,
  type SessionInfo,
} from "./lib/session";
import { addDays, localDay, zonedToMs } from "./lib/time";

/**
 * Quick family polls ("Pizza or tacos Friday?"). They live on the door, close
 * on their own, and the result stays up for a day before tidying away.
 */

const SHOW_RESULT_MS = 24 * 60 * 60 * 1000;

const closes = v.union(v.literal("today"), v.literal("tomorrow"), v.literal("3days"), v.literal("week"));

function closedAt(p: Doc<"polls">, now = Date.now()): number | null {
  if (p.closedAt !== undefined) return p.closedAt;
  return p.closesAt <= now ? p.closesAt : null;
}

function canManage(s: SessionInfo, p: Doc<"polls">) {
  return s.isParentAccount || s.viewer?._id === p.authorId;
}

export const active = householdQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const polls = await ctx.db
      .query("polls")
      .withIndex("by_household_archived", (q) =>
        q.eq("householdId", ctx.s.household._id).eq("archivedAt", undefined),
      )
      .collect();
    const out = [];
    for (const p of polls) {
      const ended = closedAt(p, now);
      if (ended !== null && ended < now - SHOW_RESULT_MS) continue;
      const votes = await ctx.db
        .query("pollVotes")
        .withIndex("by_poll", (q) => q.eq("pollId", p._id))
        .collect();
      out.push({
        _id: p._id,
        authorId: p.authorId,
        question: p.question,
        options: p.options.map((o) => ({
          id: o.id,
          text: o.text,
          voters: votes.filter((x) => x.optionId === o.id).map((x) => x.memberId),
        })),
        closesAt: p.closesAt,
        closedAt: p.closedAt ?? null,
        createdAt: p.createdAt,
        myVote: votes.find((x) => x.memberId === ctx.s.viewer?._id)?.optionId ?? null,
        canManage: canManage(ctx.s, p),
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const create = householdMutation({
  args: { question: v.string(), options: v.array(v.string()), closes },
  handler: async (ctx, a) => {
    const me = requireActor(ctx.s);
    const seen = new Set<string>();
    const options: { id: string; text: string }[] = [];
    for (const raw of a.options) {
      const text = raw.trim();
      if (!text) continue;
      if (text.length > 60) fail("INVALID", "Keep each choice under 60 characters.");
      if (seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      options.push({ id: `o${options.length + 1}`, text });
    }
    if (options.length < 2) fail("INVALID", "A poll needs at least two different choices.");
    if (options.length > 6) fail("INVALID", "Six choices at most.");
    const now = Date.now();
    const tz = ctx.s.household.timezone;
    const today = localDay(now, tz);
    const days = { today: 1, tomorrow: 2, "3days": 3, week: 7 }[a.closes];
    return await ctx.db.insert("polls", {
      householdId: ctx.s.household._id,
      authorId: me._id,
      question: cleanText(a.question, 140, "Question"),
      options,
      closesAt: zonedToMs(addDays(today, days), "00:00", tz),
      createdAt: now,
    });
  },
});

/** One vote per person; voting again changes it. */
export const vote = householdMutation({
  args: { pollId: v.id("polls"), optionId: v.string() },
  handler: async (ctx, { pollId, optionId }) => {
    const me = requireActor(ctx.s);
    const p = await getPoll(ctx, ctx.s, pollId);
    if (closedAt(p) !== null) fail("CLOSED", "This poll has closed.");
    if (!p.options.some((o) => o.id === optionId)) fail("INVALID", "That's not one of the choices.");
    const mine = (
      await ctx.db
        .query("pollVotes")
        .withIndex("by_poll", (q) => q.eq("pollId", pollId))
        .collect()
    ).find((x) => x.memberId === me._id);
    if (mine) await ctx.db.patch(mine._id, { optionId, at: Date.now() });
    else {
      await ctx.db.insert("pollVotes", {
        householdId: ctx.s.household._id,
        pollId,
        memberId: me._id,
        optionId,
        at: Date.now(),
      });
    }
    return null;
  },
});

export const close = householdMutation({
  args: { pollId: v.id("polls") },
  handler: async (ctx, { pollId }) => {
    requireActor(ctx.s);
    const p = await getPoll(ctx, ctx.s, pollId);
    if (!canManage(ctx.s, p)) fail("NOT_ALLOWED", "Only whoever asked (or a parent) can close it.");
    if (closedAt(p) === null) await ctx.db.patch(pollId, { closedAt: Date.now() });
    return null;
  },
});

export const remove = householdMutation({
  args: { pollId: v.id("polls") },
  handler: async (ctx, { pollId }) => {
    requireActor(ctx.s);
    const p = await getPoll(ctx, ctx.s, pollId);
    if (!canManage(ctx.s, p)) fail("NOT_ALLOWED", "Only whoever asked (or a parent) can take it down.");
    await ctx.db.patch(pollId, { archivedAt: Date.now() });
    return null;
  },
});

async function getPoll(ctx: Parameters<typeof getOwned>[0], s: SessionInfo, pollId: Id<"polls">) {
  const p = await ctx.db.get(pollId);
  if (!p || p.householdId !== s.household._id || p.archivedAt !== undefined) {
    fail("NOT_FOUND", "That poll is gone.");
  }
  return p;
}

/** Cron: tidy away polls a day after they close. */
export const archiveOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let n = 0;
    for (const p of await ctx.db.query("polls").collect()) {
      if (p.archivedAt !== undefined) continue;
      const ended = closedAt(p, now);
      if (ended !== null && ended < now - SHOW_RESULT_MS) {
        await ctx.db.patch(p._id, { archivedAt: now });
        n++;
      }
    }
    return n;
  },
});

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { schedule as scheduleValidator } from "./schema";
import {
  cleanText,
  fail,
  getMemberInHousehold,
  getOwned,
  householdMutation,
  householdQuery,
  requireActor,
  type SessionInfo,
} from "./lib/session";
import { byKey, keyAtEnd } from "./lib/order";
import { addDays, isDay, localDay } from "./lib/time";
import type { MutationCtx } from "./_generated/server";
import { alignDue, assigneeOf, checkSchedule, nextDueAfterDone } from "./lib/jobs";

/**
 * Recurring family jobs. Grown-ups are in the rotation under the same rules.
 * Each completion is logged as its own row.
 */

const UNDO_WINDOW_MS = 10 * 60 * 1000;

async function checkRotation(ctx: MutationCtx, s: SessionInfo, rotation: Id<"members">[]) {
  if (rotation.length === 0) fail("INVALID", "Pick at least one person for the rotation.");
  if (new Set(rotation).size !== rotation.length) fail("INVALID", "Someone is in the rotation twice.");
  for (const id of rotation) await getMemberInHousehold(ctx, s, id);
}

function canManage(s: SessionInfo, job: Doc<"jobs">) {
  return s.isParentAccount || s.viewer?._id === job.createdBy;
}

export const list = householdQuery({
  args: {},
  handler: async (ctx) => {
    const jobs = (
      await ctx.db
        .query("jobs")
        .withIndex("by_household", (q) => q.eq("householdId", ctx.s.household._id))
        .collect()
    ).filter((j) => j.archivedAt === undefined);
    const out = [];
    for (const j of jobs) {
      const last = (
        await ctx.db
          .query("completions")
          .withIndex("by_job", (q) => q.eq("jobId", j._id))
          .order("desc")
          .take(5)
      ).find((c) => c.undoneAt === undefined);
      out.push({
        _id: j._id,
        title: j.title,
        emoji: j.emoji,
        rotation: j.rotation,
        turn: j.turn,
        assigneeId: assigneeOf(j),
        schedule: j.schedule,
        nextDue: j.nextDue,
        notes: j.notes ?? null,
        sortKey: j.sortKey,
        lastDone: last ? { memberId: last.memberId, at: last.at, completionId: last._id } : null,
        canManage: canManage(ctx.s, j),
      });
    }
    return out.sort((a, b) => a.nextDue.localeCompare(b.nextDue) || byKey(a, b));
  },
});

export const create = householdMutation({
  args: {
    title: v.string(),
    emoji: v.string(),
    rotation: v.array(v.id("members")),
    schedule: scheduleValidator,
    firstDue: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const me = requireActor(ctx.s);
    await checkRotation(ctx, ctx.s, a.rotation);
    const schedule = checkSchedule(a.schedule);
    if (!isDay(a.firstDue)) fail("INVALID", "Pick a first day.");
    const jobs = (
      await ctx.db
        .query("jobs")
        .withIndex("by_household", (q) => q.eq("householdId", ctx.s.household._id))
        .collect()
    ).sort(byKey);
    return await ctx.db.insert("jobs", {
      householdId: ctx.s.household._id,
      title: cleanText(a.title, 60, "Job name"),
      emoji: a.emoji || "🧹",
      rotation: a.rotation,
      turn: 0,
      schedule,
      nextDue: alignDue(a.firstDue, schedule),
      notes: a.notes?.trim().slice(0, 280) || undefined,
      sortKey: keyAtEnd(jobs),
      createdBy: me._id,
      createdAt: Date.now(),
    });
  },
});

export const update = householdMutation({
  args: {
    jobId: v.id("jobs"),
    title: v.optional(v.string()),
    emoji: v.optional(v.string()),
    rotation: v.optional(v.array(v.id("members"))),
    schedule: v.optional(scheduleValidator),
    nextDue: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    requireActor(ctx.s);
    const job = await getOwned(ctx, ctx.s, a.jobId);
    if (!canManage(ctx.s, job)) fail("NOT_ALLOWED", "Only whoever set this job up, or a parent, can change it.");
    const patch: Partial<Doc<"jobs">> = {};
    if (a.title !== undefined) patch.title = cleanText(a.title, 60, "Job name");
    if (a.emoji) patch.emoji = a.emoji;
    if (a.notes !== undefined) patch.notes = a.notes.trim().slice(0, 280) || undefined;
    if (a.rotation) {
      await checkRotation(ctx, ctx.s, a.rotation);
      // Keep whoever's turn it is, if they're still in the rotation.
      const current = assigneeOf(job);
      const idx = current ? a.rotation.indexOf(current) : -1;
      patch.rotation = a.rotation;
      patch.turn = idx >= 0 ? idx : 0;
    }
    const schedule = a.schedule ? checkSchedule(a.schedule) : job.schedule;
    if (a.schedule) patch.schedule = schedule;
    if (a.nextDue !== undefined) {
      if (!isDay(a.nextDue)) fail("INVALID", "That date doesn't look right.");
      patch.nextDue = alignDue(a.nextDue, schedule);
    } else if (a.schedule) {
      patch.nextDue = alignDue(job.nextDue, schedule);
    }
    await ctx.db.patch(job._id, patch);
    return null;
  },
});

export const archive = householdMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    requireActor(ctx.s);
    const job = await getOwned(ctx, ctx.s, jobId);
    if (!canManage(ctx.s, job)) fail("NOT_ALLOWED", "Only whoever set this job up, or a parent, can remove it.");
    await ctx.db.patch(jobId, { archivedAt: Date.now() });
    return null;
  },
});

/** Done! Credit goes to whoever did it; the rotation moves on. */
export const complete = householdMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const me = requireActor(ctx.s);
    const job = await getOwned(ctx, ctx.s, jobId);
    if (job.archivedAt !== undefined) fail("NOT_FOUND", "That job was removed.");
    const now = Date.now();
    const today = localDay(now, ctx.s.household.timezone);
    const completionId = await ctx.db.insert("completions", {
      householdId: ctx.s.household._id,
      memberId: me._id,
      kind: "job",
      jobId,
      title: job.title,
      emoji: job.emoji,
      at: now,
      day: today,
      prevTurn: job.turn,
      prevDue: job.nextDue,
    });
    await ctx.db.patch(jobId, {
      turn: job.rotation.length ? (job.turn + 1) % job.rotation.length : 0,
      nextDue: nextDueAfterDone(job, today),
    });
    return completionId;
  },
});

/** Undo a mis-tap within 10 minutes, as long as nothing happened since. */
export const undo = householdMutation({
  args: { completionId: v.id("completions") },
  handler: async (ctx, { completionId }) => {
    const me = requireActor(ctx.s);
    const c = await getOwned(ctx, ctx.s, completionId);
    if (c.kind !== "job" || !c.jobId) fail("INVALID", "Only jobs can be undone here.");
    if (c.undoneAt !== undefined) return null;
    if (c.memberId !== me._id && !ctx.s.isParentAccount) fail("NOT_ALLOWED", "Only whoever ticked it can undo it.");
    if (Date.now() - c.at > UNDO_WINDOW_MS) fail("INVALID", "It's too late to undo that one.");
    const latest = (
      await ctx.db
        .query("completions")
        .withIndex("by_job", (q) => q.eq("jobId", c.jobId))
        .order("desc")
        .take(5)
    ).find((x) => x.undoneAt === undefined);
    if (latest?._id !== c._id) fail("INVALID", "Someone has done it again since.");
    const job = await ctx.db.get(c.jobId);
    if (job && c.prevTurn !== undefined && c.prevDue !== undefined) {
      await ctx.db.patch(job._id, { turn: c.prevTurn, nextDue: c.prevDue });
    }
    await ctx.db.patch(c._id, { undoneAt: Date.now() });
    return null;
  },
});

/** "Not today": push it to tomorrow. Plans break; that's fine. */
export const snooze = householdMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const me = requireActor(ctx.s);
    const job = await getOwned(ctx, ctx.s, jobId);
    if (assigneeOf(job) !== me._id && !ctx.s.isParentAccount) {
      fail("NOT_ALLOWED", "Only the person whose turn it is can push it back.");
    }
    const today = localDay(Date.now(), ctx.s.household.timezone);
    const from = job.nextDue > today ? job.nextDue : today;
    await ctx.db.patch(jobId, { nextDue: addDays(from, 1) });
    return null;
  },
});

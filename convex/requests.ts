import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  cleanText,
  fail,
  getMemberInHousehold,
  getOwned,
  householdMutation,
  householdQuery,
  requireActor,
} from "./lib/session";
import { isDay, isTime, localDay } from "./lib/time";
import { queuePing } from "./lib/notify";

/**
 * Requests, not assignments: the person asked can accept, propose another
 * time, or say "can't". A request isn't proof anyone agreed to it.
 */

const ACTIVE = new Set<Doc<"requests">["status"]>(["open", "accepted", "proposed"]);

function checkWhen(date?: string, time?: string) {
  if (date !== undefined && !isDay(date)) fail("INVALID", "That date doesn't look right.");
  if (time !== undefined) {
    if (!isTime(time)) fail("INVALID", "Times look like 16:30.");
    if (date === undefined) fail("INVALID", "Pick a day to go with the time.");
  }
}

function shape(r: Doc<"requests">) {
  return {
    _id: r._id,
    fromId: r.fromId,
    toId: r.toId,
    title: r.title,
    details: r.details ?? null,
    dueDate: r.dueDate ?? null,
    dueTime: r.dueTime ?? null,
    urgent: r.urgent,
    status: r.status,
    reply: r.reply ?? null,
    proposedDate: r.proposedDate ?? null,
    proposedTime: r.proposedTime ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    doneAt: r.doneAt ?? null,
  };
}

export type RequestView = ReturnType<typeof shape>;

function describeDue(date?: string, time?: string) {
  if (!date) return "";
  return time ? ` (${date} ${time})` : ` (${date})`;
}

export const create = householdMutation({
  args: {
    toId: v.id("members"),
    title: v.string(),
    details: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    dueTime: v.optional(v.string()),
    urgent: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const me = requireActor(ctx.s);
    const to = await getMemberInHousehold(ctx, ctx.s, a.toId);
    if (to._id === me._id) fail("INVALID", "Requests go to someone else. For yourself, use My space.");
    checkWhen(a.dueDate, a.dueTime);
    const now = Date.now();
    const title = cleanText(a.title, 120, "Request");
    const id = await ctx.db.insert("requests", {
      householdId: ctx.s.household._id,
      fromId: me._id,
      toId: to._id,
      title,
      details: a.details?.trim().slice(0, 500) || undefined,
      dueDate: a.dueDate,
      dueTime: a.dueTime,
      urgent: a.urgent ?? false,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    const today = localDay(now, ctx.s.household.timezone);
    // Only time-critical asks ping; everything else waits for the evening digest.
    if (a.urgent || (a.dueDate !== undefined && a.dueDate <= today)) {
      await queuePing(ctx, ctx.s.household, to._id, {
        title: `${me.name} asked you`,
        body: title + describeDue(a.dueDate, a.dueTime),
        url: "/jobs",
        tag: `request-${id}`,
      });
    }
    return id;
  },
});

export const respond = householdMutation({
  args: {
    requestId: v.id("requests"),
    response: v.union(v.literal("accept"), v.literal("propose"), v.literal("decline")),
    proposedDate: v.optional(v.string()),
    proposedTime: v.optional(v.string()),
    reply: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const me = requireActor(ctx.s);
    const r = await getOwned(ctx, ctx.s, a.requestId);
    if (r.toId !== me._id) fail("NOT_ALLOWED", "Only the person asked can answer this.");
    if (!ACTIVE.has(r.status) && r.status !== "declined") {
      fail("INVALID", "This request is already finished.");
    }
    const reply = a.reply?.trim().slice(0, 280) || undefined;
    const now = Date.now();
    if (a.response === "accept") {
      await ctx.db.patch(r._id, {
        status: "accepted",
        reply,
        proposedDate: undefined,
        proposedTime: undefined,
        updatedAt: now,
      });
    } else if (a.response === "propose") {
      if (!a.proposedDate) fail("INVALID", "Pick a day that works instead.");
      checkWhen(a.proposedDate, a.proposedTime);
      await ctx.db.patch(r._id, {
        status: "proposed",
        reply,
        proposedDate: a.proposedDate,
        proposedTime: a.proposedTime,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(r._id, {
        status: "declined",
        reply,
        proposedDate: undefined,
        proposedTime: undefined,
        updatedAt: now,
      });
    }
    // The asker only gets a ping if their plan for today just changed.
    const today = localDay(now, ctx.s.household.timezone);
    const dueSoon = r.urgent || (r.dueDate !== undefined && r.dueDate <= today);
    if (a.response !== "accept" && dueSoon) {
      await queuePing(ctx, ctx.s.household, r.fromId, {
        title: a.response === "decline" ? `${me.name} can't` : `${me.name} suggested another time`,
        body: r.title + (reply ? ` - "${reply}"` : ""),
        url: "/jobs",
        tag: `request-${r._id}`,
      });
    }
    return null;
  },
});

/** The asker agrees to the other time that was proposed. */
export const acceptProposal = householdMutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const me = requireActor(ctx.s);
    const r = await getOwned(ctx, ctx.s, requestId);
    if (r.fromId !== me._id) fail("NOT_ALLOWED", "Only the person who asked can agree to the new time.");
    if (r.status !== "proposed") fail("INVALID", "There's no new time to agree to.");
    await ctx.db.patch(r._id, {
      status: "accepted",
      dueDate: r.proposedDate,
      dueTime: r.proposedTime,
      proposedDate: undefined,
      proposedTime: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const withdraw = householdMutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const me = requireActor(ctx.s);
    const r = await getOwned(ctx, ctx.s, requestId);
    if (r.fromId !== me._id) fail("NOT_ALLOWED", "Only the person who asked can withdraw it.");
    if (r.status === "done") fail("INVALID", "It's already done.");
    await ctx.db.patch(r._id, { status: "withdrawn", updatedAt: Date.now() });
    return null;
  },
});

export const complete = householdMutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const me = requireActor(ctx.s);
    const r = await getOwned(ctx, ctx.s, requestId);
    if (r.toId !== me._id) fail("NOT_ALLOWED", "Only the person asked can mark it done.");
    if (r.status === "done" || r.status === "withdrawn") fail("INVALID", "This request is already finished.");
    const now = Date.now();
    await ctx.db.patch(r._id, { status: "done", doneAt: now, updatedAt: now });
    return await ctx.db.insert("completions", {
      householdId: ctx.s.household._id,
      memberId: me._id,
      kind: "request",
      requestId: r._id,
      title: r.title,
      at: now,
      day: localDay(now, ctx.s.household.timezone),
    });
  },
});

/** Requests involving me: things asked of me, and things I asked for. */
export const mine = householdQuery({
  args: {},
  handler: async (ctx) => {
    const me = requireActor(ctx.s);
    const recent = Date.now() - 2 * 86_400_000;
    const keep = (r: Doc<"requests">) => ACTIVE.has(r.status) || r.updatedAt > recent;
    const toMe = (
      await ctx.db
        .query("requests")
        .withIndex("by_to", (q) => q.eq("toId", me._id))
        .collect()
    ).filter(keep);
    const fromMe = (
      await ctx.db
        .query("requests")
        .withIndex("by_from", (q) => q.eq("fromId", me._id))
        .collect()
    ).filter(keep);
    const order = (a: Doc<"requests">, b: Doc<"requests">) =>
      Number(!ACTIVE.has(a.status)) - Number(!ACTIVE.has(b.status)) ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      b.createdAt - a.createdAt;
    return { toMe: toMe.sort(order).map(shape), fromMe: fromMe.sort(order).map(shape) };
  },
});

/** Everyone's open requests, for the wall and the family overview. */
export const active = householdQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db
      .query("requests")
      .withIndex("by_household", (q) => q.eq("householdId", ctx.s.household._id))
      .order("desc")
      .take(300);
    return all
      .filter((r) => ACTIVE.has(r.status))
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
      .map(shape);
  },
});

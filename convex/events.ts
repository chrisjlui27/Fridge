import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { repeatRule } from "./schema";
import {
  cleanText,
  fail,
  getMemberInHousehold,
  householdMutation,
  requireActor,
  type SessionInfo,
} from "./lib/session";
import { daysBetween, isDay, isTime } from "./lib/time";
import { checkRepeat, MAX_SPAN_DAYS, repeatMatches, type Repeat } from "./lib/recur";

/**
 * The family calendar. Anyone can add an event; whoever added it (or a
 * parent) can change or delete it. Repeating events can be changed for one
 * date or for every date.
 */

const fields = {
  title: v.string(),
  allDay: v.boolean(),
  startDay: v.string(),
  endDay: v.optional(v.string()),
  startTime: v.optional(v.string()),
  endTime: v.optional(v.string()),
  location: v.optional(v.string()),
  notes: v.optional(v.string()),
  memberIds: v.array(v.id("members")),
  repeat: v.optional(v.union(repeatRule, v.null())),
};

type Fields = {
  title: string;
  allDay: boolean;
  startDay: string;
  endDay?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  notes?: string;
  memberIds: Id<"members">[];
  repeat?: Repeat | null;
};

async function clean(ctx: MutationCtx, s: SessionInfo, a: Fields) {
  if (!isDay(a.startDay)) fail("INVALID", "Pick a day.");
  let endDay = a.startDay;
  let startTime: string | undefined;
  let endTime: string | undefined;
  if (a.allDay) {
    endDay = a.endDay ?? a.startDay;
    if (!isDay(endDay) || endDay < a.startDay) fail("INVALID", "It can't end before it starts.");
    if (daysBetween(a.startDay, endDay) >= MAX_SPAN_DAYS) fail("INVALID", "Events can last up to a month.");
  } else {
    if (!a.startTime || !isTime(a.startTime)) fail("INVALID", "Pick a start time.");
    startTime = a.startTime;
    if (a.endTime) {
      if (!isTime(a.endTime)) fail("INVALID", "That end time doesn't look right.");
      if (a.endTime <= a.startTime) fail("INVALID", "It has to end after it starts.");
      endTime = a.endTime;
    }
  }
  const memberIds = [...new Set(a.memberIds)];
  for (const id of memberIds) await getMemberInHousehold(ctx, s, id);
  return {
    title: cleanText(a.title, 80, "Event name"),
    allDay: a.allDay,
    startDay: a.startDay,
    endDay,
    startTime,
    endTime,
    location: a.location?.trim().slice(0, 120) || undefined,
    notes: a.notes?.trim().slice(0, 1000) || undefined,
    memberIds,
    repeat: a.repeat ? checkRepeat(a.repeat, a.startDay) : undefined,
  };
}

function canEdit(s: SessionInfo, ev: Doc<"events">) {
  return s.isParentAccount || s.viewer?._id === ev.createdBy;
}

async function editable(ctx: MutationCtx, s: SessionInfo, eventId: Id<"events">) {
  requireActor(s);
  const ev = await ctx.db.get(eventId);
  if (!ev || ev.householdId !== s.household._id) fail("NOT_FOUND", "That event is gone.");
  if (!canEdit(s, ev)) {
    fail("NOT_ALLOWED", "Only whoever added this event, or a parent, can change it.");
  }
  return ev;
}

function isOccurrence(ev: Doc<"events">, day: string | undefined): day is string {
  return (
    !!day && !!ev.repeat && repeatMatches(ev.startDay, ev.repeat, day) && !(ev.skipDays ?? []).includes(day)
  );
}

export const create = householdMutation({
  args: fields,
  handler: async (ctx, a) => {
    const me = requireActor(ctx.s);
    const f = await clean(ctx, ctx.s, a);
    const now = Date.now();
    return await ctx.db.insert("events", {
      householdId: ctx.s.household._id,
      ...f,
      repeats: f.repeat !== undefined,
      createdBy: me._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = householdMutation({
  args: {
    eventId: v.id("events"),
    /** For a repeating event: change just `occurrenceDay`, or every date. */
    scope: v.union(v.literal("one"), v.literal("all")),
    occurrenceDay: v.optional(v.string()),
    ...fields,
  },
  handler: async (ctx, { eventId, scope, occurrenceDay, ...rest }) => {
    const ev = await editable(ctx, ctx.s, eventId);
    const f = await clean(ctx, ctx.s, rest);
    const now = Date.now();
    if (ev.repeats && scope === "one") {
      if (!isOccurrence(ev, occurrenceDay)) fail("INVALID", "That date isn't part of this event.");
      await ctx.db.patch(ev._id, { skipDays: [...(ev.skipDays ?? []), occurrenceDay], updatedAt: now });
      return await ctx.db.insert("events", {
        householdId: ev.householdId,
        ...f,
        repeat: undefined,
        repeats: false,
        seriesId: ev._id,
        occurrenceDay,
        createdBy: ev.createdBy,
        createdAt: now,
        updatedAt: now,
      });
    }
    // A single date split off a series stays a single date.
    const repeat = ev.seriesId ? undefined : f.repeat;
    await ctx.db.patch(ev._id, { ...f, repeat, repeats: repeat !== undefined, updatedAt: now });
    return ev._id;
  },
});

export const remove = householdMutation({
  args: {
    eventId: v.id("events"),
    scope: v.union(v.literal("one"), v.literal("all")),
    occurrenceDay: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, scope, occurrenceDay }) => {
    const ev = await editable(ctx, ctx.s, eventId);
    if (ev.repeats && scope === "one") {
      if (!isOccurrence(ev, occurrenceDay)) fail("INVALID", "That date isn't part of this event.");
      await ctx.db.patch(ev._id, { skipDays: [...(ev.skipDays ?? []), occurrenceDay], updatedAt: Date.now() });
      return null;
    }
    if (ev.repeats) {
      for (const one of await ctx.db
        .query("events")
        .withIndex("by_series", (q) => q.eq("seriesId", ev._id))
        .collect()) {
        await ctx.db.delete(one._id);
      }
    }
    await ctx.db.delete(ev._id);
    return null;
  },
});

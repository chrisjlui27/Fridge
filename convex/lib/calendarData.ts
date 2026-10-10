import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { addDays, daysBetween, zonedToMs } from "./time";
import { MAX_SPAN_DAYS, occurrenceStarts, type Repeat } from "./recur";

/** Events with nobody tagged (or several people) use the family colour. */
export const FAMILY_COLOR = "#c2410c";

export type CalendarItem = {
  _id: string;
  source: "fridge" | "feed";
  title: string;
  location: string | null;
  allDay: boolean;
  start: number;
  end: number;
  startDay: string;
  endDay: string;
  startTime: string | null;
  endTime: string | null;
  color: string;
  feedName: string;
  // Fridge events only:
  eventId: Id<"events"> | null;
  /** The repeating series this date belongs to (the master row). */
  seriesId: Id<"events"> | null;
  occurrenceDay: string | null;
  seriesStartDay: string | null;
  memberIds: Id<"members">[];
  repeat: Repeat | null;
  notes: string | null;
  createdBy: Id<"members"> | null;
};

function instance(
  ev: Doc<"events">,
  day: string,
  tz: string,
  colors: Map<Id<"members">, string>,
): CalendarItem {
  const endDay = addDays(day, daysBetween(ev.startDay, ev.endDay));
  const start = ev.allDay ? zonedToMs(day, "00:00", tz) : zonedToMs(day, ev.startTime ?? "00:00", tz);
  const end = ev.allDay
    ? zonedToMs(addDays(endDay, 1), "00:00", tz)
    : ev.endTime
      ? zonedToMs(day, ev.endTime, tz)
      : start;
  const isSeries = ev.repeats;
  return {
    _id: `${ev._id}:${day}`,
    source: "fridge",
    title: ev.title,
    location: ev.location ?? null,
    allDay: ev.allDay,
    start,
    end,
    startDay: day,
    endDay,
    startTime: ev.allDay ? null : ev.startTime ?? null,
    endTime: ev.allDay ? null : ev.endTime ?? null,
    color: ev.memberIds.length === 1 ? colors.get(ev.memberIds[0]) ?? FAMILY_COLOR : FAMILY_COLOR,
    feedName: "",
    eventId: ev._id,
    seriesId: isSeries ? ev._id : ev.seriesId ?? null,
    occurrenceDay: isSeries ? day : ev.occurrenceDay ?? null,
    seriesStartDay: isSeries ? ev.startDay : null,
    memberIds: ev.memberIds,
    repeat: ev.repeat ?? null,
    notes: ev.notes ?? null,
    createdBy: ev.createdBy,
  };
}

/**
 * Everything on the calendar between two household days (inclusive): the
 * family's own events, repeats expanded, plus any subscribed .ics feeds.
 */
export async function eventsInRange(
  ctx: QueryCtx,
  household: Doc<"households">,
  fromDay: string,
  toDay: string,
): Promise<CalendarItem[]> {
  const tz = household.timezone;
  const householdId = household._id;
  const members = await ctx.db
    .query("members")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .collect();
  const colors = new Map(members.map((m) => [m._id, m.color]));
  const out: CalendarItem[] = [];

  const oneOffs = await ctx.db
    .query("events")
    .withIndex("by_household_start", (q) =>
      q
        .eq("householdId", householdId)
        .eq("repeats", false)
        .gte("startDay", addDays(fromDay, -MAX_SPAN_DAYS))
        .lte("startDay", toDay),
    )
    .collect();
  for (const ev of oneOffs) {
    if (ev.endDay >= fromDay) out.push(instance(ev, ev.startDay, tz, colors));
  }

  const series = await ctx.db
    .query("events")
    .withIndex("by_household_start", (q) =>
      q.eq("householdId", householdId).eq("repeats", true).lte("startDay", toDay),
    )
    .collect();
  for (const ev of series) {
    for (const day of occurrenceStarts(ev, fromDay, toDay)) out.push(instance(ev, day, tz, colors));
  }

  // Subscribed feeds (optional): school or team calendars.
  const lower = zonedToMs(addDays(fromDay, -31), "00:00", tz);
  const upper = zonedToMs(addDays(toDay, 1), "00:00", tz);
  const feedEvents = await ctx.db
    .query("calendarEvents")
    .withIndex("by_household_start", (q) => q.eq("householdId", householdId).gte("start", lower).lt("start", upper))
    .collect();
  if (feedEvents.length) {
    const feeds = new Map(
      (
        await ctx.db
          .query("calendarFeeds")
          .withIndex("by_household", (q) => q.eq("householdId", householdId))
          .collect()
      ).map((f) => [f._id, f]),
    );
    for (const e of feedEvents) {
      if (e.endDay < fromDay || e.startDay > toDay) continue;
      out.push({
        _id: e._id,
        source: "feed",
        title: e.title,
        location: e.location ?? null,
        allDay: e.allDay,
        start: e.start,
        end: e.end,
        startDay: e.startDay,
        endDay: e.endDay,
        startTime: null,
        endTime: null,
        color: feeds.get(e.feedId)?.color ?? "#888",
        feedName: feeds.get(e.feedId)?.name ?? "",
        eventId: null,
        seriesId: null,
        occurrenceDay: null,
        seriesStartDay: null,
        memberIds: [],
        repeat: null,
        notes: null,
        createdBy: null,
      });
    }
  }

  return out.sort((a, b) => a.startDay.localeCompare(b.startDay) || Number(b.allDay) - Number(a.allDay) || a.start - b.start);
}

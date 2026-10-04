import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  cleanText,
  fail,
  getOwned,
  householdMutation,
  householdQuery,
  requireParent,
} from "./lib/session";
import { addDays, daysBetween, isDay, localDay, zonedToMs } from "./lib/time";
import { normalizeFeedUrl, parseIcs } from "./lib/ical";

/**
 * Read-only calendars: the fridge shows the family's existing calendars
 * (and school feeds) but is never the master calendar.
 */

const LOOKBACK_DAYS = 1;
const LOOKAHEAD_DAYS = 45;
const MAX_BYTES = 5_000_000;

function maskUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.length > 24 ? u.pathname.slice(0, 20) + "…" : u.pathname}`;
  } catch {
    return "calendar";
  }
}

export const feeds = householdQuery({
  args: {},
  handler: async (ctx) => {
    requireParent(ctx.s);
    const feeds = await ctx.db
      .query("calendarFeeds")
      .withIndex("by_household", (q) => q.eq("householdId", ctx.s.household._id))
      .collect();
    return feeds.map((f) => ({
      _id: f._id,
      name: f.name,
      color: f.color,
      where: maskUrl(f.url),
      lastFetchedAt: f.lastFetchedAt ?? null,
      lastError: f.lastError ?? null,
      eventCount: f.eventCount ?? null,
    }));
  },
});

export const addFeed = householdMutation({
  args: { name: v.string(), url: v.string(), color: v.string() },
  handler: async (ctx, a) => {
    requireParent(ctx.s);
    const existing = await ctx.db
      .query("calendarFeeds")
      .withIndex("by_household", (q) => q.eq("householdId", ctx.s.household._id))
      .collect();
    if (existing.length >= 12) fail("INVALID", "That's plenty of calendars (12 max).");
    const feedId = await ctx.db.insert("calendarFeeds", {
      householdId: ctx.s.household._id,
      name: cleanText(a.name, 40, "Calendar name"),
      url: normalizeFeedUrl(a.url),
      color: a.color,
    });
    await ctx.scheduler.runAfter(0, internal.calendar.refreshFeed, { feedId });
    return feedId;
  },
});

export const removeFeed = householdMutation({
  args: { feedId: v.id("calendarFeeds") },
  handler: async (ctx, { feedId }) => {
    requireParent(ctx.s);
    await getOwned(ctx, ctx.s, feedId);
    for (const e of await ctx.db
      .query("calendarEvents")
      .withIndex("by_feed", (q) => q.eq("feedId", feedId))
      .collect()) {
      await ctx.db.delete(e._id);
    }
    await ctx.db.delete(feedId);
    return null;
  },
});

export const refreshNow = householdMutation({
  args: { feedId: v.id("calendarFeeds") },
  handler: async (ctx, { feedId }) => {
    requireParent(ctx.s);
    await getOwned(ctx, ctx.s, feedId);
    await ctx.scheduler.runAfter(0, internal.calendar.refreshFeed, { feedId });
    return null;
  },
});

/** Events overlapping [fromDay, toDay] (household days, inclusive). */
export const range = householdQuery({
  args: { fromDay: v.string(), toDay: v.string() },
  handler: async (ctx, { fromDay, toDay }) => {
    if (!isDay(fromDay) || !isDay(toDay) || toDay < fromDay || daysBetween(fromDay, toDay) > 62) {
      fail("INVALID", "Bad date range.");
    }
    const tz = ctx.s.household.timezone;
    const lower = zonedToMs(addDays(fromDay, -31), "00:00", tz);
    const upper = zonedToMs(addDays(toDay, 1), "00:00", tz);
    const events = await ctx.db
      .query("calendarEvents")
      .withIndex("by_household_start", (q) =>
        q.eq("householdId", ctx.s.household._id).gte("start", lower).lt("start", upper),
      )
      .collect();
    const feeds = new Map(
      (
        await ctx.db
          .query("calendarFeeds")
          .withIndex("by_household", (q) => q.eq("householdId", ctx.s.household._id))
          .collect()
      ).map((f) => [f._id, f]),
    );
    return events
      .filter((e) => e.endDay >= fromDay && e.startDay <= toDay)
      .map((e) => ({
        _id: e._id,
        title: e.title,
        location: e.location ?? null,
        allDay: e.allDay,
        start: e.start,
        end: e.end,
        startDay: e.startDay,
        endDay: e.endDay,
        color: feeds.get(e.feedId)?.color ?? "#888",
        feedName: feeds.get(e.feedId)?.name ?? "",
      }))
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
  },
});

// ---------------------------------------------------------------------------
// Fetching (cron every 20 minutes)

export const allFeedIds = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("calendarFeeds").collect()).map((f) => f._id),
});

export const feedForRefresh = internalQuery({
  args: { feedId: v.id("calendarFeeds") },
  handler: async (ctx, { feedId }) => {
    const feed = await ctx.db.get(feedId);
    if (!feed) return null;
    const household = await ctx.db.get(feed.householdId);
    if (!household) return null;
    return { url: feed.url, timezone: household.timezone };
  },
});

export const refreshAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const ids = await ctx.runQuery(internal.calendar.allFeedIds, {});
    for (const feedId of ids) {
      await ctx.runAction(internal.calendar.refreshFeed, { feedId });
    }
  },
});

export const refreshFeed = internalAction({
  args: { feedId: v.id("calendarFeeds") },
  handler: async (ctx, { feedId }) => {
    const feed = await ctx.runQuery(internal.calendar.feedForRefresh, { feedId });
    if (!feed) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      let text: string;
      try {
        const res = await fetch(feed.url, {
          headers: { Accept: "text/calendar, */*" },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`The calendar server said ${res.status}.`);
        text = await res.text();
      } finally {
        clearTimeout(timer);
      }
      if (text.length > MAX_BYTES) throw new Error("That calendar is too big to show.");
      if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That link isn't a calendar feed (.ics).");
      const now = Date.now();
      const today = localDay(now, feed.timezone);
      const from = zonedToMs(addDays(today, -LOOKBACK_DAYS), "00:00", feed.timezone);
      const to = zonedToMs(addDays(today, LOOKAHEAD_DAYS), "00:00", feed.timezone);
      const events = parseIcs(text, feed.timezone, from, to);
      await ctx.runMutation(internal.calendar.saveEvents, { feedId, events });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Keep showing the last good copy; just note what went wrong.
      await ctx.runMutation(internal.calendar.saveError, {
        feedId,
        error: message.includes("abort") ? "The calendar took too long to answer." : message.slice(0, 200),
      });
    }
  },
});

export const saveEvents = internalMutation({
  args: {
    feedId: v.id("calendarFeeds"),
    events: v.array(
      v.object({
        title: v.string(),
        location: v.optional(v.string()),
        allDay: v.boolean(),
        start: v.number(),
        end: v.number(),
        startDay: v.string(),
        endDay: v.string(),
      }),
    ),
  },
  handler: async (ctx, { feedId, events }) => {
    const feed = await ctx.db.get(feedId);
    if (!feed) return;
    for (const e of await ctx.db
      .query("calendarEvents")
      .withIndex("by_feed", (q) => q.eq("feedId", feedId))
      .collect()) {
      await ctx.db.delete(e._id);
    }
    for (const e of events) {
      await ctx.db.insert("calendarEvents", { ...e, householdId: feed.householdId, feedId });
    }
    await ctx.db.patch(feedId, { lastFetchedAt: Date.now(), lastError: undefined, eventCount: events.length });
  },
});

export const saveError = internalMutation({
  args: { feedId: v.id("calendarFeeds"), error: v.string() },
  handler: async (ctx, { feedId, error }) => {
    if (await ctx.db.get(feedId)) await ctx.db.patch(feedId, { lastError: error, lastFetchedAt: Date.now() });
  },
});

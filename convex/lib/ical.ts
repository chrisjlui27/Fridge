import ICAL from "ical.js";
import { addDays, isValidTimeZone, localDay, zonedToMs } from "./time";
import { fail } from "./session";

export type ParsedEvent = {
  title: string;
  location?: string;
  allDay: boolean;
  start: number;
  end: number;
  startDay: string;
  endDay: string; // inclusive
};

type Time = InstanceType<typeof ICAL.Time>;
type Component = InstanceType<typeof ICAL.Component>;

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (t: Time) => `${t.year}-${pad(t.month)}-${pad(t.day)}`;
const hhmmOf = (t: Time) => `${pad(t.hour)}:${pad(t.minute)}`;

function timeToMs(t: Time, floatingTz: string): number {
  const tzid = t.zone?.tzid;
  if (tzid && tzid !== "floating") return t.toUnixTime() * 1000;
  // Floating time, or a TZID the feed didn't define: read it as wall-clock time.
  return zonedToMs(dayOf(t), hhmmOf(t), floatingTz) + t.second * 1000;
}

function cancelled(c: Component): boolean {
  return String(c.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
}

/**
 * Parse an iCalendar feed and expand recurring events that overlap
 * [fromMs, toMs). Read-only: the fridge never writes to calendars.
 */
export function parseIcs(
  text: string,
  householdTz: string,
  fromMs: number,
  toMs: number,
  limit = 1500,
): ParsedEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  const exceptions = new Map<string, Component[]>();
  const masters: Component[] = [];
  for (const ve of root.getAllSubcomponents("vevent")) {
    const uid = String(ve.getFirstPropertyValue("uid") ?? "");
    if (ve.hasProperty("recurrence-id")) {
      const list = exceptions.get(uid) ?? [];
      list.push(ve);
      exceptions.set(uid, list);
    } else {
      masters.push(ve);
    }
  }

  const out: ParsedEvent[] = [];
  const fromDay = localDay(fromMs, householdTz);
  const toDay = localDay(toMs, householdTz);

  for (const ve of masters) {
    if (cancelled(ve)) continue;
    const uid = String(ve.getFirstPropertyValue("uid") ?? "");
    let event: InstanceType<typeof ICAL.Event>;
    try {
      event = new ICAL.Event(ve, { exceptions: exceptions.get(uid) ?? [], strictExceptions: false });
    } catch {
      continue;
    }
    if (!event.startDate) continue;
    const tzParam = ve.getFirstProperty("dtstart")?.getParameter("tzid");
    const eventTz = typeof tzParam === "string" && isValidTimeZone(tzParam) ? tzParam : householdTz;

    const add = (summary: string, location: string, s: Time, e: Time | null) => {
      let start: number, end: number, startDay: string, endDay: string;
      if (s.isDate) {
        startDay = dayOf(s);
        const endExclusive = e ? dayOf(e) : addDays(startDay, 1);
        endDay = endExclusive > startDay ? addDays(endExclusive, -1) : startDay;
        if (endDay < fromDay || startDay > toDay) return;
        start = zonedToMs(startDay, "00:00", householdTz);
        end = zonedToMs(addDays(endDay, 1), "00:00", householdTz);
      } else {
        start = timeToMs(s, eventTz);
        end = e ? Math.max(start, timeToMs(e, eventTz)) : start;
        const overlaps = end > fromMs || (end === start && start >= fromMs);
        if (!overlaps || start >= toMs) return;
        startDay = localDay(start, householdTz);
        endDay = localDay(Math.max(start, end - 1), householdTz);
      }
      out.push({
        title: (summary || "(No title)").slice(0, 200),
        location: location ? location.slice(0, 200) : undefined,
        allDay: s.isDate,
        start,
        end,
        startDay,
        endDay,
      });
    };

    try {
      if (event.isRecurring()) {
        const it = event.iterator();
        let next: Time | null;
        let guard = 0;
        while ((next = it.next()) && guard++ < 50_000) {
          const startsAfterWindow = next.isDate ? dayOf(next) > toDay : timeToMs(next, eventTz) >= toMs;
          if (startsAfterWindow) break;
          const details = event.getOccurrenceDetails(next);
          if (cancelled(details.item.component)) continue;
          add(details.item.summary, details.item.location, details.startDate, details.endDate);
          if (out.length >= limit) return out;
        }
      } else {
        add(event.summary, event.location, event.startDate, event.endDate);
      }
    } catch {
      // One malformed event shouldn't hide the rest of the calendar.
    }
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.start - b.start);
}

export function normalizeFeedUrl(raw: string): string {
  let url = raw.trim();
  if (url.toLowerCase().startsWith("webcal://")) url = "https://" + url.slice("webcal://".length);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail("INVALID", "That doesn't look like a calendar link.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    fail("INVALID", "Calendar links start with https:// or webcal://");
  }
  return parsed.toString();
}

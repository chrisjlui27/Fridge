import { addDays, daysBetween, isDay, weekdayOf } from "./time";
import { fail } from "./session";

export type Repeat = {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  weekdays?: number[];
  until?: string;
};

/** All-day events can span up to a month (camp week, holidays). */
export const MAX_SPAN_DAYS = 31;

const ymd = (day: string) => day.split("-").map(Number) as [number, number, number];
const weekStart = (day: string) => addDays(day, -weekdayOf(day));

/** Does a repeating event that started on `startDay` happen on `day`? */
export function repeatMatches(startDay: string, repeat: Repeat, day: string): boolean {
  if (day < startDay) return false;
  if (repeat.until && day > repeat.until) return false;
  const n = Math.max(1, Math.floor(repeat.interval));
  switch (repeat.freq) {
    case "daily":
      return daysBetween(startDay, day) % n === 0;
    case "weekly": {
      const days = repeat.weekdays?.length ? repeat.weekdays : [weekdayOf(startDay)];
      if (!days.includes(weekdayOf(day))) return false;
      return Math.floor(daysBetween(weekStart(startDay), weekStart(day)) / 7) % n === 0;
    }
    case "monthly": {
      const [y1, m1, d1] = ymd(startDay);
      const [y2, m2, d2] = ymd(day);
      // The 31st only happens in months that have one.
      return d1 === d2 && ((y2 - y1) * 12 + (m2 - m1)) % n === 0;
    }
    case "yearly": {
      const [y1, m1, d1] = ymd(startDay);
      const [y2, m2, d2] = ymd(day);
      return m1 === m2 && d1 === d2 && (y2 - y1) % n === 0;
    }
  }
}

/** Start days of every occurrence whose days overlap [fromDay, toDay]. */
export function occurrenceStarts(
  ev: { startDay: string; endDay: string; repeat?: Repeat | null; skipDays?: string[] },
  fromDay: string,
  toDay: string,
): string[] {
  const span = Math.max(0, daysBetween(ev.startDay, ev.endDay));
  if (!ev.repeat) return ev.startDay <= toDay && ev.endDay >= fromDay ? [ev.startDay] : [];
  const skip = new Set(ev.skipDays ?? []);
  const out: string[] = [];
  let d = addDays(fromDay, -span);
  if (d < ev.startDay) d = ev.startDay;
  for (; d <= toDay; d = addDays(d, 1)) {
    if (!skip.has(d) && repeatMatches(ev.startDay, ev.repeat, d)) out.push(d);
  }
  return out;
}

export function checkRepeat(r: Repeat, startDay: string): Repeat {
  const limits = { daily: 365, weekly: 52, monthly: 24, yearly: 10 } as const;
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > limits[r.freq]) {
    fail("INVALID", `Repeat every 1 to ${limits[r.freq]}.`);
  }
  if (r.until !== undefined) {
    if (!isDay(r.until)) fail("INVALID", "The end date doesn't look right.");
    if (r.until < startDay) fail("INVALID", "It can't stop repeating before it starts.");
  }
  if (r.freq !== "weekly") return { freq: r.freq, interval: r.interval, until: r.until };
  const weekdays = [...new Set(r.weekdays?.length ? r.weekdays : [weekdayOf(startDay)])].sort((a, b) => a - b);
  if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) fail("INVALID", "Pick days of the week.");
  return { freq: "weekly", interval: r.interval, weekdays, until: r.until };
}

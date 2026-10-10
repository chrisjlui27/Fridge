/**
 * Household-time helpers shared by the backend and the web app.
 *
 * Days are "YYYY-MM-DD" strings in the household's time zone; times are
 * "HH:MM" (24h). Everything else is epoch milliseconds.
 */

export type Day = string;

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    const options: Intl.DateTimeFormatOptions = {
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    };
    try {
      f = new Intl.DateTimeFormat("en-US", { ...options, timeZone: tz });
    } catch {
      f = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
    }
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(ms: number, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localDay(ms: number, tz: string): Day {
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function localTime(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function parseDay(day: Day): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

export function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = parseDay(s);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds. */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant a household-local wall-clock time happens. */
export function zonedToMs(day: Day, time: string, tz: string): number {
  const [y, m, d] = parseDay(day);
  const [hh, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mi);
  const off = tzOffsetMs(guess, tz);
  let ms = guess - off;
  const off2 = tzOffsetMs(ms, tz);
  if (off2 !== off) ms = guess - off2;
  return ms;
}

export function addDays(day: Day, n: number): Day {
  const [y, m, d] = parseDay(day);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(day: Day): number {
  const [y, m, d] = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(from: Day, to: Day): number {
  const [y1, m1, d1] = parseDay(from);
  const [y2, m2, d2] = parseDay(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Local midnight at the start of tomorrow. */
export function endOfToday(ms: number, tz: string): number {
  return zonedToMs(addDays(localDay(ms, tz), 1), "00:00", tz);
}

/** Local midnight at the end of Sunday (the start of next Monday). */
export function endOfWeek(ms: number, tz: string): number {
  const today = localDay(ms, tz);
  const wd = weekdayOf(today);
  const untilMonday = wd === 0 ? 1 : 8 - wd;
  return zonedToMs(addDays(today, untilMonday), "00:00", tz);
}

/** Quiet hours may wrap past midnight (e.g. 21:00-07:00). Equal = none. */
export function isQuiet(ms: number, tz: string, start?: string, end?: string): boolean {
  if (!start || !end || start === end) return false;
  const now = minutesOf(localTime(ms, tz));
  const s = minutesOf(start);
  const e = minutesOf(end);
  return s < e ? now >= s && now < e : now >= s || now < e;
}

/** Milliseconds until quiet hours end (0 if not quiet right now). */
export function msUntilQuietEnds(ms: number, tz: string, start?: string, end?: string): number {
  if (!isQuiet(ms, tz, start, end)) return 0;
  const today = localDay(ms, tz);
  let target = zonedToMs(today, end!, tz);
  if (target <= ms) target = zonedToMs(addDays(today, 1), end!, tz);
  return target - ms;
}

/** Next date strictly after `after` that falls on one of `weekdays`. */
export function nextWeekday(after: Day, weekdays: number[]): Day {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(after, i);
    if (weekdays.includes(weekdayOf(d))) return d;
  }
  return addDays(after, 7);
}

/** "15:30" -> "3:30pm", "18:00" -> "6pm" (for notification text). */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
}

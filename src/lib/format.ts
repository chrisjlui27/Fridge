import { useEffect, useState } from "react";
import { addDays, daysBetween, localDay } from "../../convex/lib/time";

export { addDays, localDay };

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatTime(ms: number, tz: string): string {
  let f = timeFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz });
    timeFormatters.set(tz, f);
  }
  return f.format(new Date(ms));
}

/** "16:30" -> "4:30 PM" (locale-aware). */
export function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, 0, 1, h, m)),
  );
}

function dayDate(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function weekdayName(day: string, style: "long" | "short" = "long") {
  return new Intl.DateTimeFormat(undefined, { weekday: style, timeZone: "UTC" }).format(dayDate(day));
}

export function formatDate(day: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(dayDate(day));
}

/** Friendly relative day: Today, Tomorrow, Wednesday, Mon Oct 12. */
export function dayLabel(day: string, today: string): string {
  const diff = daysBetween(today, day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return weekdayName(day);
  return formatDate(day, { weekday: "short", month: "short", day: "numeric" });
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** The household's current day and minute, re-rendering as time passes. */
export function useNow(tz: string, everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return { now, today: localDay(now, tz) };
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const kind = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua)
    ? "Tablet"
    : /iPhone|Android|Mobile/i.test(ua)
      ? "Phone"
      : "Computer";
  const os = /iPhone|iPad|Mac/i.test(ua) ? "Apple" : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : "";
  return [os, kind].filter(Boolean).join(" ");
}

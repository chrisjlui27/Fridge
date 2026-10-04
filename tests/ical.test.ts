import { describe, expect, test } from "vitest";
import { normalizeFeedUrl, parseIcs } from "../convex/lib/ical";
import { localTime, zonedToMs } from "../convex/lib/time";

const TZ = "America/Chicago";

export const SAMPLE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//EN",
  "BEGIN:VTIMEZONE",
  "TZID:America/Chicago",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0500",
  "TZNAME:CDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0600",
  "TZNAME:CST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
  // Weekly practice, Tue + Thu 16:30-18:00, with one moved and one cancelled
  "BEGIN:VEVENT",
  "UID:practice@test",
  "SUMMARY:Volleyball practice",
  "LOCATION:Gym",
  "DTSTART;TZID=America/Chicago:20260901T163000",
  "DTEND;TZID=America/Chicago:20260901T180000",
  "RRULE:FREQ=WEEKLY;BYDAY=TU,TH",
  "EXDATE;TZID=America/Chicago:20261008T163000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:practice@test",
  "RECURRENCE-ID;TZID=America/Chicago:20261006T163000",
  "SUMMARY:Volleyball practice (late)",
  "DTSTART;TZID=America/Chicago:20261006T180000",
  "DTEND;TZID=America/Chicago:20261006T193000",
  "END:VEVENT",
  // All-day, two days (DTEND exclusive)
  "BEGIN:VEVENT",
  "UID:fair@test",
  "SUMMARY:Book fair",
  "DTSTART;VALUE=DATE:20261005",
  "DTEND;VALUE=DATE:20261007",
  "END:VEVENT",
  // UTC time
  "BEGIN:VEVENT",
  "UID:dentist@test",
  "SUMMARY:Dentist",
  "DTSTART:20261005T150000Z",
  "DTEND:20261005T153000Z",
  "END:VEVENT",
  // Floating time (no zone) = household wall-clock
  "BEGIN:VEVENT",
  "UID:pizza@test",
  "SUMMARY:Pizza night",
  "DTSTART:20261009T180000",
  "END:VEVENT",
  // Cancelled
  "BEGIN:VEVENT",
  "UID:gone@test",
  "SUMMARY:Cancelled thing",
  "STATUS:CANCELLED",
  "DTSTART:20261005T120000Z",
  "END:VEVENT",
  // Way outside the window
  "BEGIN:VEVENT",
  "UID:old@test",
  "SUMMARY:Last year",
  "DTSTART;VALUE=DATE:20251005",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("calendar feeds", () => {
  const from = zonedToMs("2026-10-04", "00:00", TZ);
  const to = zonedToMs("2026-10-11", "00:00", TZ);
  const events = parseIcs(SAMPLE_ICS, TZ, from, to);
  const titles = events.map((e) => `${e.startDay} ${e.allDay ? "all-day" : localTime(e.start, TZ)} ${e.title}`);

  test("expands recurrence with exceptions and exclusions", () => {
    expect(titles).toContain("2026-10-06 18:00 Volleyball practice (late)");
    expect(titles).not.toContain("2026-10-06 16:30 Volleyball practice");
    // Thursday the 8th was cancelled with EXDATE.
    expect(titles.filter((t) => t.startsWith("2026-10-08"))).toEqual([]);
  });

  test("all-day, UTC and floating times land on the right local day and time", () => {
    const fair = events.find((e) => e.title === "Book fair")!;
    expect(fair).toMatchObject({ allDay: true, startDay: "2026-10-05", endDay: "2026-10-06" });
    expect(titles).toContain("2026-10-05 10:00 Dentist"); // 15:00Z = 10:00 CDT
    expect(titles).toContain("2026-10-09 18:00 Pizza night");
  });

  test("skips cancelled and out-of-window events", () => {
    expect(titles.join("\n")).not.toMatch(/Cancelled thing|Last year/);
    expect(events.every((e) => e.start < to)).toBe(true);
  });

  test("normalizes webcal links", () => {
    expect(normalizeFeedUrl("webcal://example.com/cal.ics")).toBe("https://example.com/cal.ics");
    expect(() => normalizeFeedUrl("ftp://example.com/x")).toThrow();
    expect(() => normalizeFeedUrl("not a url")).toThrow();
  });
});

import { describe, expect, test } from "vitest";
import {
  addDays,
  endOfToday,
  endOfWeek,
  isDay,
  isQuiet,
  localDay,
  localTime,
  msUntilQuietEnds,
  nextWeekday,
  weekdayOf,
  zonedToMs,
} from "../convex/lib/time";
import { alignDue, nextDueAfterDone } from "../convex/lib/jobs";
import { keyAtEnd, keyAtStart, keyBetween } from "../convex/lib/order";

const TZ = "America/Chicago";

describe("household time", () => {
  test("local day and time", () => {
    // 2026-10-05 03:30 UTC is still the evening of the 4th in Chicago (CDT, UTC-5).
    const ms = Date.UTC(2026, 9, 5, 3, 30);
    expect(localDay(ms, TZ)).toBe("2026-10-04");
    expect(localTime(ms, TZ)).toBe("22:30");
  });

  test("zonedToMs round-trips, including across DST", () => {
    for (const [day, time] of [
      ["2026-10-04", "07:15"],
      ["2026-03-08", "12:00"], // spring forward day
      ["2026-11-01", "12:00"], // fall back day
      ["2026-01-15", "00:00"],
    ]) {
      const ms = zonedToMs(day, time, TZ);
      expect(localDay(ms, TZ)).toBe(day);
      expect(localTime(ms, TZ)).toBe(time);
    }
    // Winter is UTC-6, summer UTC-5.
    expect(zonedToMs("2026-01-15", "00:00", TZ)).toBe(Date.UTC(2026, 0, 15, 6));
    expect(zonedToMs("2026-07-15", "00:00", TZ)).toBe(Date.UTC(2026, 6, 15, 5));
  });

  test("today notes expire at local midnight; week notes at the end of Sunday", () => {
    const sunEvening = zonedToMs("2026-10-04", "18:00", TZ); // a Sunday
    expect(endOfToday(sunEvening, TZ)).toBe(zonedToMs("2026-10-05", "00:00", TZ));
    expect(endOfWeek(sunEvening, TZ)).toBe(zonedToMs("2026-10-05", "00:00", TZ));
    const wed = zonedToMs("2026-10-07", "09:00", TZ);
    expect(endOfWeek(wed, TZ)).toBe(zonedToMs("2026-10-12", "00:00", TZ));
    const mon = zonedToMs("2026-10-05", "00:30", TZ);
    expect(endOfWeek(mon, TZ)).toBe(zonedToMs("2026-10-12", "00:00", TZ));
  });

  test("day math", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOf("2026-10-04")).toBe(0);
    expect(nextWeekday("2026-10-04", [1, 3])).toBe("2026-10-05");
    expect(nextWeekday("2026-10-05", [1])).toBe("2026-10-12");
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-02-28")).toBe(true);
  });

  test("quiet hours wrap past midnight", () => {
    const at = (time: string) => zonedToMs("2026-10-05", time, TZ);
    expect(isQuiet(at("22:00"), TZ, "21:00", "07:00")).toBe(true);
    expect(isQuiet(at("06:59"), TZ, "21:00", "07:00")).toBe(true);
    expect(isQuiet(at("07:00"), TZ, "21:00", "07:00")).toBe(false);
    expect(isQuiet(at("13:00"), TZ, "13:00", "14:00")).toBe(true);
    expect(isQuiet(at("13:00"), TZ, "08:00", "08:00")).toBe(false);
    expect(msUntilQuietEnds(at("22:00"), TZ, "21:00", "07:00")).toBe(9 * 3600_000);
    expect(msUntilQuietEnds(at("06:00"), TZ, "21:00", "07:00")).toBe(3600_000);
    expect(msUntilQuietEnds(at("12:00"), TZ, "21:00", "07:00")).toBe(0);
  });
});

describe("recurring jobs", () => {
  test("'every N days' counts from when it was actually done", () => {
    const job = { schedule: { kind: "every" as const, days: 3 }, nextDue: "2026-10-01" };
    expect(nextDueAfterDone(job, "2026-10-04")).toBe("2026-10-07");
  });

  test("fixed weekdays: early counts for the current one; late moves on", () => {
    const job = { schedule: { kind: "weekly" as const, weekdays: [1, 4] }, nextDue: "2026-10-08" }; // Thu
    expect(nextDueAfterDone(job, "2026-10-06")).toBe("2026-10-12"); // done early Tue -> next Mon
    expect(nextDueAfterDone(job, "2026-10-08")).toBe("2026-10-12");
    expect(nextDueAfterDone({ ...job, nextDue: "2026-10-05" }, "2026-10-07")).toBe("2026-10-08"); // late
  });

  test("first due day snaps to a chosen weekday", () => {
    expect(alignDue("2026-10-04", { kind: "weekly", weekdays: [6] })).toBe("2026-10-10");
    expect(alignDue("2026-10-04", { kind: "every", days: 2 })).toBe("2026-10-04");
  });
});

describe("fractional sort keys", () => {
  test("keys sort between neighbours with plain string comparison", () => {
    const a = keyAtEnd([]);
    const b = keyAtEnd([{ sortKey: a }]);
    const mid = keyBetween(a, b);
    const first = keyAtStart([{ sortKey: a }]);
    expect([b, mid, a, first].sort()).toEqual([first, a, mid, b]);
  });
});

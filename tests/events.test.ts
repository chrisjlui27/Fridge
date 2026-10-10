import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { occurrenceStarts, repeatMatches } from "../convex/lib/recur";
import { clock12 } from "../convex/lib/time";
import { actOnWall, expectError, newTest, setupFamily } from "./helpers";

describe("repeat rules", () => {
  test("weekly on chosen days, every other week", () => {
    const practice = { freq: "weekly" as const, interval: 1, weekdays: [2, 4] }; // Tue, Thu
    expect(occurrenceStarts({ startDay: "2026-10-06", endDay: "2026-10-06", repeat: practice }, "2026-10-04", "2026-10-17")).toEqual([
      "2026-10-06",
      "2026-10-08",
      "2026-10-13",
      "2026-10-15",
    ]);
    const pizza = { freq: "weekly" as const, interval: 2, weekdays: [5] }; // every other Friday
    expect(occurrenceStarts({ startDay: "2026-10-09", endDay: "2026-10-09", repeat: pizza }, "2026-10-01", "2026-11-07")).toEqual([
      "2026-10-09",
      "2026-10-23",
      "2026-11-06",
    ]);
  });

  test("monthly skips months without that date; yearly keeps the date", () => {
    const monthly = { freq: "monthly" as const, interval: 1 };
    expect(repeatMatches("2026-01-31", monthly, "2026-03-31")).toBe(true);
    expect(occurrenceStarts({ startDay: "2026-01-31", endDay: "2026-01-31", repeat: monthly }, "2026-02-01", "2026-04-30")).toEqual([
      "2026-03-31",
    ]);
    const yearly = { freq: "yearly" as const, interval: 1 };
    expect(repeatMatches("2015-05-02", yearly, "2027-05-02")).toBe(true);
    expect(repeatMatches("2015-05-02", yearly, "2027-05-03")).toBe(false);
  });

  test("until, skipped dates, and multi-day events that started before the window", () => {
    const daily = { freq: "daily" as const, interval: 1, until: "2026-10-08" };
    expect(
      occurrenceStarts(
        { startDay: "2026-10-05", endDay: "2026-10-05", repeat: daily, skipDays: ["2026-10-06"] },
        "2026-10-01",
        "2026-10-31",
      ),
    ).toEqual(["2026-10-05", "2026-10-07", "2026-10-08"]);
    // A 3-day camp starting Saturday still shows on Monday.
    expect(occurrenceStarts({ startDay: "2026-10-10", endDay: "2026-10-12" }, "2026-10-12", "2026-10-12")).toEqual([
      "2026-10-10",
    ]);
  });

  test("12-hour clock for notifications", () => {
    expect(clock12("15:30")).toBe("3:30pm");
    expect(clock12("18:00")).toBe("6pm");
    expect(clock12("00:15")).toBe("12:15am");
    expect(clock12("12:00")).toBe("12pm");
  });
});

describe("the family calendar", () => {
  test("anyone adds; it shows up with who's involved", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.mutation(api.events.create, {
      sessionToken: tokens.ava,
      title: "Volleyball practice",
      allDay: false,
      startDay: "2026-10-06",
      startTime: "17:30",
      endTime: "19:00",
      location: "Gym",
      memberIds: [ids.ava],
      repeat: { freq: "weekly", interval: 1, weekdays: [2, 4] },
    });
    await t.mutation(api.events.create, {
      sessionToken: tokens.mom,
      title: "Book fair",
      allDay: true,
      startDay: "2026-10-07",
      endDay: "2026-10-08",
      memberIds: [],
    });
    const week = await t.query(api.calendar.range, { sessionToken: tokens.dad, fromDay: "2026-10-05", toDay: "2026-10-11" });
    // A multi-day event is one item that starts on its first day.
    expect(week.map((e) => `${e.startDay} ${e.title}`)).toEqual([
      "2026-10-06 Volleyball practice",
      "2026-10-07 Book fair",
      "2026-10-08 Volleyball practice",
    ]);
    const practice = week.find((e) => e.title === "Volleyball practice")!;
    expect(practice).toMatchObject({ source: "fridge", memberIds: [ids.ava], startTime: "17:30", location: "Gym" });
    // Ava's colour, because it's only Ava's.
    const who = await t.query(api.auth.whoami, { sessionToken: tokens.dad });
    expect(practice.color).toBe(who!.members.find((m) => m._id === ids.ava)!.color);
    // The multi-day fair shows on both days when you look at the 8th alone.
    const thursday = await t.query(api.calendar.range, { sessionToken: tokens.dad, fromDay: "2026-10-08", toDay: "2026-10-08" });
    expect(thursday.map((e) => e.title)).toEqual(["Book fair", "Volleyball practice"]);
  });

  test("creator or parent can change it; others can't", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const id = await t.mutation(api.events.create, {
      sessionToken: tokens.ava,
      title: "Sleepover at Jo's",
      allDay: true,
      startDay: "2026-10-16",
      memberIds: [ids.ava],
    });
    const [ev] = await t.query(api.calendar.range, { sessionToken: tokens.ava, fromDay: "2026-10-16", toDay: "2026-10-16" });
    expect(ev.canEdit).toBe(true);
    const asDad = await t.query(api.calendar.range, { sessionToken: tokens.dad, fromDay: "2026-10-16", toDay: "2026-10-16" });
    expect(asDad[0].canEdit).toBe(true);
    await actOnWall(t, tokens.wall, ids.bella);
    const asBella = await t.query(api.calendar.range, { sessionToken: tokens.wall, fromDay: "2026-10-16", toDay: "2026-10-16" });
    expect(asBella[0].canEdit).toBe(false);
    const edit = { title: "Sleepover", allDay: true, startDay: "2026-10-16", memberIds: [ids.ava] };
    await expectError(t.mutation(api.events.update, { sessionToken: tokens.wall, eventId: id, scope: "all", ...edit }), "NOT_ALLOWED");
    await t.mutation(api.events.update, { sessionToken: tokens.mom, eventId: id, scope: "all", ...edit });
    await expectError(t.mutation(api.events.remove, { sessionToken: tokens.wall, eventId: id, scope: "all" }), "NOT_ALLOWED");
    await t.mutation(api.events.remove, { sessionToken: tokens.ava, eventId: id, scope: "all" });
    expect(await t.query(api.calendar.range, { sessionToken: tokens.ava, fromDay: "2026-10-16", toDay: "2026-10-16" })).toEqual([]);
  });

  test("repeating events: change or delete one date, or all of them", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const base = {
      title: "Piano",
      allDay: false,
      startDay: "2026-10-05",
      startTime: "16:00",
      memberIds: [ids.ava],
      repeat: { freq: "weekly" as const, interval: 1, weekdays: [1] },
    };
    const id = await t.mutation(api.events.create, { sessionToken: tokens.mom, ...base });
    const titles = async () =>
      (await t.query(api.calendar.range, { sessionToken: tokens.mom, fromDay: "2026-10-05", toDay: "2026-10-26" })).map(
        (e) => `${e.startDay} ${e.startTime} ${e.title}`,
      );

    // Move just the 12th to 5pm.
    const oneId = await t.mutation(api.events.update, {
      sessionToken: tokens.mom,
      eventId: id,
      scope: "one",
      occurrenceDay: "2026-10-12",
      ...base,
      startDay: "2026-10-12",
      startTime: "17:00",
      repeat: null,
    });
    expect(oneId).not.toBe(id);
    // Skip the 19th.
    await t.mutation(api.events.remove, { sessionToken: tokens.mom, eventId: id, scope: "one", occurrenceDay: "2026-10-19" });
    expect(await titles()).toEqual(["2026-10-05 16:00 Piano", "2026-10-12 17:00 Piano", "2026-10-26 16:00 Piano"]);
    // The moved date knows which series it came from.
    const moved = (await t.query(api.calendar.range, { sessionToken: tokens.mom, fromDay: "2026-10-12", toDay: "2026-10-12" }))[0];
    expect(moved).toMatchObject({ seriesId: id, occurrenceDay: "2026-10-12", repeat: null });

    // Rename every date (the one-off keeps its own time).
    await t.mutation(api.events.update, { sessionToken: tokens.mom, eventId: id, scope: "all", ...base, title: "Piano lesson" });
    expect(await titles()).toEqual(["2026-10-05 16:00 Piano lesson", "2026-10-12 17:00 Piano", "2026-10-26 16:00 Piano lesson"]);

    // A date that isn't part of the series is refused.
    await expectError(
      t.mutation(api.events.remove, { sessionToken: tokens.mom, eventId: id, scope: "one", occurrenceDay: "2026-10-07" }),
      "INVALID",
    );

    // Delete the whole thing, one-offs included.
    await t.mutation(api.events.remove, { sessionToken: tokens.mom, eventId: id, scope: "all" });
    expect(await titles()).toEqual([]);
  });

  test("validation", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const bad = (over: object) =>
      t.mutation(api.events.create, {
        sessionToken: tokens.dad,
        title: "x",
        allDay: false,
        startDay: "2026-10-05",
        startTime: "10:00",
        memberIds: [],
        ...over,
      });
    await expectError(bad({ startTime: undefined }), "INVALID");
    await expectError(bad({ endTime: "09:00" }), "INVALID");
    await expectError(bad({ allDay: true, endDay: "2026-10-01" }), "INVALID");
    await expectError(bad({ allDay: true, endDay: "2026-12-25" }), "INVALID");
    await expectError(bad({ repeat: { freq: "weekly", interval: 0 } }), "INVALID");
    await expectError(bad({ repeat: { freq: "daily", interval: 1, until: "2026-10-01" } }), "INVALID");
    await expectError(bad({ title: " " }), "INVALID");
  });

  test("removing someone untags them from events", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.mutation(api.events.create, {
      sessionToken: tokens.dad,
      title: "Swim",
      allDay: true,
      startDay: "2026-10-05",
      memberIds: [ids.ava, ids.cora],
    });
    await t.mutation(api.members.remove, { sessionToken: tokens.dad, memberId: ids.cora });
    const [ev] = await t.query(api.calendar.range, { sessionToken: tokens.dad, fromDay: "2026-10-05", toDay: "2026-10-05" });
    expect(ev.memberIds).toEqual([ids.ava]);
  });
});

describe("day-before heads-up", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("tomorrow's events in the evening summary, yours first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T00:05:00Z")); // Sun 4 Oct, 7:05pm Chicago
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.mutation(api.events.create, {
      sessionToken: tokens.mom,
      title: "Dentist",
      allDay: false,
      startDay: "2026-10-05",
      startTime: "15:30",
      memberIds: [ids.ava, ids.mom],
    });
    await t.mutation(api.events.create, {
      sessionToken: tokens.mom,
      title: "Book fair",
      allDay: true,
      startDay: "2026-10-05",
      memberIds: [],
    });
    expect(await t.query(api.digest.preview, { sessionToken: tokens.ava })).toEqual([
      "📅 Tomorrow for you: Dentist 3:30pm",
      "📅 Also tomorrow: Book fair",
    ]);
    expect(await t.query(api.digest.preview, { sessionToken: tokens.dad })).toEqual([
      "📅 Tomorrow: Book fair, Dentist 3:30pm",
    ]);
  });
});

import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { expectError, newTest, setupFamily } from "./helpers";
import { SAMPLE_ICS } from "./ical.test";

describe("calendar feeds", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("parents add a feed; the fridge fetches it and shows it read-only", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T15:00:00Z"));
    const t = newTest();
    const { tokens } = await setupFamily(t);
    await expectError(
      t.mutation(api.calendar.addFeed, { sessionToken: tokens.ava, name: "School", url: "https://x/y.ics", color: "#f00" }),
      "PARENT_ONLY",
    );
    vi.stubGlobal("fetch", async () => new Response(SAMPLE_ICS, { status: 200 }));
    const feedId = await t.mutation(api.calendar.addFeed, {
      sessionToken: tokens.dad,
      name: "Family",
      url: "webcal://calendar.example.com/family.ics",
      color: "#4c6ef5",
    });
    await t.action(internal.calendar.refreshFeed, { feedId });
    const feeds = await t.query(api.calendar.feeds, { sessionToken: tokens.dad });
    expect(feeds[0]).toMatchObject({ name: "Family", lastError: null });
    expect(feeds[0].eventCount).toBeGreaterThan(3);

    const tue = await t.query(api.calendar.range, { sessionToken: tokens.wall, fromDay: "2026-10-06", toDay: "2026-10-06" });
    expect(tue.map((e) => e.title)).toEqual(["Book fair", "Volleyball practice (late)"]);
    expect(tue[1]).toMatchObject({ color: "#4c6ef5", feedName: "Family" });

    // A broken fetch keeps the last good copy and notes the error.
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    await t.action(internal.calendar.refreshFeed, { feedId });
    const after = await t.query(api.calendar.feeds, { sessionToken: tokens.dad });
    expect(after[0].lastError).toContain("500");
    expect(
      await t.query(api.calendar.range, { sessionToken: tokens.wall, fromDay: "2026-10-06", toDay: "2026-10-06" }),
    ).toHaveLength(2);

    await t.mutation(api.calendar.removeFeed, { sessionToken: tokens.dad, feedId });
    expect(
      await t.query(api.calendar.range, { sessionToken: tokens.wall, fromDay: "2026-10-01", toDay: "2026-10-30" }),
    ).toEqual([]);
  });
});

describe("export", () => {
  test("parents get everything that's theirs, minus secrets and private spaces", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.action(api.auth.setPin, { sessionToken: tokens.dad, memberId: ids.cora, pin: "1357" });
    await t.mutation(api.notes.create, { sessionToken: tokens.ava, text: "Hi from Ava", color: "pink", lifespan: "keep" });
    await t.mutation(api.mine.add, { sessionToken: tokens.ava, text: "SECRET diary", color: "pink" });
    const [list] = await t.query(api.lists.all, { sessionToken: tokens.dad });
    await t.mutation(api.lists.addItem, { sessionToken: tokens.ava, listId: list._id, text: "Pickles" });
    const jobId = await t.mutation(api.jobs.create, {
      sessionToken: tokens.dad,
      title: "Dishes",
      emoji: "🍽️",
      rotation: [ids.ava, ids.dad],
      schedule: { kind: "every", days: 1 },
      firstDue: "2026-10-04",
    });
    const completionId = await t.mutation(api.jobs.complete, { sessionToken: tokens.ava, jobId });
    await t.mutation(api.thanks.thank, { sessionToken: tokens.dad, completionId, text: "You're a star" });

    await expectError(t.action(api.exporter.download, { sessionToken: tokens.ava }), "PARENT_ONLY");
    const { filename, json } = await t.action(api.exporter.download, { sessionToken: tokens.mom });
    expect(filename).toMatch(/^fridge-export-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(json);
    expect(data.format).toBe("fridge-door-export");
    expect(data.members.map((m: { name: string }) => m.name)).toContain("Cora");
    expect(data.notes[0].text).toBe("Hi from Ava");
    expect(data.lists[0].items[0].text).toBe("Pickles");
    expect(data.completions).toHaveLength(1);
    expect(data.reactions[0].text).toBe("You're a star");
    expect(json).not.toMatch(/SECRET diary|pinHash|pinSalt|passwordHash|tokenHash|codeHash|p256dh/);

    // Nightly snapshots are stored and listed for parents.
    await t.action(internal.exporter.nightly, {});
    const recent = await t.query(api.exporter.recent, { sessionToken: tokens.dad });
    expect(recent).toHaveLength(1);
    expect(recent[0].bytes).toBeGreaterThan(100);
  });
});

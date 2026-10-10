import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { actOnWall, expectError, newTest, setupFamily } from "./helpers";

describe("quick polls", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("vote, change your mind, see who picked what", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const pollId = await t.mutation(api.polls.create, {
      sessionToken: tokens.ava,
      question: "Friday dinner?",
      options: ["Pizza", "Tacos", " pizza ", ""],
      closes: "tomorrow",
    });
    let [poll] = await t.query(api.polls.active, { sessionToken: tokens.dad });
    expect(poll.options.map((o) => o.text)).toEqual(["Pizza", "Tacos"]); // duplicates and blanks dropped
    const [pizza, tacos] = poll.options.map((o) => o.id);

    await t.mutation(api.polls.vote, { sessionToken: tokens.dad, pollId, optionId: pizza });
    await t.mutation(api.polls.vote, { sessionToken: tokens.mom, pollId, optionId: pizza });
    await t.mutation(api.polls.vote, { sessionToken: tokens.dad, pollId, optionId: tacos });
    await actOnWall(t, tokens.wall, ids.bella);
    await t.mutation(api.polls.vote, { sessionToken: tokens.wall, pollId, optionId: tacos });

    [poll] = await t.query(api.polls.active, { sessionToken: tokens.dad });
    expect(poll.myVote).toBe(tacos);
    expect(poll.options.map((o) => [o.text, o.voters.length])).toEqual([
      ["Pizza", 1],
      ["Tacos", 2],
    ]);
    expect(poll.options[1].voters.sort()).toEqual([ids.dad, ids.bella].sort());
    await expectError(t.mutation(api.polls.vote, { sessionToken: tokens.dad, pollId, optionId: "o9" }), "INVALID");
  });

  test("only the asker or a parent closes or removes it; closed polls refuse votes", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const pollId = await t.mutation(api.polls.create, {
      sessionToken: tokens.ava,
      question: "Movie night pick?",
      options: ["Moana", "Up"],
      closes: "week",
    });
    await expectError(t.mutation(api.polls.close, { sessionToken: tokens.wall, pollId }), "PICK_PROFILE");
    await t.mutation(api.polls.close, { sessionToken: tokens.mom, pollId });
    await expectError(t.mutation(api.polls.vote, { sessionToken: tokens.dad, pollId, optionId: "o1" }), "CLOSED");
    // Closed polls stay up for a day so everyone sees the result.
    expect((await t.query(api.polls.active, { sessionToken: tokens.dad }))[0].closedAt).not.toBeNull();
    await t.mutation(api.polls.remove, { sessionToken: tokens.ava, pollId });
    expect(await t.query(api.polls.active, { sessionToken: tokens.dad })).toEqual([]);
  });

  test("needs two different choices", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    await expectError(
      t.mutation(api.polls.create, { sessionToken: tokens.dad, question: "?", options: ["Yes", "yes"], closes: "today" }),
      "INVALID",
    );
  });

  test("polls close on their own, then tidy away a day later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T15:00:00Z")); // Mon 10am Chicago
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const pollId = await t.mutation(api.polls.create, {
      sessionToken: tokens.dad,
      question: "Park after school?",
      options: ["Yes", "No"],
      closes: "today",
    });
    // Due at local midnight.
    const [poll] = await t.query(api.polls.active, { sessionToken: tokens.dad });
    expect(poll.closesAt).toBe(Date.parse("2026-10-06T05:00:00Z"));
    expect(await t.query(api.digest.preview, { sessionToken: tokens.mom })).toContain("🗳️ 1 poll waiting for your vote");

    vi.setSystemTime(new Date("2026-10-06T06:00:00Z"));
    await expectError(t.mutation(api.polls.vote, { sessionToken: tokens.mom, pollId, optionId: "o1" }), "CLOSED");
    expect(await t.mutation(internal.polls.archiveOld, {})).toBe(0);
    vi.setSystemTime(new Date("2026-10-07T06:00:00Z"));
    expect(await t.mutation(internal.polls.archiveOld, {})).toBe(1);
    expect(await t.query(api.polls.active, { sessionToken: tokens.dad })).toEqual([]);
  });
});

describe("art wall", () => {
  test("every photo and doodle, including ones taken down; text notes left out", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const img = () => t.run((ctx) => ctx.storage.store(new Blob(["png"], { type: "image/png" })));
    const doodle = await t.mutation(api.notes.create, {
      sessionToken: tokens.ava,
      text: "A cat",
      color: "white",
      lifespan: "today",
      imageId: await img(),
      imageKind: "doodle",
    });
    await t.mutation(api.notes.create, { sessionToken: tokens.dad, text: "Just words", color: "yellow", lifespan: "keep" });
    await t.mutation(api.notes.create, {
      sessionToken: tokens.mom,
      text: "",
      color: "white",
      lifespan: "keep",
      imageId: await img(),
      imageKind: "photo",
    });
    await t.mutation(api.notes.takeDown, { sessionToken: tokens.dad, noteId: doodle });

    const { items, hasMore } = await t.query(api.art.list, { sessionToken: tokens.ava });
    expect(hasMore).toBe(false);
    expect(items.map((i) => [i.imageKind, i.text, i.onDoor])).toEqual([
      ["photo", "", true],
      ["doodle", "A cat", false],
    ]);
    expect(items[0].imageUrl).toMatch(/^https?:\/\//);
    const page = await t.query(api.art.list, { sessionToken: tokens.ava, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
  });
});

describe("export", () => {
  test("includes the calendar and polls", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.mutation(api.events.create, {
      sessionToken: tokens.dad,
      title: "Swim lesson",
      allDay: false,
      startDay: "2026-10-05",
      startTime: "09:00",
      memberIds: [ids.ava],
      repeat: { freq: "weekly", interval: 1 },
    });
    const pollId = await t.mutation(api.polls.create, {
      sessionToken: tokens.dad,
      question: "Beach or lake?",
      options: ["Beach", "Lake"],
      closes: "week",
    });
    await t.mutation(api.polls.vote, { sessionToken: tokens.ava, pollId, optionId: "o2" });
    const data = JSON.parse((await t.action(api.exporter.download, { sessionToken: tokens.dad })).json);
    expect(data.events[0]).toMatchObject({ title: "Swim lesson", repeat: { freq: "weekly", weekdays: [1] } });
    expect(data.polls[0].votes).toEqual([{ member: ids.ava, option: "o2" }]);
  });
});

import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { addDays, localDay } from "../convex/lib/time";
import { actOnWall, expectError, newTest, setupFamily, TZ } from "./helpers";

const today = () => localDay(Date.now(), TZ);

describe("requests, not assignments", () => {
  test("the person asked can accept, propose another time, or say can't", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const id = await t.mutation(api.requests.create, {
      sessionToken: tokens.mom,
      toId: ids.ava,
      title: "Poster board for Thursday",
      dueDate: "2026-10-08",
    });
    await expectError(
      t.mutation(api.requests.respond, { sessionToken: tokens.dad, requestId: id, response: "accept" }),
      "NOT_ALLOWED",
    );
    await t.mutation(api.requests.respond, {
      sessionToken: tokens.ava,
      requestId: id,
      response: "propose",
      proposedDate: "2026-10-09",
      reply: "Practice runs late Thursday",
    });
    let mine = await t.query(api.requests.mine, { sessionToken: tokens.mom });
    expect(mine.fromMe[0]).toMatchObject({ status: "proposed", proposedDate: "2026-10-09" });
    await t.mutation(api.requests.acceptProposal, { sessionToken: tokens.mom, requestId: id });
    mine = await t.query(api.requests.mine, { sessionToken: tokens.mom });
    expect(mine.fromMe[0]).toMatchObject({ status: "accepted", dueDate: "2026-10-09", proposedDate: null });

    const completionId = await t.mutation(api.requests.complete, { sessionToken: tokens.ava, requestId: id });
    expect(completionId).toBeTruthy();
    const feed = await t.query(api.thanks.feed, { sessionToken: tokens.dad });
    expect(feed.items[0]).toMatchObject({ type: "completion", kind: "request", memberId: ids.ava });
  });

  test("can't is a fine answer", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const id = await t.mutation(api.requests.create, { sessionToken: tokens.ava, toId: ids.dad, title: "Ride at 4?" });
    await t.mutation(api.requests.respond, {
      sessionToken: tokens.dad,
      requestId: id,
      response: "decline",
      reply: "In a meeting - ask Mom?",
    });
    const mine = await t.query(api.requests.mine, { sessionToken: tokens.ava });
    expect(mine.fromMe[0]).toMatchObject({ status: "declined", reply: "In a meeting - ask Mom?" });
    expect(await t.query(api.requests.active, { sessionToken: tokens.dad })).toEqual([]);
  });

  test("validation", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await expectError(
      t.mutation(api.requests.create, { sessionToken: tokens.ava, toId: ids.ava, title: "Me" }),
      "INVALID",
    );
    await expectError(
      t.mutation(api.requests.create, { sessionToken: tokens.ava, toId: ids.dad, title: "x", dueTime: "16:00" }),
      "INVALID",
    );
    await expectError(
      t.mutation(api.requests.create, { sessionToken: tokens.ava, toId: ids.dad, title: "x", dueDate: "2026-13-01" }),
      "INVALID",
    );
    const id = await t.mutation(api.requests.create, { sessionToken: tokens.ava, toId: ids.dad, title: "x" });
    await expectError(
      t.mutation(api.requests.withdraw, { sessionToken: tokens.dad, requestId: id }),
      "NOT_ALLOWED",
    );
    await t.mutation(api.requests.withdraw, { sessionToken: tokens.ava, requestId: id });
    await expectError(t.mutation(api.requests.complete, { sessionToken: tokens.dad, requestId: id }), "INVALID");
  });
});

describe("recurring family jobs", () => {
  test("rotation includes parents and moves on when done; credit goes to whoever did it", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const jobId = await t.mutation(api.jobs.create, {
      sessionToken: tokens.mom,
      title: "Dishwasher",
      emoji: "🍽️",
      rotation: [ids.dad, ids.ava, ids.bella],
      schedule: { kind: "every", days: 1 },
      firstDue: today(),
    });
    let [job] = await t.query(api.jobs.list, { sessionToken: tokens.dad });
    expect(job.assigneeId).toBe(ids.dad);

    await t.mutation(api.jobs.complete, { sessionToken: tokens.dad, jobId });
    [job] = await t.query(api.jobs.list, { sessionToken: tokens.dad });
    expect(job.assigneeId).toBe(ids.ava);
    expect(job.nextDue).toBe(addDays(today(), 1));

    // Bella does Ava's turn from the wall: Bella gets the credit, rotation moves on.
    await actOnWall(t, tokens.wall, ids.bella);
    const completionId = await t.mutation(api.jobs.complete, { sessionToken: tokens.wall, jobId });
    [job] = await t.query(api.jobs.list, { sessionToken: tokens.dad });
    expect(job.assigneeId).toBe(ids.bella);
    expect(job.lastDone).toMatchObject({ memberId: ids.bella });

    // Oops - mis-tap. Undo puts it back.
    await t.mutation(api.jobs.undo, { sessionToken: tokens.wall, completionId });
    [job] = await t.query(api.jobs.list, { sessionToken: tokens.dad });
    expect(job.assigneeId).toBe(ids.ava);
    expect(job.lastDone).toMatchObject({ memberId: ids.dad });

    const summary = await t.query(api.today.summary, { sessionToken: tokens.wall, today: today() });
    expect(summary.doneToday.map((d) => d.memberId)).toEqual([ids.dad]);
  });

  test("undo only works for the latest completion, by whoever did it", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const jobId = await t.mutation(api.jobs.create, {
      sessionToken: tokens.mom,
      title: "Trash",
      emoji: "🗑️",
      rotation: [ids.ava, ids.bella],
      schedule: { kind: "weekly", weekdays: [1, 4] },
      firstDue: today(),
    });
    const first = await t.mutation(api.jobs.complete, { sessionToken: tokens.ava, jobId });
    await actOnWall(t, tokens.wall, ids.bella);
    await expectError(t.mutation(api.jobs.undo, { sessionToken: tokens.wall, completionId: first }), "NOT_ALLOWED");
    await t.mutation(api.jobs.complete, { sessionToken: tokens.ava, jobId });
    await expectError(t.mutation(api.jobs.undo, { sessionToken: tokens.ava, completionId: first }), "INVALID");
  });

  test("not today: the person whose turn it is can push it to tomorrow", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const jobId = await t.mutation(api.jobs.create, {
      sessionToken: tokens.mom,
      title: "Water plants",
      emoji: "🪴",
      rotation: [ids.cora],
      schedule: { kind: "every", days: 3 },
      firstDue: today(),
    });
    await expectError(t.mutation(api.jobs.snooze, { sessionToken: tokens.ava, jobId }), "NOT_ALLOWED");
    await actOnWall(t, tokens.wall, ids.cora);
    await t.mutation(api.jobs.snooze, { sessionToken: tokens.wall, jobId });
    const [job] = await t.query(api.jobs.list, { sessionToken: tokens.dad });
    expect(job.nextDue).toBe(addDays(today(), 1));
  });

  test("editing keeps whose turn it is", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const jobId = await t.mutation(api.jobs.create, {
      sessionToken: tokens.mom,
      title: "Feed the dog",
      emoji: "🐕",
      rotation: [ids.ava, ids.bella],
      schedule: { kind: "every", days: 1 },
      firstDue: today(),
    });
    await t.mutation(api.jobs.complete, { sessionToken: tokens.ava, jobId }); // Bella's turn
    await t.mutation(api.jobs.update, {
      sessionToken: tokens.mom,
      jobId,
      rotation: [ids.cora, ids.bella, ids.ava],
    });
    const [job] = await t.query(api.jobs.list, { sessionToken: tokens.dad });
    expect(job.assigneeId).toBe(ids.bella);
    await expectError(
      t.mutation(api.jobs.update, { sessionToken: tokens.ava, jobId, title: "Nope" }),
      "NOT_ALLOWED",
    );
    await expectError(
      t.mutation(api.jobs.create, {
        sessionToken: tokens.mom,
        title: "x",
        emoji: "x",
        rotation: [],
        schedule: { kind: "every", days: 1 },
        firstDue: today(),
      }),
      "INVALID",
    );
  });
});

describe("thanks", () => {
  test("specific thanks for a thing someone did, or for something nobody saw", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const jobId = await t.mutation(api.jobs.create, {
      sessionToken: tokens.mom,
      title: "Laundry",
      emoji: "🧺",
      rotation: [ids.ava],
      schedule: { kind: "every", days: 2 },
      firstDue: today(),
    });
    const completionId = await t.mutation(api.jobs.complete, { sessionToken: tokens.ava, jobId });
    await t.mutation(api.thanks.thank, {
      sessionToken: tokens.mom,
      completionId,
      text: "You're really good at folding!",
    });
    await expectError(
      t.mutation(api.thanks.thank, { sessionToken: tokens.ava, completionId, text: "me!" }),
      "INVALID",
    );
    await t.mutation(api.thanks.thank, {
      sessionToken: tokens.dad,
      toMemberId: ids.mom,
      text: "You noticed we were out of milk",
    });
    const feed = await t.query(api.thanks.feed, { sessionToken: tokens.wall });
    expect(feed.weekCount).toBe(1);
    expect(feed.items.map((i) => i.type).sort()).toEqual(["completion", "shoutout"]);
    const done = feed.items.find((i) => i.type === "completion")!;
    expect(done.type === "completion" && done.thanks[0].text).toBe("You're really good at folding!");
    const recent = await t.query(api.thanks.recent, { sessionToken: tokens.wall });
    expect(recent.map((r) => r.toId).sort()).toEqual([ids.ava, ids.mom].sort());
  });
});

describe("evening digest", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("sums up tomorrow for people who turned notifications on", async () => {
    vi.useFakeTimers();
    // Sunday 2026-10-04, 19:05 in Chicago.
    vi.setSystemTime(new Date("2026-10-05T00:05:00Z"));
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.mutation(api.jobs.create, {
      sessionToken: tokens.mom,
      title: "Trash out",
      emoji: "🗑️",
      rotation: [ids.ava],
      schedule: { kind: "every", days: 7 },
      firstDue: "2026-10-05",
    });
    await t.mutation(api.requests.create, { sessionToken: tokens.mom, toId: ids.ava, title: "Sign permission slip" });
    const preview = await t.query(api.digest.preview, { sessionToken: tokens.ava });
    expect(preview).toEqual([
      "🧹 Your turn tomorrow: Trash out",
      "🙋 1 request waiting for your answer",
    ]);

    // No device with notifications on: nothing is sent.
    expect(await t.mutation(internal.digest.tick, {})).toBe(0);

    // Ava turns notifications on for her phone.
    await t.mutation(api.push.subscribe, {
      sessionToken: tokens.ava,
      endpoint: "https://push.example.com/ava",
      p256dh: "key",
      auth: "auth",
    });
    // The wall can't subscribe - pushes are personal.
    await actOnWall(t, tokens.wall, ids.bella);
    await expectError(
      t.mutation(api.push.subscribe, {
        sessionToken: tokens.wall,
        endpoint: "https://push.example.com/wall",
        p256dh: "key",
        auth: "auth",
      }),
      "INVALID",
    );
    expect(await t.mutation(internal.digest.tick, {})).toBe(1);
    // Once a day only.
    expect(await t.mutation(internal.digest.tick, {})).toBe(0);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const digest = scheduled.filter((f) => f.name.includes("pushNode") && (f.args[0] as { tag?: string }).tag === "digest");
    expect(digest).toHaveLength(1);
    expect((digest[0].args[0] as { body: string }).body).toContain("Trash out");
  });

  test("pings wait for the end of quiet hours", async () => {
    vi.useFakeTimers();
    // 22:30 in Chicago - inside the default 21:00-07:00 quiet hours.
    vi.setSystemTime(new Date("2026-10-05T03:30:00Z"));
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.mutation(api.push.subscribe, {
      sessionToken: tokens.ava,
      endpoint: "https://push.example.com/ava",
      p256dh: "key",
      auth: "auth",
    });
    await t.mutation(api.requests.create, {
      sessionToken: tokens.mom,
      toId: ids.ava,
      title: "Bring the cooler",
      urgent: true,
    });
    // Not urgent and not due today: digest only, no ping.
    await t.mutation(api.requests.create, { sessionToken: tokens.mom, toId: ids.ava, title: "Clean room sometime" });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const pings = scheduled.filter((f) => f.name.includes("pushNode"));
    expect(pings).toHaveLength(1);
    // 07:00 Chicago the next morning = 12:00Z.
    expect(pings[0].scheduledTime).toBe(Date.parse("2026-10-05T12:00:00Z"));
  });
});

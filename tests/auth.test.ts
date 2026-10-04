import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { actOnWall, expectError, newTest, setupFamily } from "./helpers";

describe("first run", () => {
  test("setting up creates a household, a parent login and a Groceries list", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const who = await t.query(api.auth.whoami, { sessionToken: tokens.dad });
    expect(who?.isParentAccount).toBe(true);
    expect(who?.viewer?.name).toBe("Dad");
    expect(who?.members.map((m) => m.name)).toEqual(["Dad", "Mom", "Ava", "Bella", "Cora"]);
    const lists = await t.query(api.lists.all, { sessionToken: tokens.dad });
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: "Groceries", ownerId: ids.dad });
    expect(await t.query(api.auth.status, {})).toMatchObject({ hasHousehold: true });
  });

  test("a second household can't be created on the same deployment", async () => {
    const t = newTest();
    await setupFamily(t);
    await expectError(
      t.action(api.auth.setupHousehold, {
        householdName: "Strangers",
        timezone: "UTC",
        name: "X",
        emoji: "x",
        color: "#000",
        email: "x@example.com",
        password: "whatever123",
        deviceLabel: "x",
      }),
      "SETUP_CLOSED",
    );
  });
});

describe("parent sign-in", () => {
  test("right password works, wrong one doesn't, and repeated failures lock", async () => {
    const t = newTest();
    await setupFamily(t);
    const ok = await t.action(api.auth.signIn, {
      email: " DAD@example.com ",
      password: "fridge-door-1",
      deviceLabel: "Laptop",
    });
    expect((await t.query(api.auth.whoami, { sessionToken: ok.token }))?.viewer?.name).toBe("Dad");

    for (let i = 0; i < 5; i++) {
      await expectError(
        t.action(api.auth.signIn, { email: "dad@example.com", password: "nope-nope", deviceLabel: "x" }),
        "BAD_LOGIN",
      );
    }
    await expectError(
      t.action(api.auth.signIn, { email: "dad@example.com", password: "fridge-door-1", deviceLabel: "x" }),
      "LOCKED",
    );
    await expectError(
      t.action(api.auth.signIn, { email: "nobody@example.com", password: "fridge-door-1", deviceLabel: "x" }),
      "BAD_LOGIN",
    );
  });

  test("second parent joins with a one-time code", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const who = await t.query(api.auth.whoami, { sessionToken: tokens.mom });
    expect(who?.isParentAccount).toBe(true);
    expect(who?.viewer?.name).toBe("Mom");
    const again = await t.action(api.auth.signIn, {
      email: "mom@example.com",
      password: "fridge-door-2",
      deviceLabel: "Mom's laptop",
    });
    expect(again.token).toBeTruthy();
  });

  test("codes work once and expire", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const { code } = await t.action(api.auth.createPairingCode, { sessionToken: tokens.dad, purpose: "wall" });
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await t.action(api.auth.describeCode, { code })).toEqual({ purpose: "wall", memberName: null });
    await t.action(api.auth.redeemCode, { code, deviceLabel: "Tablet" });
    await expectError(t.action(api.auth.redeemCode, { code, deviceLabel: "Tablet 2" }), "BAD_CODE");

    const second = await t.action(api.auth.createPairingCode, { sessionToken: tokens.dad, purpose: "wall" });
    await t.run(async (ctx) => {
      for (const pc of await ctx.db.query("pairingCodes").collect()) {
        await ctx.db.patch(pc._id, { expiresAt: Date.now() - 1 });
      }
    });
    await expectError(t.action(api.auth.redeemCode, { code: second.code, deviceLabel: "Tablet 3" }), "BAD_CODE");
  });

  test("only parents signed in with a password can make codes or manage people", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await expectError(
      t.action(api.auth.createPairingCode, { sessionToken: tokens.ava, purpose: "wall" }),
      "PARENT_ONLY",
    );
    // Dad acting on the wall with a tap is not the same as Dad's real sign-in.
    await actOnWall(t, tokens.wall, ids.dad);
    await expectError(
      t.mutation(api.members.add, {
        sessionToken: tokens.wall,
        name: "Grandma",
        role: "parent",
        emoji: "👵",
        color: "#000",
      }),
      "PARENT_ONLY",
    );
    await expectError(t.query(api.auth.devices, { sessionToken: tokens.ava }), "PARENT_ONLY");
    const devices = await t.query(api.auth.devices, { sessionToken: tokens.dad });
    expect(devices.map((d) => d.label).sort()).toEqual(["Ava's phone", "Dad's phone", "Kitchen tablet", "Mom's phone"]);
  });

  test("signing out and revoking devices", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    await t.mutation(api.auth.signOut, { sessionToken: tokens.ava });
    expect(await t.query(api.auth.whoami, { sessionToken: tokens.ava })).toBeNull();
    await expectError(t.query(api.notes.door, { sessionToken: tokens.ava }), "SIGNED_OUT");

    const devices = await t.query(api.auth.devices, { sessionToken: tokens.dad });
    const wall = devices.find((d) => d.kind === "wall")!;
    await t.mutation(api.auth.revokeDevice, { sessionToken: tokens.dad, sessionId: wall._id });
    expect(await t.query(api.auth.whoami, { sessionToken: tokens.wall })).toBeNull();
  });
});

describe("the wall tablet", () => {
  test("nobody is acting until someone taps in", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const who = await t.query(api.auth.whoami, { sessionToken: tokens.wall });
    expect(who?.viewer).toBeNull();
    expect(who?.session.kind).toBe("wall");
    // Reading is fine; writing needs a person.
    await t.query(api.notes.door, { sessionToken: tokens.wall });
    await expectError(
      t.mutation(api.notes.create, { sessionToken: tokens.wall, text: "hi", color: "yellow", lifespan: "today" }),
      "PICK_PROFILE",
    );
    await actOnWall(t, tokens.wall, ids.bella);
    expect((await t.query(api.auth.whoami, { sessionToken: tokens.wall }))?.viewer?.name).toBe("Bella");
    await t.mutation(api.notes.create, { sessionToken: tokens.wall, text: "hi", color: "yellow", lifespan: "today" });
    await t.mutation(api.auth.stopActing, { sessionToken: tokens.wall });
    expect((await t.query(api.auth.whoami, { sessionToken: tokens.wall }))?.viewer).toBeNull();
  });

  test("tapped-in profiles time out", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await actOnWall(t, tokens.wall, ids.bella);
    await t.run(async (ctx) => {
      const s = (await ctx.db.query("sessions").collect()).find((x) => x.kind === "wall")!;
      await ctx.db.patch(s._id, { actingUntil: Date.now() - 1 });
    });
    expect((await t.query(api.auth.whoami, { sessionToken: tokens.wall }))?.viewer).toBeNull();
  });

  test("PINs stop siblings posing as each other, and lock after 5 wrong tries", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    // Ava sets her own PIN from her phone.
    await t.action(api.auth.setPin, { sessionToken: tokens.ava, memberId: ids.ava, pin: "2468" });
    // ...but can't set her sister's.
    await expectError(
      t.action(api.auth.setPin, { sessionToken: tokens.ava, memberId: ids.cora, pin: "1111" }),
      "PARENT_ONLY",
    );
    await expectError(actOnWall(t, tokens.wall, ids.ava), "BAD_PIN");
    await expectError(actOnWall(t, tokens.wall, ids.ava, "1234"), "BAD_PIN");
    await actOnWall(t, tokens.wall, ids.ava, "2468");
    expect((await t.query(api.auth.whoami, { sessionToken: tokens.wall }))?.viewer?.name).toBe("Ava");

    for (let i = 0; i < 5; i++) await expectError(actOnWall(t, tokens.wall, ids.ava, "0000"), "BAD_PIN");
    await expectError(actOnWall(t, tokens.wall, ids.ava, "2468"), "LOCKED");

    // PIN must be digits.
    await expectError(
      t.action(api.auth.setPin, { sessionToken: tokens.dad, memberId: ids.cora, pin: "abcd" }),
      "INVALID",
    );
  });

  test("personal devices can't switch people", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await expectError(actOnWall(t, tokens.ava, ids.bella), "INVALID");
  });

  test("whoami never exposes secrets", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.action(api.auth.setPin, { sessionToken: tokens.dad, memberId: ids.cora, pin: "1357" });
    const who = await t.query(api.auth.whoami, { sessionToken: tokens.wall });
    const json = JSON.stringify(who);
    expect(json).not.toMatch(/pinHash|pinSalt|tokenHash|password/i);
    expect(who?.members.find((m) => m._id === ids.cora)?.hasPin).toBe(true);
  });
});

describe("removing someone", () => {
  test("cleans up their devices, private space, rotations and open requests", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.mutation(api.mine.add, { sessionToken: tokens.ava, text: "diary", color: "pink" });
    const jobId = await t.mutation(api.jobs.create, {
      sessionToken: tokens.dad,
      title: "Dishes",
      emoji: "🍽️",
      rotation: [ids.ava, ids.bella],
      schedule: { kind: "every", days: 1 },
      firstDue: "2026-10-05",
    });
    const reqId = await t.mutation(api.requests.create, {
      sessionToken: tokens.dad,
      toId: ids.ava,
      title: "Feed the dog",
    });
    await t.mutation(api.members.remove, { sessionToken: tokens.dad, memberId: ids.ava });
    expect(await t.query(api.auth.whoami, { sessionToken: tokens.ava })).toBeNull();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("privateNotes").collect()).toHaveLength(0);
      const job = (await ctx.db.get(jobId))!;
      expect(job.rotation).toEqual([ids.bella]);
      expect((await ctx.db.get(reqId))!.status).toBe("withdrawn");
    });
    await expectError(
      t.mutation(api.members.remove, { sessionToken: tokens.dad, memberId: ids.dad }),
      "INVALID",
    );
  });

  test("the last parent can't be demoted", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.mutation(api.members.update, { sessionToken: tokens.dad, memberId: ids.mom, role: "kid" });
    await expectError(
      t.mutation(api.members.update, { sessionToken: tokens.dad, memberId: ids.dad, role: "kid" }),
      "INVALID",
    );
  });

  test("kids can change their own picture but not their name", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.mutation(api.members.update, { sessionToken: tokens.ava, memberId: ids.ava, emoji: "🐙" });
    await expectError(
      t.mutation(api.members.update, { sessionToken: tokens.ava, memberId: ids.ava, name: "Queen Ava" }),
      "PARENT_ONLY",
    );
    await expectError(
      t.mutation(api.members.update, { sessionToken: tokens.ava, memberId: ids.bella, emoji: "💩" }),
      "PARENT_ONLY",
    );
  });
});

describe("maintenance", () => {
  test("cleanup drops expired codes", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    await t.action(api.auth.createPairingCode, { sessionToken: tokens.dad, purpose: "wall" });
    await t.run(async (ctx) => {
      for (const pc of await ctx.db.query("pairingCodes").collect()) {
        await ctx.db.patch(pc._id, { expiresAt: Date.now() - 2 * 86_400_000 });
      }
    });
    await t.mutation(internal.maintenance.cleanup, {});
    await t.run(async (ctx) => {
      expect(await ctx.db.query("pairingCodes").collect()).toHaveLength(0);
    });
  });
});

import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { actOnWall, expectError, newTest, setupFamily } from "./helpers";

describe("the door", () => {
  test("notes: pinned first, newest at the top of their group, and rearrangeable", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const post = (text: string, lifespan: "pinned" | "today" | "week" | "keep") =>
      t.mutation(api.notes.create, { sessionToken: tokens.dad, text, color: "yellow", lifespan });
    const a = await post("A", "keep");
    await post("Wifi: fridge123", "pinned");
    const c = await post("C", "week");
    let door = await t.query(api.notes.door, { sessionToken: tokens.dad });
    expect(door.map((n) => n.text)).toEqual(["Wifi: fridge123", "C", "A"]);

    // Drag A above C.
    await t.mutation(api.notes.move, { sessionToken: tokens.dad, noteId: a, beforeId: null, afterId: c });
    door = await t.query(api.notes.door, { sessionToken: tokens.dad });
    expect(door.map((n) => n.text)).toEqual(["Wifi: fridge123", "A", "C"]);
  });

  test("expiring notes archive themselves; anyone can restore", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const id = await t.mutation(api.notes.create, {
      sessionToken: tokens.ava,
      text: "Practice moved to 5",
      color: "blue",
      lifespan: "today",
    });
    const [note] = await t.query(api.notes.door, { sessionToken: tokens.dad });
    expect(note.expiresAt).toBeGreaterThan(Date.now());

    await t.run(async (ctx) => {
      await ctx.db.patch(id, { expiresAt: Date.now() - 1000 });
    });
    expect(await t.query(api.notes.door, { sessionToken: tokens.dad })).toHaveLength(0);
    expect(await t.mutation(internal.notes.archiveExpired, {})).toBe(1);
    const archived = await t.query(api.notes.archived, { sessionToken: tokens.dad });
    expect(archived).toMatchObject([{ text: "Practice moved to 5", expired: true }]);

    await t.mutation(api.notes.restore, { sessionToken: tokens.ava, noteId: id });
    const [back] = await t.query(api.notes.door, { sessionToken: tokens.dad });
    expect(back).toMatchObject({ text: "Practice moved to 5", lifespan: "keep", expiresAt: null });
  });

  test("anyone can take a note down, only parents can delete it for good", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const id = await t.mutation(api.notes.create, {
      sessionToken: tokens.dad,
      text: "Love you all",
      color: "pink",
      lifespan: "keep",
    });
    await actOnWall(t, tokens.wall, ids.cora);
    await t.mutation(api.notes.takeDown, { sessionToken: tokens.wall, noteId: id });
    expect(await t.query(api.notes.door, { sessionToken: tokens.dad })).toHaveLength(0);
    await expectError(t.mutation(api.notes.deleteForever, { sessionToken: tokens.wall, noteId: id }), "PARENT_ONLY");
    await expectError(t.mutation(api.notes.deleteForever, { sessionToken: tokens.ava, noteId: id }), "PARENT_ONLY");
    await t.mutation(api.notes.deleteForever, { sessionToken: tokens.mom, noteId: id });
    expect(await t.query(api.notes.archived, { sessionToken: tokens.dad })).toHaveLength(0);
  });

  test("only the author or a parent can edit", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const id = await t.mutation(api.notes.create, {
      sessionToken: tokens.ava,
      text: "Ava's note",
      color: "green",
      lifespan: "keep",
    });
    await t.mutation(api.notes.edit, { sessionToken: tokens.ava, noteId: id, text: "Ava's note!" });
    await t.mutation(api.notes.edit, { sessionToken: tokens.mom, noteId: id, color: "orange" });
    const [n] = await t.query(api.notes.door, { sessionToken: tokens.ava });
    expect(n).toMatchObject({ text: "Ava's note!", color: "orange", canEdit: true });
    const viewOfDad = await t.query(api.notes.door, { sessionToken: tokens.dad });
    expect(viewOfDad[0].canEdit).toBe(true);
  });

  test("'got it' is tapped by the recipient, never automatic", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const id = await t.mutation(api.notes.create, {
      sessionToken: tokens.dad,
      text: "Dentist Thursday 3pm",
      color: "yellow",
      lifespan: "week",
      toId: ids.ava,
    });
    // Reading it doesn't mark anything.
    await t.query(api.notes.door, { sessionToken: tokens.ava });
    expect((await t.query(api.notes.door, { sessionToken: tokens.dad }))[0].gotIt).toEqual([]);
    await expectError(t.mutation(api.notes.gotIt, { sessionToken: tokens.mom, noteId: id }), "NOT_ALLOWED");
    await expectError(t.mutation(api.notes.gotIt, { sessionToken: tokens.dad, noteId: id }), "NOT_ALLOWED");
    await t.mutation(api.notes.gotIt, { sessionToken: tokens.ava, noteId: id });
    await t.mutation(api.notes.gotIt, { sessionToken: tokens.ava, noteId: id });
    expect((await t.query(api.notes.door, { sessionToken: tokens.dad }))[0].gotIt).toEqual([ids.ava]);
  });

  test("notes need text or a picture and have a length limit", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    await expectError(
      t.mutation(api.notes.create, { sessionToken: tokens.dad, text: "  ", color: "yellow", lifespan: "keep" }),
      "INVALID",
    );
    await expectError(
      t.mutation(api.notes.create, {
        sessionToken: tokens.dad,
        text: "x".repeat(501),
        color: "yellow",
        lifespan: "keep",
      }),
      "INVALID",
    );
  });

  test("photo notes keep their picture", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const imageId = await t.run((ctx) => ctx.storage.store(new Blob(["fake png"], { type: "image/png" })));
    await t.mutation(api.notes.create, {
      sessionToken: tokens.ava,
      text: "",
      color: "white",
      lifespan: "keep",
      imageId,
      imageKind: "doodle",
    });
    const [n] = await t.query(api.notes.door, { sessionToken: tokens.dad });
    expect(n.imageKind).toBe("doodle");
    expect(n.imageUrl).toMatch(/^https?:\/\//);
  });
});

describe("private space", () => {
  test("only its owner can see or touch it - parents included", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const id = await t.mutation(api.mine.add, { sessionToken: tokens.ava, text: "Gift idea for Mom", color: "pink" });
    expect(await t.query(api.mine.list, { sessionToken: tokens.ava })).toMatchObject([{ text: "Gift idea for Mom" }]);
    expect(await t.query(api.mine.list, { sessionToken: tokens.dad })).toEqual([]);
    expect(await t.query(api.mine.list, { sessionToken: tokens.mom })).toEqual([]);
    await expectError(t.mutation(api.mine.toggleDone, { sessionToken: tokens.dad, id }), "NOT_FOUND");
    await expectError(t.mutation(api.mine.remove, { sessionToken: tokens.mom, id }), "NOT_FOUND");
    // Not on the door, not in the export.
    expect(JSON.stringify(await t.query(api.notes.door, { sessionToken: tokens.dad }))).not.toContain("Gift idea");
    const { json } = await t.action(api.exporter.download, { sessionToken: tokens.dad });
    expect(json).not.toContain("Gift idea");
    // On the wall, it needs Ava (with her PIN) tapped in.
    expect(await t.query(api.mine.list, { sessionToken: tokens.wall })).toBeNull();
    await actOnWall(t, tokens.wall, ids.ava);
    expect(await t.query(api.mine.list, { sessionToken: tokens.wall })).toHaveLength(1);
    await t.mutation(api.mine.toggleDone, { sessionToken: tokens.ava, id });
    await t.mutation(api.mine.remove, { sessionToken: tokens.ava, id });
    expect(await t.query(api.mine.list, { sessionToken: tokens.ava })).toEqual([]);
  });
});

describe("status", () => {
  test("coarse, opt-in, same for everyone, and only for today", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    await t.mutation(api.members.setStatus, { sessionToken: tokens.ava, status: "practice" });
    await t.mutation(api.members.setStatus, { sessionToken: tokens.dad, status: "work" });
    let who = await t.query(api.auth.whoami, { sessionToken: tokens.wall });
    expect(who!.members.find((m) => m._id === ids.ava)!.status).toBe("practice");
    expect(who!.members.find((m) => m._id === ids.dad)!.status).toBe("work");
    expect(who!.members.find((m) => m._id === ids.cora)!.status).toBeNull();
    await t.run(async (ctx) => {
      const ava = (await ctx.db.get(ids.ava))!;
      await ctx.db.patch(ids.ava, { status: { ...ava.status!, setAt: Date.now() - 2 * 86_400_000 } });
    });
    who = await t.query(api.auth.whoami, { sessionToken: tokens.wall });
    expect(who!.members.find((m) => m._id === ids.ava)!.status).toBeNull();
    expect(await t.mutation(internal.maintenance.clearStaleStatuses, {})).toBe(1);
  });
});

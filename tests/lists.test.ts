import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { actOnWall, expectError, newTest, setupFamily } from "./helpers";

describe("shared lists", () => {
  test("anyone adds; duplicates merge; re-adding a ticked item brings it back", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const [groceries] = await t.query(api.lists.all, { sessionToken: tokens.dad });
    const listId = groceries._id;
    const milk = await t.mutation(api.lists.addItem, { sessionToken: tokens.ava, listId, text: "Milk" });
    await t.mutation(api.lists.addItem, { sessionToken: tokens.dad, listId, text: "Eggs" });
    expect(await t.mutation(api.lists.addItem, { sessionToken: tokens.mom, listId, text: "milk" })).toBe(milk);

    await t.mutation(api.lists.toggleItem, { sessionToken: tokens.dad, itemId: milk });
    let got = (await t.query(api.lists.get, { sessionToken: tokens.dad, listId }))!;
    expect(got.items.map((i) => [i.text, i.checkedBy])).toEqual([
      ["Eggs", null],
      ["Milk", ids.dad],
    ]);

    await t.mutation(api.lists.addItem, { sessionToken: tokens.ava, listId, text: "MILK" });
    got = (await t.query(api.lists.get, { sessionToken: tokens.dad, listId }))!;
    expect(got.items.map((i) => [i.text, i.checkedAt])).toEqual([
      ["Eggs", null],
      ["Milk", null],
    ]);
    expect((await t.query(api.lists.all, { sessionToken: tokens.dad }))[0].openCount).toBe(2);
  });

  test("drag to reorder only rewrites one row", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const [{ _id: listId }] = await t.query(api.lists.all, { sessionToken: tokens.dad });
    const a = await t.mutation(api.lists.addItem, { sessionToken: tokens.dad, listId, text: "A" });
    const b = await t.mutation(api.lists.addItem, { sessionToken: tokens.dad, listId, text: "B" });
    const c = await t.mutation(api.lists.addItem, { sessionToken: tokens.dad, listId, text: "C" });
    const before = await t.run((ctx) => Promise.all([a, b].map((id) => ctx.db.get(id))));
    await t.mutation(api.lists.moveItem, { sessionToken: tokens.dad, itemId: c, beforeId: a, afterId: b });
    const got = (await t.query(api.lists.get, { sessionToken: tokens.dad, listId }))!;
    expect(got.items.map((i) => i.text)).toEqual(["A", "C", "B"]);
    const after = await t.run((ctx) => Promise.all([a, b].map((id) => ctx.db.get(id))));
    expect(after.map((d) => d!.sortKey)).toEqual(before.map((d) => d!.sortKey));
  });

  test("clear ticked items", async () => {
    const t = newTest();
    const { tokens } = await setupFamily(t);
    const [{ _id: listId }] = await t.query(api.lists.all, { sessionToken: tokens.dad });
    const a = await t.mutation(api.lists.addItem, { sessionToken: tokens.dad, listId, text: "A" });
    await t.mutation(api.lists.addItem, { sessionToken: tokens.dad, listId, text: "B" });
    await t.mutation(api.lists.toggleItem, { sessionToken: tokens.ava, itemId: a });
    expect(await t.mutation(api.lists.clearChecked, { sessionToken: tokens.ava, listId })).toBe(1);
    expect((await t.query(api.lists.get, { sessionToken: tokens.dad, listId }))!.items).toHaveLength(1);
  });

  test("each list has an owner; only the owner or a parent can hand it over", async () => {
    const t = newTest();
    const { tokens, ids } = await setupFamily(t);
    const listId = await t.mutation(api.lists.create, {
      sessionToken: tokens.ava,
      name: "Birthday party",
      emoji: "🎈",
      ownerId: ids.ava,
      standard: "Invites out 2 weeks before",
    });
    await actOnWall(t, tokens.wall, ids.bella);
    await expectError(
      t.mutation(api.lists.update, { sessionToken: tokens.wall, listId, ownerId: ids.bella }),
      "NOT_ALLOWED",
    );
    const [groceries] = await t.query(api.lists.all, { sessionToken: tokens.ava });
    await expectError(
      t.mutation(api.lists.update, { sessionToken: tokens.ava, listId: groceries._id, ownerId: ids.ava }),
      "NOT_ALLOWED",
    );
    // Dad owns groceries and hands it to Mom at the weekly re-deal.
    await t.mutation(api.lists.update, {
      sessionToken: tokens.dad,
      listId: groceries._id,
      ownerId: ids.mom,
      standard: "Never out of milk, bread or fruit",
    });
    const all = await t.query(api.lists.all, { sessionToken: tokens.ava });
    expect(all.map((l) => [l.name, l.ownerId, l.standard])).toEqual([
      ["Groceries", ids.mom, "Never out of milk, bread or fruit"],
      ["Birthday party", ids.ava, "Invites out 2 weeks before"],
    ]);
    await expectError(t.mutation(api.lists.archive, { sessionToken: tokens.ava, listId }), "PARENT_ONLY");
    await t.mutation(api.lists.archive, { sessionToken: tokens.dad, listId });
    expect(await t.query(api.lists.get, { sessionToken: tokens.dad, listId })).toBeNull();
  });
});

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  cleanText,
  fail,
  getMemberInHousehold,
  getOwned,
  householdMutation,
  householdQuery,
  requireActor,
  requireParent,
} from "./lib/session";
import { byKey, keyAtEnd, keyBetween } from "./lib/order";

const ITEM_MAX = 120;
const ITEMS_PER_LIST = 500;

async function itemsOf(ctx: { db: QueryCtx["db"] }, listId: Id<"lists">) {
  return await ctx.db
    .query("listItems")
    .withIndex("by_list", (q) => q.eq("listId", listId))
    .collect();
}

async function activeLists(ctx: { db: QueryCtx["db"] }, householdId: Id<"households">) {
  return (
    await ctx.db
      .query("lists")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect()
  )
    .filter((l) => l.archivedAt === undefined)
    .sort(byKey);
}

export const all = householdQuery({
  args: {},
  handler: async (ctx) => {
    const lists = await activeLists(ctx, ctx.s.household._id);
    const out = [];
    for (const l of lists) {
      const items = await itemsOf(ctx, l._id);
      out.push({
        _id: l._id,
        name: l.name,
        emoji: l.emoji,
        ownerId: l.ownerId,
        standard: l.standard ?? null,
        openCount: items.filter((i) => i.checkedAt === undefined).length,
        preview: items
          .filter((i) => i.checkedAt === undefined)
          .sort(byKey)
          .slice(0, 3)
          .map((i) => i.text),
      });
    }
    return out;
  },
});

export const get = householdQuery({
  args: { listId: v.id("lists") },
  handler: async (ctx, { listId }) => {
    const l = await ctx.db.get(listId);
    if (!l || l.householdId !== ctx.s.household._id || l.archivedAt !== undefined) return null;
    const items = await itemsOf(ctx, listId);
    const open = items.filter((i) => i.checkedAt === undefined).sort(byKey);
    const done = items
      .filter((i) => i.checkedAt !== undefined)
      .sort((a, b) => b.checkedAt! - a.checkedAt!);
    return {
      list: {
        _id: l._id,
        name: l.name,
        emoji: l.emoji,
        ownerId: l.ownerId,
        standard: l.standard ?? null,
        canManage: ctx.s.isParentAccount || ctx.s.viewer?._id === l.ownerId,
      },
      items: [...open, ...done].map((i) => ({
        _id: i._id,
        text: i.text,
        addedBy: i.addedBy,
        sortKey: i.sortKey,
        checkedAt: i.checkedAt ?? null,
        checkedBy: i.checkedBy ?? null,
      })),
    };
  },
});

export const create = householdMutation({
  args: {
    name: v.string(),
    emoji: v.string(),
    ownerId: v.id("members"),
    standard: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    requireActor(ctx.s);
    const owner = await getMemberInHousehold(ctx, ctx.s, a.ownerId);
    const lists = await activeLists(ctx, ctx.s.household._id);
    if (lists.length >= 50) fail("INVALID", "That's a lot of lists. Archive some first.");
    return await ctx.db.insert("lists", {
      householdId: ctx.s.household._id,
      name: cleanText(a.name, 40, "List name"),
      emoji: a.emoji || "📝",
      ownerId: owner._id,
      standard: a.standard?.trim().slice(0, 280) || undefined,
      sortKey: keyAtEnd(lists),
      createdAt: Date.now(),
    });
  },
});

/** The owner (or a parent) can rename, change the standard, or hand it over. */
export const update = householdMutation({
  args: {
    listId: v.id("lists"),
    name: v.optional(v.string()),
    emoji: v.optional(v.string()),
    ownerId: v.optional(v.id("members")),
    standard: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const me = requireActor(ctx.s);
    const l = await getOwned(ctx, ctx.s, a.listId);
    if (!ctx.s.isParentAccount && me._id !== l.ownerId) {
      fail("NOT_ALLOWED", "Only the list's owner or a parent can change it.");
    }
    const patch: Partial<Doc<"lists">> = {};
    if (a.name !== undefined) patch.name = cleanText(a.name, 40, "List name");
    if (a.emoji) patch.emoji = a.emoji;
    if (a.ownerId) patch.ownerId = (await getMemberInHousehold(ctx, ctx.s, a.ownerId))._id;
    if (a.standard !== undefined) patch.standard = a.standard.trim().slice(0, 280) || undefined;
    await ctx.db.patch(l._id, patch);
    return null;
  },
});

export const archive = householdMutation({
  args: { listId: v.id("lists") },
  handler: async (ctx, { listId }) => {
    requireParent(ctx.s);
    const l = await getOwned(ctx, ctx.s, listId);
    await ctx.db.patch(l._id, { archivedAt: Date.now() });
    return null;
  },
});

/** Anyone can add. Re-adding something already ticked brings it back. */
export const addItem = householdMutation({
  args: { listId: v.id("lists"), text: v.string() },
  handler: async (ctx, a) => {
    const me = requireActor(ctx.s);
    const l = await getOwned(ctx, ctx.s, a.listId);
    if (l.archivedAt !== undefined) fail("NOT_FOUND", "That list was archived.");
    const text = cleanText(a.text, ITEM_MAX, "Item");
    const items = await itemsOf(ctx, l._id);
    const open = items.filter((i) => i.checkedAt === undefined).sort(byKey);
    const same = items.find((i) => i.text.toLowerCase() === text.toLowerCase());
    if (same && same.checkedAt === undefined) return same._id;
    if (same) {
      await ctx.db.patch(same._id, {
        checkedAt: undefined,
        checkedBy: undefined,
        sortKey: keyAtEnd(open),
        addedBy: me._id,
      });
      return same._id;
    }
    if (items.length >= ITEMS_PER_LIST) fail("INVALID", "This list is full. Clear the ticked items.");
    return await ctx.db.insert("listItems", {
      householdId: ctx.s.household._id,
      listId: l._id,
      text,
      addedBy: me._id,
      sortKey: keyAtEnd(open),
      createdAt: Date.now(),
    });
  },
});

export const toggleItem = householdMutation({
  args: { itemId: v.id("listItems") },
  handler: async (ctx, { itemId }) => {
    const me = requireActor(ctx.s);
    const item = await getOwned(ctx, ctx.s, itemId);
    if (item.checkedAt === undefined) {
      await ctx.db.patch(itemId, { checkedAt: Date.now(), checkedBy: me._id });
    } else {
      const open = (await itemsOf(ctx, item.listId)).filter((i) => i.checkedAt === undefined).sort(byKey);
      await ctx.db.patch(itemId, { checkedAt: undefined, checkedBy: undefined, sortKey: keyAtEnd(open) });
    }
    return null;
  },
});

export const editItem = householdMutation({
  args: { itemId: v.id("listItems"), text: v.string() },
  handler: async (ctx, a) => {
    requireActor(ctx.s);
    await getOwned(ctx, ctx.s, a.itemId);
    await ctx.db.patch(a.itemId, { text: cleanText(a.text, ITEM_MAX, "Item") });
    return null;
  },
});

export const removeItem = householdMutation({
  args: { itemId: v.id("listItems") },
  handler: async (ctx, { itemId }) => {
    requireActor(ctx.s);
    await getOwned(ctx, ctx.s, itemId);
    await ctx.db.delete(itemId);
    return null;
  },
});

/** Drag to reorder: one row changes, using a key between its new neighbours. */
export const moveItem = householdMutation({
  args: {
    itemId: v.id("listItems"),
    beforeId: v.union(v.id("listItems"), v.null()),
    afterId: v.union(v.id("listItems"), v.null()),
  },
  handler: async (ctx, a) => {
    requireActor(ctx.s);
    const item = await getOwned(ctx, ctx.s, a.itemId);
    const before = a.beforeId ? await getOwned(ctx, ctx.s, a.beforeId) : null;
    const after = a.afterId ? await getOwned(ctx, ctx.s, a.afterId) : null;
    for (const n of [before, after]) {
      if (n && n.listId !== item.listId) fail("INVALID", "Items can only move within a list.");
    }
    let sortKey: string;
    if (before && after && before.sortKey < after.sortKey) sortKey = keyBetween(before.sortKey, after.sortKey);
    else if (before) sortKey = keyBetween(before.sortKey, null);
    else if (after) sortKey = keyBetween(null, after.sortKey);
    else return null;
    await ctx.db.patch(item._id, { sortKey });
    return null;
  },
});

export const clearChecked = householdMutation({
  args: { listId: v.id("lists") },
  handler: async (ctx, { listId }) => {
    requireActor(ctx.s);
    const l = await getOwned(ctx, ctx.s, listId);
    let n = 0;
    for (const i of await itemsOf(ctx, l._id)) {
      if (i.checkedAt !== undefined) {
        await ctx.db.delete(i._id);
        n++;
      }
    }
    return n;
  },
});

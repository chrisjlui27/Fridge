import { v } from "convex/values";
import { internalMutation, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { lifespan, noteColor } from "./schema";
import {
  fail,
  getMemberInHousehold,
  getOwned,
  householdMutation,
  householdQuery,
  requireActor,
  requireParent,
  type SessionInfo,
} from "./lib/session";
import { byKey, keyAtStart, keyBetween } from "./lib/order";
import { endOfToday, endOfWeek } from "./lib/time";
import { queuePing } from "./lib/notify";

const NOTE_MAX = 500;
const ARCHIVE_SHOWN_DAYS = 30;

type Lifespan = Doc<"notes">["lifespan"];

function expiryFor(l: Lifespan, now: number, tz: string): number | undefined {
  if (l === "today") return endOfToday(now, tz);
  if (l === "week") return endOfWeek(now, tz);
  return undefined;
}

async function activeNotes(ctx: { db: QueryCtx["db"] }, householdId: Id<"households">) {
  return await ctx.db
    .query("notes")
    .withIndex("by_household_archived", (q) =>
      q.eq("householdId", householdId).eq("archivedAt", undefined),
    )
    .collect();
}

function canEdit(s: SessionInfo, note: Doc<"notes">) {
  return s.isParentAccount || s.viewer?._id === note.authorId;
}

/** Everything currently on the door: pinned first, then in the family's order. */
export const door = householdQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const notes = (await activeNotes(ctx, ctx.s.household._id))
      .filter((n) => n.expiresAt === undefined || n.expiresAt > now)
      .sort(byKey);
    const pinned = notes.filter((n) => n.lifespan === "pinned");
    const rest = notes.filter((n) => n.lifespan !== "pinned");
    const out = [];
    for (const n of [...pinned, ...rest]) {
      const reactions = await ctx.db
        .query("reactions")
        .withIndex("by_note", (q) => q.eq("noteId", n._id))
        .collect();
      out.push({
        _id: n._id,
        authorId: n.authorId,
        toId: n.toId ?? null,
        text: n.text,
        color: n.color,
        lifespan: n.lifespan,
        expiresAt: n.expiresAt ?? null,
        imageUrl: n.imageId ? await ctx.storage.getUrl(n.imageId) : null,
        imageKind: n.imageKind ?? null,
        createdAt: n.createdAt,
        editedAt: n.editedAt ?? null,
        sortKey: n.sortKey,
        gotIt: reactions.filter((r) => r.kind === "gotit").map((r) => r.fromId),
        canEdit: canEdit(ctx.s, n),
      });
    }
    return out;
  },
});

export const generateUploadUrl = householdMutation({
  args: {},
  handler: async (ctx) => {
    requireActor(ctx.s);
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = householdMutation({
  args: {
    text: v.string(),
    color: noteColor,
    toId: v.optional(v.id("members")),
    lifespan,
    imageId: v.optional(v.id("_storage")),
    imageKind: v.optional(v.union(v.literal("photo"), v.literal("doodle"))),
    ping: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const me = requireActor(ctx.s);
    const text = a.text.trim();
    if (!text && !a.imageId) fail("INVALID", "Write something or add a picture.");
    if (text.length > NOTE_MAX) fail("INVALID", `Notes are limited to ${NOTE_MAX} characters.`);
    const to = a.toId ? await getMemberInHousehold(ctx, ctx.s, a.toId) : null;
    if (a.imageId && !(await ctx.db.system.get(a.imageId))) fail("INVALID", "That picture didn't upload.");

    const now = Date.now();
    const sorted = (await activeNotes(ctx, ctx.s.household._id)).sort(byKey);
    const id = await ctx.db.insert("notes", {
      householdId: ctx.s.household._id,
      authorId: me._id,
      text,
      color: a.color,
      toId: to?._id,
      imageId: a.imageId,
      imageKind: a.imageId ? a.imageKind ?? "photo" : undefined,
      lifespan: a.lifespan,
      expiresAt: expiryFor(a.lifespan, now, ctx.s.household.timezone),
      sortKey: keyAtStart(sorted),
      createdAt: now,
    });
    if (a.ping && to && to._id !== me._id) {
      await queuePing(ctx, ctx.s.household, to._id, {
        title: `Note from ${me.name}`,
        body: text || "Sent you a picture",
        url: "/",
        tag: `note-${id}`,
      });
    }
    return id;
  },
});

export const edit = householdMutation({
  args: {
    noteId: v.id("notes"),
    text: v.optional(v.string()),
    color: v.optional(noteColor),
    lifespan: v.optional(lifespan),
    toId: v.optional(v.union(v.id("members"), v.null())),
  },
  handler: async (ctx, a) => {
    requireActor(ctx.s);
    const note = await getOwned(ctx, ctx.s, a.noteId);
    if (!canEdit(ctx.s, note)) fail("NOT_ALLOWED", "Only the person who wrote it (or a parent) can edit it.");
    const patch: Partial<Doc<"notes">> = { editedAt: Date.now() };
    if (a.text !== undefined) {
      const text = a.text.trim();
      if (!text && !note.imageId) fail("INVALID", "Write something or add a picture.");
      if (text.length > NOTE_MAX) fail("INVALID", `Notes are limited to ${NOTE_MAX} characters.`);
      patch.text = text;
    }
    if (a.color) patch.color = a.color;
    if (a.lifespan) {
      patch.lifespan = a.lifespan;
      patch.expiresAt = expiryFor(a.lifespan, Date.now(), ctx.s.household.timezone);
    }
    if (a.toId !== undefined) {
      patch.toId = a.toId === null ? undefined : (await getMemberInHousehold(ctx, ctx.s, a.toId))._id;
    }
    await ctx.db.patch(note._id, patch);
    return null;
  },
});

/** Rearrange: place a note between two neighbours (in the same group). */
export const move = householdMutation({
  args: {
    noteId: v.id("notes"),
    beforeId: v.union(v.id("notes"), v.null()),
    afterId: v.union(v.id("notes"), v.null()),
  },
  handler: async (ctx, a) => {
    requireActor(ctx.s);
    const note = await getOwned(ctx, ctx.s, a.noteId);
    const before = a.beforeId ? await getOwned(ctx, ctx.s, a.beforeId) : null;
    const after = a.afterId ? await getOwned(ctx, ctx.s, a.afterId) : null;
    let sortKey: string;
    if (before && after && before.sortKey < after.sortKey) sortKey = keyBetween(before.sortKey, after.sortKey);
    else if (before && !after) sortKey = keyBetween(before.sortKey, null);
    else if (after && !before) sortKey = keyBetween(null, after.sortKey);
    else if (before) sortKey = keyBetween(before.sortKey, null);
    else return null;
    await ctx.db.patch(note._id, { sortKey });
    return null;
  },
});

/** Anyone can take a note down. It goes to "taken down", not the bin. */
export const takeDown = householdMutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, { noteId }) => {
    const me = requireActor(ctx.s);
    const note = await getOwned(ctx, ctx.s, noteId);
    if (note.archivedAt === undefined) {
      await ctx.db.patch(noteId, { archivedAt: Date.now(), archivedBy: me._id });
    }
    return null;
  },
});

export const restore = householdMutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, { noteId }) => {
    requireActor(ctx.s);
    const note = await getOwned(ctx, ctx.s, noteId);
    const now = Date.now();
    const sorted = (await activeNotes(ctx, ctx.s.household._id)).sort(byKey);
    const expired = note.expiresAt !== undefined && note.expiresAt <= now;
    await ctx.db.patch(noteId, {
      archivedAt: undefined,
      archivedBy: undefined,
      sortKey: keyAtStart(sorted),
      ...(expired ? { lifespan: "keep" as const, expiresAt: undefined } : {}),
    });
    return null;
  },
});

export const archived = householdQuery({
  args: {},
  handler: async (ctx) => {
    const since = Date.now() - ARCHIVE_SHOWN_DAYS * 86_400_000;
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_household_archived", (q) =>
        q.eq("householdId", ctx.s.household._id).gt("archivedAt", since),
      )
      .order("desc")
      .take(60);
    const out = [];
    for (const n of notes) {
      out.push({
        _id: n._id,
        authorId: n.authorId,
        toId: n.toId ?? null,
        text: n.text,
        color: n.color,
        imageUrl: n.imageId ? await ctx.storage.getUrl(n.imageId) : null,
        archivedAt: n.archivedAt!,
        archivedBy: n.archivedBy ?? null,
        expired: n.archivedBy === undefined,
      });
    }
    return out;
  },
});

/** Permanent delete: parents only, from their own sign-in. */
export const deleteForever = householdMutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, { noteId }) => {
    requireParent(ctx.s);
    const note = await getOwned(ctx, ctx.s, noteId);
    for (const r of await ctx.db
      .query("reactions")
      .withIndex("by_note", (q) => q.eq("noteId", noteId))
      .collect()) {
      await ctx.db.delete(r._id);
    }
    if (note.imageId) await ctx.storage.delete(note.imageId);
    await ctx.db.delete(noteId);
    return null;
  },
});

/** "Got it" is something the recipient taps - never recorded automatically. */
export const gotIt = householdMutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, { noteId }) => {
    const me = requireActor(ctx.s);
    const note = await getOwned(ctx, ctx.s, noteId);
    if (note.toId && note.toId !== me._id) fail("NOT_ALLOWED", "This note is for someone else.");
    if (note.authorId === me._id) fail("NOT_ALLOWED", "That's your own note.");
    const existing = await ctx.db
      .query("reactions")
      .withIndex("by_note", (q) => q.eq("noteId", noteId))
      .collect();
    if (existing.some((r) => r.kind === "gotit" && r.fromId === me._id)) return null;
    await ctx.db.insert("reactions", {
      householdId: ctx.s.household._id,
      fromId: me._id,
      kind: "gotit",
      noteId,
      at: Date.now(),
    });
    return null;
  },
});

/** Cron: move expired notes off the door so it doesn't silt up. */
export const archiveExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("notes")
      .withIndex("by_expiry", (q) => q.eq("archivedAt", undefined).gt("expiresAt", 0).lte("expiresAt", now))
      .take(500);
    for (const n of expired) {
      if (n.expiresAt !== undefined && n.expiresAt <= now) await ctx.db.patch(n._id, { archivedAt: now });
    }
    return expired.length;
  },
});

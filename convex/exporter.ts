import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { fail, householdQuery, requireParent } from "./lib/session";

/**
 * Your data, in a file you keep. One-tap download for parents, plus a nightly
 * snapshot (kept for 14 nights) and an optional POST to EXPORT_WEBHOOK_URL.
 *
 * Never exported: password/PIN hashes, session tokens, pairing codes, push
 * keys, and anyone's private space.
 */

const KEEP_NIGHTLY = 14;

export const core = internalQuery({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => {
    const household = await ctx.db.get(householdId);
    if (!household) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_household_archived", (q) => q.eq("householdId", householdId))
      .collect();
    const lists = await ctx.db
      .query("lists")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const feeds = await ctx.db
      .query("calendarFeeds")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect();
    const listOut = [];
    for (const l of lists) {
      const items = await ctx.db
        .query("listItems")
        .withIndex("by_list", (q) => q.eq("listId", l._id))
        .collect();
      listOut.push({
        id: l._id,
        name: l.name,
        emoji: l.emoji,
        owner: l.ownerId,
        standard: l.standard ?? null,
        archivedAt: l.archivedAt ?? null,
        items: items.map((i) => ({
          text: i.text,
          addedBy: i.addedBy,
          createdAt: i.createdAt,
          checkedAt: i.checkedAt ?? null,
          checkedBy: i.checkedBy ?? null,
        })),
      });
    }
    const noteOut = [];
    for (const n of notes) {
      noteOut.push({
        id: n._id,
        author: n.authorId,
        to: n.toId ?? null,
        text: n.text,
        color: n.color,
        lifespan: n.lifespan,
        createdAt: n.createdAt,
        expiresAt: n.expiresAt ?? null,
        archivedAt: n.archivedAt ?? null,
        image: n.imageId ? await ctx.storage.getUrl(n.imageId) : null,
      });
    }
    return {
      format: "fridge-door-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      household: { name: household.name, timezone: household.timezone, createdAt: household.createdAt },
      members: members.map((m) => ({
        id: m._id,
        name: m.name,
        role: m.role,
        emoji: m.emoji,
        color: m.color,
        removedAt: m.removedAt ?? null,
      })),
      notes: noteOut,
      lists: listOut,
      requests: requests.map((r) => ({
        id: r._id,
        from: r.fromId,
        to: r.toId,
        title: r.title,
        details: r.details ?? null,
        dueDate: r.dueDate ?? null,
        dueTime: r.dueTime ?? null,
        status: r.status,
        reply: r.reply ?? null,
        createdAt: r.createdAt,
        doneAt: r.doneAt ?? null,
      })),
      jobs: jobs.map((j) => ({
        id: j._id,
        title: j.title,
        emoji: j.emoji,
        rotation: j.rotation,
        turn: j.turn,
        schedule: j.schedule,
        nextDue: j.nextDue,
        notes: j.notes ?? null,
        archivedAt: j.archivedAt ?? null,
      })),
      calendars: feeds.map((f) => ({ name: f.name, url: f.url, color: f.color })),
    };
  },
});

/** Completions and reactions grow forever, so they're read a page at a time. */
export const logPage = internalQuery({
  args: {
    householdId: v.id("households"),
    table: v.union(v.literal("completions"), v.literal("reactions")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { householdId, table, paginationOpts }) => {
    const page = await ctx.db
      .query(table)
      .withIndex("by_household_at", (q) => q.eq("householdId", householdId))
      .paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map((d) => {
        const { _id, _creationTime, householdId: _h, ...rest } = d as typeof d & { householdId: unknown };
        return { id: _id, ...rest };
      }),
    };
  },
});

async function buildExport(
  ctx: { runQuery: import("./_generated/server").ActionCtx["runQuery"] },
  householdId: Id<"households">,
): Promise<string | null> {
  const core = await ctx.runQuery(internal.exporter.core, { householdId });
  if (!core) return null;
  const logs: Record<"completions" | "reactions", unknown[]> = { completions: [], reactions: [] };
  for (const table of ["completions", "reactions"] as const) {
    let cursor: string | null = null;
    for (;;) {
      const res: { page: unknown[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(
        internal.exporter.logPage,
        { householdId, table, paginationOpts: { numItems: 1000, cursor } },
      );
      logs[table].push(...res.page);
      if (res.isDone) break;
      cursor = res.continueCursor;
    }
  }
  return JSON.stringify({ ...core, ...logs }, null, 2);
}

/** One-tap export (parents). */
export const download = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }): Promise<{ filename: string; json: string }> => {
    const info = await ctx.runQuery(internal.auth.sessionContext, { sessionToken });
    if (!info?.isParentAccount) {
      fail("PARENT_ONLY", "A parent needs to do this from their own signed-in phone or laptop.");
    }
    const json = await buildExport(ctx, info.householdId);
    if (!json) fail("NOT_FOUND", "Household not found.");
    const date = new Date().toISOString().slice(0, 10);
    return { filename: `fridge-export-${date}.json`, json };
  },
});

export const recent = householdQuery({
  args: {},
  handler: async (ctx) => {
    requireParent(ctx.s);
    const rows = await ctx.db
      .query("exports")
      .withIndex("by_household", (q) => q.eq("householdId", ctx.s.household._id))
      .order("desc")
      .take(KEEP_NIGHTLY);
    const out = [];
    for (const r of rows) {
      out.push({ _id: r._id, createdAt: r.createdAt, bytes: r.bytes, url: await ctx.storage.getUrl(r.storageId) });
    }
    return out;
  },
});

export const householdIds = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("households").collect()).map((h) => h._id),
});

export const nightly = internalAction({
  args: {},
  handler: async (ctx) => {
    const webhook = process.env.EXPORT_WEBHOOK_URL;
    for (const householdId of await ctx.runQuery(internal.exporter.householdIds, {})) {
      const json = await buildExport(ctx, householdId);
      if (!json) continue;
      const blob = new Blob([json], { type: "application/json" });
      const storageId = await ctx.storage.store(blob);
      await ctx.runMutation(internal.exporter.record, { householdId, storageId, bytes: blob.size });
      if (webhook) {
        try {
          const res = await fetch(webhook, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(process.env.EXPORT_WEBHOOK_SECRET
                ? { Authorization: `Bearer ${process.env.EXPORT_WEBHOOK_SECRET}` }
                : {}),
            },
            body: json,
          });
          if (!res.ok) console.error("Export webhook failed", res.status);
        } catch (e) {
          console.error("Export webhook failed", (e as Error).message);
        }
      }
    }
  },
});

export const record = internalMutation({
  args: { householdId: v.id("households"), storageId: v.id("_storage"), bytes: v.number() },
  handler: async (ctx, a) => {
    await ctx.db.insert("exports", { ...a, createdAt: Date.now() });
    const all = await ctx.db
      .query("exports")
      .withIndex("by_household", (q) => q.eq("householdId", a.householdId))
      .order("desc")
      .collect();
    for (const old of all.slice(KEEP_NIGHTLY)) {
      await ctx.storage.delete(old.storageId);
      await ctx.db.delete(old._id);
    }
  },
});

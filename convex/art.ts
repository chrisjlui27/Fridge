import { v } from "convex/values";
import { householdQuery } from "./lib/session";

/**
 * The art wall: every photo and doodle that has been on the door, newest
 * first - including ones taken down long ago. Only a parent's "delete for
 * good" removes something from here.
 */
export const list = householdQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const n = Math.min(Math.max(Math.floor(limit ?? 48), 1), 300);
    const now = Date.now();
    const kinds = ["photo", "doodle"] as const;
    const rows = (
      await Promise.all(
        kinds.map((kind) =>
          ctx.db
            .query("notes")
            .withIndex("by_household_image", (q) => q.eq("householdId", ctx.s.household._id).eq("imageKind", kind))
            .order("desc")
            .take(n + 1),
        ),
      )
    )
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt);
    const items = [];
    for (const note of rows.slice(0, n)) {
      if (!note.imageId) continue;
      items.push({
        _id: note._id,
        imageUrl: await ctx.storage.getUrl(note.imageId),
        imageKind: note.imageKind!,
        text: note.text,
        authorId: note.authorId,
        createdAt: note.createdAt,
        onDoor: note.archivedAt === undefined && (note.expiresAt === undefined || note.expiresAt > now),
      });
    }
    return { items, hasMore: rows.length > n };
  },
});

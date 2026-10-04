import { v } from "convex/values";
import { noteColor } from "./schema";
import {
  cleanText,
  fail,
  householdMutation,
  householdQuery,
  requireActor,
  type SessionInfo,
} from "./lib/session";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * "My space": private notes only their owner can see. Parents can't read a
 * kid's space in the app (whoever runs the database technically can).
 */

async function ownNote(ctx: QueryCtx, s: SessionInfo, id: Id<"privateNotes">) {
  const me = requireActor(s);
  const n = await ctx.db.get(id);
  if (!n || n.memberId !== me._id) fail("NOT_FOUND", "That's not here any more.");
  return n;
}

export const list = householdQuery({
  args: {},
  handler: async (ctx) => {
    // On the wall with nobody tapped in there is no "me" - show nothing.
    const me = ctx.s.viewer;
    if (!me) return null;
    const notes = await ctx.db
      .query("privateNotes")
      .withIndex("by_member", (q) => q.eq("memberId", me._id))
      .collect();
    return notes
      .map((n) => ({
        _id: n._id,
        text: n.text,
        color: n.color,
        createdAt: n.createdAt,
        doneAt: n.doneAt ?? null,
      }))
      .sort((a, b) => {
        if ((a.doneAt === null) !== (b.doneAt === null)) return a.doneAt === null ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
  },
});

export const add = householdMutation({
  args: { text: v.string(), color: noteColor },
  handler: async (ctx, { text, color }) => {
    const me = requireActor(ctx.s);
    return await ctx.db.insert("privateNotes", {
      householdId: ctx.s.household._id,
      memberId: me._id,
      text: cleanText(text, 1000, "Note"),
      color,
      createdAt: Date.now(),
    });
  },
});

export const toggleDone = householdMutation({
  args: { id: v.id("privateNotes") },
  handler: async (ctx, { id }) => {
    const n = await ownNote(ctx, ctx.s, id);
    await ctx.db.patch(id, { doneAt: n.doneAt ? undefined : Date.now() });
    return null;
  },
});

export const remove = householdMutation({
  args: { id: v.id("privateNotes") },
  handler: async (ctx, { id }) => {
    await ownNote(ctx, ctx.s, id);
    await ctx.db.delete(id);
    return null;
  },
});

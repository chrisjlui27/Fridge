import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function deleteSession(ctx: MutationCtx, sessionId: Id<"sessions">) {
  const subs = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  for (const sub of subs) await ctx.db.delete(sub._id);
  await ctx.db.delete(sessionId);
}

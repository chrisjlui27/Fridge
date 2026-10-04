import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { msUntilQuietEnds } from "./time";
import { DEFAULT_QUIET_END, DEFAULT_QUIET_START } from "./constants";

export type PushMessage = { title: string; body: string; url: string; tag?: string };

/**
 * Send a push to one person, but only if they turned notifications on for at
 * least one device. During their quiet hours it waits until quiet hours end.
 * Never used for automatic re-pings about undone chores.
 */
export async function queuePing(
  ctx: MutationCtx,
  household: Doc<"households">,
  memberId: Id<"members">,
  msg: PushMessage,
) {
  const sub = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .first();
  if (!sub) return;
  const m = await ctx.db.get(memberId);
  if (!m || m.removedAt !== undefined) return;
  const delay = msUntilQuietEnds(
    Date.now(),
    household.timezone,
    m.quietStart ?? DEFAULT_QUIET_START,
    m.quietEnd ?? DEFAULT_QUIET_END,
  );
  await ctx.scheduler.runAfter(delay, internal.pushNode.send, { memberId, ...msg });
}

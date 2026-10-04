import { internalMutation } from "./_generated/server";
import { localDay } from "./lib/time";
import { deleteSession } from "./lib/cleanup";

/** Statuses are for today only; yesterday's "Out" shouldn't linger. */
export const clearStaleStatuses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let cleared = 0;
    for (const h of await ctx.db.query("households").collect()) {
      const today = localDay(now, h.timezone);
      for (const m of await ctx.db
        .query("members")
        .withIndex("by_household", (q) => q.eq("householdId", h._id))
        .collect()) {
        if (m.status && localDay(m.status.setAt, h.timezone) !== today) {
          await ctx.db.patch(m._id, { status: undefined });
          cleared++;
        }
      }
    }
    return cleared;
  },
});

const SESSION_IDLE_MS = 365 * 86_400_000;

/** Daily: drop old pairing codes and devices nobody has used in a year. */
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const pc of await ctx.db.query("pairingCodes").collect()) {
      if (pc.expiresAt < now - 86_400_000) await ctx.db.delete(pc._id);
    }
    for (const s of await ctx.db.query("sessions").collect()) {
      if (s.lastSeenAt < now - SESSION_IDLE_MS) await deleteSession(ctx, s._id);
    }
  },
});

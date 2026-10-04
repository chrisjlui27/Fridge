import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { fail, householdMutation, householdQuery, requireActor } from "./lib/session";

/**
 * Web push. Off until someone turns it on for their own device. Pushes are
 * for time-critical things only; everything else waits for the digest.
 */

export const config = query({
  args: {},
  handler: async () => ({ vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null }),
});

export const subscribe = householdMutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, a) => {
    const me = requireActor(ctx.s);
    if (ctx.s.session.kind === "wall") {
      fail("INVALID", "Notifications are for personal phones, not the shared wall screen.");
    }
    if (!a.endpoint.startsWith("https://")) fail("INVALID", "That push endpoint looks wrong.");
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", a.endpoint))
      .unique();
    const doc = {
      householdId: ctx.s.household._id,
      memberId: me._id,
      sessionId: ctx.s.session._id,
      endpoint: a.endpoint,
      p256dh: a.p256dh,
      auth: a.auth,
      createdAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("pushSubscriptions", doc);
    return null;
  },
});

export const unsubscribe = householdMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing && existing.householdId === ctx.s.household._id) await ctx.db.delete(existing._id);
    return null;
  },
});

export const deviceStatus = householdQuery({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    return existing !== null && existing.memberId === ctx.s.viewer?._id;
  },
});

/** "Send me a test" - the person asked, so it ignores quiet hours. */
export const sendTest = householdMutation({
  args: {},
  handler: async (ctx) => {
    const me = requireActor(ctx.s);
    await ctx.scheduler.runAfter(0, internal.pushNode.send, {
      memberId: me._id,
      title: "The fridge says hi 👋",
      body: "Notifications work on this device.",
      url: "/me",
      tag: "test",
    });
    return null;
  },
});

export const subsForMember = internalQuery({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) =>
    await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .collect(),
});

export const removeSub = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.delete(id);
  },
});

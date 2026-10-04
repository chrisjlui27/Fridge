"use node";

import webpush from "web-push";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const send = internalAction({
  args: {
    memberId: v.id("members"),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    tag: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      console.warn("Push is not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).");
      return;
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:fridge@example.com", publicKey, privateKey);
    const subs = await ctx.runQuery(internal.push.subsForMember, { memberId: a.memberId });
    const payload = JSON.stringify({ title: a.title, body: a.body, url: a.url, tag: a.tag });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 12 * 60 * 60 },
        );
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The browser dropped this subscription; forget it.
          await ctx.runMutation(internal.push.removeSub, { id: sub._id });
        } else {
          console.error("Push failed", status, (e as Error).message);
        }
      }
    }
  },
});

import { v } from "convex/values";
import { statusKind } from "./schema";
import {
  cleanText,
  fail,
  getMemberInHousehold,
  householdMutation,
  householdQuery,
  requireActor,
  requireParent,
} from "./lib/session";
import { byKey, keyAtEnd } from "./lib/order";
import { deleteSession } from "./lib/cleanup";
import { isTime } from "./lib/time";
import { DEFAULT_DIGEST_TIME, DEFAULT_QUIET_END, DEFAULT_QUIET_START } from "./lib/constants";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const role = v.union(v.literal("parent"), v.literal("kid"));

async function activeMembers(ctx: MutationCtx, householdId: Id<"households">) {
  return (
    await ctx.db
      .query("members")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect()
  )
    .filter((m) => m.removedAt === undefined)
    .sort(byKey);
}

export const add = householdMutation({
  args: { name: v.string(), role, emoji: v.string(), color: v.string() },
  handler: async (ctx, a) => {
    requireParent(ctx.s);
    const members = await activeMembers(ctx, ctx.s.household._id);
    if (members.length >= 20) fail("INVALID", "That's a lot of people! The limit is 20.");
    return await ctx.db.insert("members", {
      householdId: ctx.s.household._id,
      name: cleanText(a.name, 30, "Name"),
      role: a.role,
      emoji: a.emoji || "🙂",
      color: a.color,
      sortKey: keyAtEnd(members),
    });
  },
});

/** Parents can change anything; everyone can change their own picture and color. */
export const update = householdMutation({
  args: {
    memberId: v.id("members"),
    name: v.optional(v.string()),
    role: v.optional(role),
    emoji: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const m = await getMemberInHousehold(ctx, ctx.s, a.memberId);
    const self = ctx.s.viewer?._id === m._id;
    if (!ctx.s.isParentAccount) {
      if (!self) requireParent(ctx.s);
      if (a.name !== undefined || a.role !== undefined) requireParent(ctx.s);
    }
    if (a.role === "kid" && m.role === "parent") {
      const parents = (await activeMembers(ctx, ctx.s.household._id)).filter((x) => x.role === "parent");
      if (parents.length <= 1) fail("INVALID", "The household needs at least one parent.");
    }
    await ctx.db.patch(m._id, {
      ...(a.name !== undefined ? { name: cleanText(a.name, 30, "Name") } : {}),
      ...(a.role !== undefined ? { role: a.role } : {}),
      ...(a.emoji ? { emoji: a.emoji } : {}),
      ...(a.color ? { color: a.color } : {}),
    });
    return null;
  },
});

export const remove = householdMutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const me = requireParent(ctx.s);
    const m = await getMemberInHousehold(ctx, ctx.s, memberId);
    if (m._id === me._id) fail("INVALID", "You can't remove yourself. Ask the other parent.");
    const now = Date.now();
    const householdId = ctx.s.household._id;

    for (const s of await ctx.db
      .query("sessions")
      .withIndex("by_member", (q) => q.eq("memberId", m._id))
      .collect()) {
      await deleteSession(ctx, s._id);
    }
    for (const a of await ctx.db
      .query("accounts")
      .withIndex("by_member", (q) => q.eq("memberId", m._id))
      .collect()) {
      await ctx.db.delete(a._id);
    }
    for (const p of await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_member", (q) => q.eq("memberId", m._id))
      .collect()) {
      await ctx.db.delete(p._id);
    }
    // Their private space goes with them; nobody else could read it anyway.
    for (const n of await ctx.db
      .query("privateNotes")
      .withIndex("by_member", (q) => q.eq("memberId", m._id))
      .collect()) {
      await ctx.db.delete(n._id);
    }
    for (const job of await ctx.db
      .query("jobs")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect()) {
      if (!job.rotation.includes(m._id)) continue;
      const current = job.rotation[job.turn % job.rotation.length];
      const rotation = job.rotation.filter((id) => id !== m._id);
      if (rotation.length === 0) {
        await ctx.db.patch(job._id, { rotation, turn: 0, archivedAt: job.archivedAt ?? now });
      } else {
        const idx = current === m._id ? job.turn % job.rotation.length : rotation.indexOf(current);
        await ctx.db.patch(job._id, { rotation, turn: idx % rotation.length });
      }
    }
    for (const ev of await ctx.db
      .query("events")
      .withIndex("by_household_start", (q) => q.eq("householdId", householdId))
      .collect()) {
      if (ev.memberIds.includes(m._id)) {
        await ctx.db.patch(ev._id, { memberIds: ev.memberIds.filter((id) => id !== m._id) });
      }
    }
    for (const list of await ctx.db
      .query("lists")
      .withIndex("by_household", (q) => q.eq("householdId", householdId))
      .collect()) {
      if (list.ownerId === m._id) await ctx.db.patch(list._id, { ownerId: me._id });
    }
    for (const index of ["by_to", "by_from"] as const) {
      const field = index === "by_to" ? "toId" : "fromId";
      for (const r of await ctx.db
        .query("requests")
        .withIndex(index, (q) => q.eq(field, m._id))
        .collect()) {
        if (r.status === "open" || r.status === "proposed" || r.status === "accepted") {
          await ctx.db.patch(r._id, { status: "withdrawn", updatedAt: now });
        }
      }
    }
    // Keep the row (soft delete) so past contributions still show a name.
    await ctx.db.patch(m._id, {
      removedAt: now,
      pinHash: undefined,
      pinSalt: undefined,
      status: undefined,
    });
    return null;
  },
});

/** Parent view of members, including who has a login and paired devices. */
export const manage = householdQuery({
  args: {},
  handler: async (ctx) => {
    requireParent(ctx.s);
    const members = (
      await ctx.db
        .query("members")
        .withIndex("by_household", (q) => q.eq("householdId", ctx.s.household._id))
        .collect()
    )
      .filter((m) => m.removedAt === undefined)
      .sort(byKey);
    const out = [];
    for (const m of members) {
      const account = await ctx.db
        .query("accounts")
        .withIndex("by_member", (q) => q.eq("memberId", m._id))
        .unique();
      const devices = await ctx.db
        .query("sessions")
        .withIndex("by_member", (q) => q.eq("memberId", m._id))
        .collect();
      out.push({
        _id: m._id,
        name: m.name,
        role: m.role,
        emoji: m.emoji,
        color: m.color,
        hasPin: m.pinHash !== undefined,
        email: account?.email ?? null,
        deviceCount: devices.length,
      });
    }
    return out;
  },
});

/** Coarse status (Home / Out / School ...). Opt-in, and the same for everyone. */
export const setStatus = householdMutation({
  args: { status: v.union(statusKind, v.null()) },
  handler: async (ctx, { status }) => {
    const me = requireActor(ctx.s);
    await ctx.db.patch(me._id, {
      status: status === null ? undefined : { kind: status, setAt: Date.now() },
    });
    return null;
  },
});

export const myPrefs = householdQuery({
  args: {},
  handler: async (ctx) => {
    const me = ctx.s.viewer;
    if (!me) return null;
    return {
      digestTime: me.digestTime === "" ? null : me.digestTime ?? DEFAULT_DIGEST_TIME,
      quietStart: me.quietStart ?? DEFAULT_QUIET_START,
      quietEnd: me.quietEnd ?? DEFAULT_QUIET_END,
    };
  },
});

export const updatePrefs = householdMutation({
  args: {
    digestTime: v.union(v.string(), v.null()),
    quietStart: v.string(),
    quietEnd: v.string(),
  },
  handler: async (ctx, a) => {
    const me = requireActor(ctx.s);
    for (const t of [a.digestTime, a.quietStart, a.quietEnd]) {
      if (t !== null && !isTime(t)) fail("INVALID", "Times look like 19:30.");
    }
    await ctx.db.patch(me._id, {
      digestTime: a.digestTime ?? "",
      quietStart: a.quietStart,
      quietEnd: a.quietEnd,
    });
    return null;
  },
});

import { ConvexError, v } from "convex/values";
import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sha256Hex } from "./crypto";
import { localDay } from "./time";

/** How long a tapped-in profile stays active on the wall after the last action. */
export const ACTING_MS = 2 * 60 * 1000;

export type SessionInfo = {
  session: Doc<"sessions">;
  household: Doc<"households">;
  /** Who is acting right now. Null on the wall until someone taps in. */
  viewer: Doc<"members"> | null;
  /** Signed in with a real parent password (not a PIN on the wall). */
  isParentAccount: boolean;
};

export function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export async function readSession(ctx: QueryCtx, token: string): Promise<SessionInfo | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!session) return null;
  const household = await ctx.db.get(session.householdId);
  if (!household) return null;

  let viewerId: Id<"members"> | undefined;
  if (session.kind === "wall") {
    if (session.actingMemberId && (session.actingUntil ?? 0) > Date.now()) {
      viewerId = session.actingMemberId;
    }
  } else {
    viewerId = session.memberId;
  }
  let viewer = viewerId ? await ctx.db.get(viewerId) : null;
  if (viewer && (viewer.removedAt !== undefined || viewer.householdId !== household._id)) {
    viewer = null;
  }
  // A phone paired to someone who was removed is signed out.
  if (session.kind !== "wall" && !viewer) return null;

  return {
    session,
    household,
    viewer,
    isParentAccount: session.kind === "account" && viewer?.role === "parent",
  };
}

/** Query that needs a valid device session (any member, or the wall). */
export const householdQuery = customQuery(query, {
  args: { sessionToken: v.string() },
  input: async (ctx, { sessionToken }) => {
    const s = await readSession(ctx, sessionToken);
    if (!s) fail("SIGNED_OUT", "This device is signed out.");
    return { ctx: { s }, args: {} };
  },
});

/** Mutation that needs a valid device session. Keeps a wall profile awake. */
export const householdMutation = customMutation(mutation, {
  args: { sessionToken: v.string() },
  input: async (ctx, { sessionToken }) => {
    const s = await readSession(ctx, sessionToken);
    if (!s) fail("SIGNED_OUT", "This device is signed out.");
    const now = Date.now();
    const patch: Partial<Doc<"sessions">> = {};
    if (s.session.kind === "wall" && s.viewer) patch.actingUntil = now + ACTING_MS;
    if (now - s.session.lastSeenAt > 60 * 60 * 1000) patch.lastSeenAt = now;
    if (Object.keys(patch).length) await ctx.db.patch(s.session._id, patch);
    return { ctx: { s }, args: {} };
  },
});

export function requireActor(s: SessionInfo): Doc<"members"> {
  if (!s.viewer) fail("PICK_PROFILE", "Tap your picture first so we know who's doing this.");
  return s.viewer;
}

export function requireParent(s: SessionInfo): Doc<"members"> {
  if (!s.isParentAccount) {
    fail("PARENT_ONLY", "A parent needs to do this from their own signed-in phone or laptop.");
  }
  return s.viewer!;
}

export async function getMemberInHousehold(
  ctx: QueryCtx | MutationCtx,
  s: SessionInfo,
  memberId: Id<"members">,
): Promise<Doc<"members">> {
  const m = await ctx.db.get(memberId);
  if (!m || m.householdId !== s.household._id || m.removedAt !== undefined) {
    fail("NOT_FOUND", "That person isn't in this household.");
  }
  return m;
}

/** Load a household-owned document or fail. */
export async function getOwned<
  T extends
    | "notes"
    | "lists"
    | "listItems"
    | "requests"
    | "jobs"
    | "completions"
    | "calendarFeeds"
    | "privateNotes",
>(ctx: QueryCtx | MutationCtx, s: SessionInfo, id: Id<T>): Promise<Doc<T>> {
  const doc = (await ctx.db.get(id)) as (Doc<T> & { householdId: Id<"households"> }) | null;
  if (!doc || doc.householdId !== s.household._id) fail("NOT_FOUND", "That's not here any more.");
  return doc;
}

export function cleanText(text: string, max: number, what = "Text"): string {
  const t = text.trim();
  if (!t) fail("INVALID", `${what} can't be empty.`);
  if (t.length > max) fail("INVALID", `${what} is too long (max ${max} characters).`);
  return t;
}

/** Fields of a member that every device in the household may see. */
export function publicMember(m: Doc<"members">, tz: string, now = Date.now()) {
  const statusToday =
    m.status && localDay(m.status.setAt, tz) === localDay(now, tz) ? m.status : undefined;
  return {
    _id: m._id,
    name: m.name,
    role: m.role,
    emoji: m.emoji,
    color: m.color,
    hasPin: m.pinHash !== undefined,
    status: statusToday?.kind ?? null,
    sortKey: m.sortKey,
  };
}

export type PublicMember = ReturnType<typeof publicMember>;

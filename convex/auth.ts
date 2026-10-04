import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  formatCode,
  hashSecret,
  normalizeCode,
  randomCode,
  randomToken,
  sha256Hex,
  verifySecret,
} from "./lib/crypto";
import {
  ACTING_MS,
  cleanText,
  fail,
  householdMutation,
  householdQuery,
  publicMember,
  readSession,
  requireParent,
} from "./lib/session";
import { isValidTimeZone } from "./lib/time";
import { keyAtEnd, byKey } from "./lib/order";
import { deleteSession } from "./lib/cleanup";

const PASSWORD_MIN = 8;
const LOGIN_LOCK_AFTER = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const PIN_LOCK_AFTER = 5;
const PIN_LOCK_MS = 5 * 60 * 1000;
const CODE_TTL_MS = 15 * 60 * 1000;

function normalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail("INVALID", "That doesn't look like an email address.");
  return e;
}

function checkPassword(password: string) {
  if (password.length < PASSWORD_MIN) {
    fail("INVALID", `Use at least ${PASSWORD_MIN} characters for the password.`);
  }
}

function checkPin(pin: string) {
  if (!/^\d{4,8}$/.test(pin)) fail("INVALID", "A PIN is 4 to 8 digits.");
}

function label(deviceLabel: string) {
  return deviceLabel.trim().slice(0, 60) || "Device";
}

// ---------------------------------------------------------------------------
// First run

/** Lets the welcome screen choose between "set up" and "sign in". */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const first = await ctx.db.query("households").first();
    return {
      hasHousehold: first !== null,
      allowNewHouseholds: process.env.ALLOW_NEW_HOUSEHOLDS === "true",
    };
  },
});

export const setupHousehold = action({
  args: {
    householdName: v.string(),
    timezone: v.string(),
    name: v.string(),
    emoji: v.string(),
    color: v.string(),
    email: v.string(),
    password: v.string(),
    deviceLabel: v.string(),
  },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const email = normalizeEmail(args.email);
    checkPassword(args.password);
    const { hash, salt } = hashSecret(args.password);
    const token = randomToken();
    await ctx.runMutation(internal.auth.createHousehold, {
      householdName: args.householdName,
      timezone: args.timezone,
      name: args.name,
      emoji: args.emoji,
      color: args.color,
      email,
      passwordHash: hash,
      passwordSalt: salt,
      tokenHash: await sha256Hex(token),
      deviceLabel: label(args.deviceLabel),
    });
    return { token };
  },
});

export const createHousehold = internalMutation({
  args: {
    householdName: v.string(),
    timezone: v.string(),
    name: v.string(),
    emoji: v.string(),
    color: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    tokenHash: v.string(),
    deviceLabel: v.string(),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("households").first();
    if (existing && process.env.ALLOW_NEW_HOUSEHOLDS !== "true") {
      fail("SETUP_CLOSED", "This fridge is already set up. Ask a parent for a code to join.");
    }
    if (!isValidTimeZone(a.timezone)) fail("INVALID", "Unknown time zone.");
    const taken = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", a.email))
      .unique();
    if (taken) fail("INVALID", "That email is already used here.");

    const now = Date.now();
    const householdId = await ctx.db.insert("households", {
      name: cleanText(a.householdName, 60, "Household name"),
      timezone: a.timezone,
      createdAt: now,
    });
    const memberId = await ctx.db.insert("members", {
      householdId,
      name: cleanText(a.name, 30, "Name"),
      role: "parent",
      emoji: a.emoji || "🙂",
      color: a.color,
      sortKey: keyAtEnd([]),
    });
    const accountId = await ctx.db.insert("accounts", {
      householdId,
      memberId,
      email: a.email,
      passwordHash: a.passwordHash,
      passwordSalt: a.passwordSalt,
      failedLogins: 0,
    });
    await ctx.db.insert("sessions", {
      householdId,
      tokenHash: a.tokenHash,
      kind: "account",
      accountId,
      memberId,
      label: a.deviceLabel,
      createdAt: now,
      lastSeenAt: now,
    });
    await ctx.db.insert("lists", {
      householdId,
      name: "Groceries",
      emoji: "🛒",
      ownerId: memberId,
      sortKey: keyAtEnd([]),
      createdAt: now,
    });
    return householdId;
  },
});

// ---------------------------------------------------------------------------
// Parent sign-in

export const signIn = action({
  args: { email: v.string(), password: v.string(), deviceLabel: v.string() },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const email = args.email.trim().toLowerCase();
    const account = await ctx.runQuery(internal.auth.accountByEmail, { email });
    const BAD = "That email and password don't match.";
    if (!account) {
      hashSecret(args.password); // keep timing similar for unknown emails
      return fail("BAD_LOGIN", BAD);
    }
    if ((account.lockedUntil ?? 0) > Date.now()) {
      fail("LOCKED", "Too many tries. Wait 15 minutes and try again.");
    }
    if (!verifySecret(args.password, account.passwordHash, account.passwordSalt)) {
      await ctx.runMutation(internal.auth.recordFailedLogin, { accountId: account._id });
      return fail("BAD_LOGIN", BAD);
    }
    const token = randomToken();
    await ctx.runMutation(internal.auth.createAccountSession, {
      accountId: account._id,
      tokenHash: await sha256Hex(token),
      label: label(args.deviceLabel),
    });
    return { token };
  },
});

export const accountByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!account) return null;
    const member = await ctx.db.get(account.memberId);
    return member && member.removedAt === undefined ? account : null;
  },
});

export const recordFailedLogin = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const a = await ctx.db.get(accountId);
    if (!a) return;
    const failed = a.failedLogins + 1;
    if (failed >= LOGIN_LOCK_AFTER) {
      await ctx.db.patch(accountId, { failedLogins: 0, lockedUntil: Date.now() + LOGIN_LOCK_MS });
    } else {
      await ctx.db.patch(accountId, { failedLogins: failed });
    }
  },
});

export const createAccountSession = internalMutation({
  args: { accountId: v.id("accounts"), tokenHash: v.string(), label: v.string() },
  handler: async (ctx, { accountId, tokenHash, label }) => {
    const a = await ctx.db.get(accountId);
    if (!a) fail("BAD_LOGIN", "That account no longer exists.");
    await ctx.db.patch(accountId, { failedLogins: 0, lockedUntil: undefined });
    const now = Date.now();
    await ctx.db.insert("sessions", {
      householdId: a.householdId,
      tokenHash,
      kind: "account",
      accountId,
      memberId: a.memberId,
      label,
      createdAt: now,
      lastSeenAt: now,
    });
  },
});

export const changePassword = action({
  args: { sessionToken: v.string(), currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args): Promise<null> => {
    checkPassword(args.newPassword);
    const info = await ctx.runQuery(internal.auth.sessionContext, { sessionToken: args.sessionToken });
    if (!info?.accountId) fail("PARENT_ONLY", "Sign in with your password to change it.");
    const account = await ctx.runQuery(internal.auth.accountById, { accountId: info.accountId });
    if (!account || !verifySecret(args.currentPassword, account.passwordHash, account.passwordSalt)) {
      fail("BAD_LOGIN", "Your current password isn't right.");
    }
    const { hash, salt } = hashSecret(args.newPassword);
    await ctx.runMutation(internal.auth.savePassword, {
      accountId: info.accountId,
      passwordHash: hash,
      passwordSalt: salt,
    });
    return null;
  },
});

export const accountById = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: (ctx, { accountId }) => ctx.db.get(accountId),
});

export const savePassword = internalMutation({
  args: { accountId: v.id("accounts"), passwordHash: v.string(), passwordSalt: v.string() },
  handler: async (ctx, { accountId, passwordHash, passwordSalt }) => {
    await ctx.db.patch(accountId, { passwordHash, passwordSalt, failedLogins: 0, lockedUntil: undefined });
  },
});

// ---------------------------------------------------------------------------
// Session info for actions

export const sessionContext = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const s = await readSession(ctx, sessionToken);
    if (!s) return null;
    return {
      sessionId: s.session._id,
      householdId: s.household._id,
      timezone: s.household.timezone,
      kind: s.session.kind,
      accountId: s.session.accountId ?? null,
      viewerId: s.viewer?._id ?? null,
      isParentAccount: s.isParentAccount,
    };
  },
});

// ---------------------------------------------------------------------------
// Pairing codes: the wall tablet, a kid's phone, or a second parent's login.

export const createPairingCode = action({
  args: {
    sessionToken: v.string(),
    purpose: v.union(v.literal("wall"), v.literal("personal"), v.literal("parentLogin")),
    memberId: v.optional(v.id("members")),
  },
  handler: async (ctx, args): Promise<{ code: string; expiresAt: number }> => {
    const info = await ctx.runQuery(internal.auth.sessionContext, { sessionToken: args.sessionToken });
    if (!info?.isParentAccount || !info.viewerId) {
      fail("PARENT_ONLY", "A parent needs to do this from their own signed-in phone or laptop.");
    }
    const code = randomCode(8);
    const expiresAt = Date.now() + CODE_TTL_MS;
    await ctx.runMutation(internal.auth.insertPairingCode, {
      householdId: info.householdId,
      codeHash: await sha256Hex(code),
      purpose: args.purpose,
      memberId: args.memberId,
      createdBy: info.viewerId,
      expiresAt,
    });
    return { code: formatCode(code), expiresAt };
  },
});

export const insertPairingCode = internalMutation({
  args: {
    householdId: v.id("households"),
    codeHash: v.string(),
    purpose: v.union(v.literal("wall"), v.literal("personal"), v.literal("parentLogin")),
    memberId: v.optional(v.id("members")),
    createdBy: v.id("members"),
    expiresAt: v.number(),
  },
  handler: async (ctx, a) => {
    if (a.purpose === "wall") {
      if (a.memberId) fail("INVALID", "A wall device isn't tied to one person.");
    } else {
      if (!a.memberId) fail("INVALID", "Choose who this is for.");
      const m = await ctx.db.get(a.memberId);
      if (!m || m.householdId !== a.householdId || m.removedAt !== undefined) {
        fail("NOT_FOUND", "That person isn't in this household.");
      }
      if (a.purpose === "parentLogin") {
        if (m.role !== "parent") fail("INVALID", "Only parents get a password login.");
        const existing = await ctx.db
          .query("accounts")
          .withIndex("by_member", (q) => q.eq("memberId", m._id))
          .unique();
        if (existing) fail("INVALID", `${m.name} already has a login. They can sign in with it.`);
      }
    }
    await ctx.db.insert("pairingCodes", {
      householdId: a.householdId,
      codeHash: a.codeHash,
      purpose: a.purpose,
      memberId: a.memberId,
      createdBy: a.createdBy,
      createdAt: Date.now(),
      expiresAt: a.expiresAt,
    });
  },
});

/** What a code is for, so the pairing screen can ask for a password if needed. */
export const describeCode = action({
  args: { code: v.string() },
  handler: async (
    ctx,
    { code },
  ): Promise<{ purpose: "wall" | "personal" | "parentLogin"; memberName: string | null } | null> => {
    const pc = await ctx.runQuery(internal.auth.pairingByCode, {
      codeHash: await sha256Hex(normalizeCode(code)),
    });
    if (!pc) return null;
    return { purpose: pc.purpose, memberName: pc.memberName };
  },
});

export const pairingByCode = internalQuery({
  args: { codeHash: v.string() },
  handler: async (ctx, { codeHash }) => {
    const pc = await ctx.db
      .query("pairingCodes")
      .withIndex("by_code", (q) => q.eq("codeHash", codeHash))
      .unique();
    if (!pc || pc.usedAt !== undefined || pc.expiresAt < Date.now()) return null;
    const member = pc.memberId ? await ctx.db.get(pc.memberId) : null;
    return { ...pc, memberName: member?.name ?? null };
  },
});

export const redeemCode = action({
  args: {
    code: v.string(),
    deviceLabel: v.string(),
    email: v.optional(v.string()),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const codeHash = await sha256Hex(normalizeCode(args.code));
    const pc = await ctx.runQuery(internal.auth.pairingByCode, { codeHash });
    if (!pc) fail("BAD_CODE", "That code didn't work. Codes last 15 minutes and work once.");
    let login: { email: string; passwordHash: string; passwordSalt: string } | undefined;
    if (pc.purpose === "parentLogin") {
      const email = normalizeEmail(args.email ?? "");
      checkPassword(args.password ?? "");
      const { hash, salt } = hashSecret(args.password!);
      login = { email, passwordHash: hash, passwordSalt: salt };
    }
    const token = randomToken();
    await ctx.runMutation(internal.auth.consumePairing, {
      pairingId: pc._id,
      tokenHash: await sha256Hex(token),
      label: label(args.deviceLabel),
      login,
    });
    return { token };
  },
});

export const consumePairing = internalMutation({
  args: {
    pairingId: v.id("pairingCodes"),
    tokenHash: v.string(),
    label: v.string(),
    login: v.optional(
      v.object({ email: v.string(), passwordHash: v.string(), passwordSalt: v.string() }),
    ),
  },
  handler: async (ctx, a) => {
    const pc = await ctx.db.get(a.pairingId);
    const now = Date.now();
    if (!pc || pc.usedAt !== undefined || pc.expiresAt < now) {
      fail("BAD_CODE", "That code didn't work. Codes last 15 minutes and work once.");
    }
    await ctx.db.patch(pc._id, { usedAt: now });
    const base = {
      householdId: pc.householdId,
      tokenHash: a.tokenHash,
      label: a.label,
      createdAt: now,
      lastSeenAt: now,
    };
    if (pc.purpose === "wall") {
      await ctx.db.insert("sessions", { ...base, kind: "wall" });
    } else if (pc.purpose === "personal") {
      await ctx.db.insert("sessions", { ...base, kind: "personal", memberId: pc.memberId });
    } else {
      if (!a.login) fail("INVALID", "Choose an email and password.");
      const login = a.login;
      const taken = await ctx.db
        .query("accounts")
        .withIndex("by_email", (q) => q.eq("email", login.email))
        .unique();
      if (taken) fail("INVALID", "That email is already used here.");
      const accountId = await ctx.db.insert("accounts", {
        householdId: pc.householdId,
        memberId: pc.memberId!,
        email: login.email,
        passwordHash: login.passwordHash,
        passwordSalt: login.passwordSalt,
        failedLogins: 0,
      });
      await ctx.db.insert("sessions", {
        ...base,
        kind: "account",
        accountId,
        memberId: pc.memberId,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Wall tablet: tap your picture (and PIN, if you have one) to act.

export const verifyPin = action({
  args: { sessionToken: v.string(), memberId: v.id("members"), pin: v.optional(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    const info = await ctx.runQuery(internal.auth.pinCheckInfo, {
      sessionToken: args.sessionToken,
      memberId: args.memberId,
    });
    if (info.pinHash && info.pinSalt) {
      if ((info.pinLockedUntil ?? 0) > Date.now()) {
        fail("LOCKED", "Too many wrong PINs. Try again in a few minutes.");
      }
      if (!args.pin || !verifySecret(args.pin, info.pinHash, info.pinSalt)) {
        await ctx.runMutation(internal.auth.recordPinFailure, { memberId: args.memberId });
        fail("BAD_PIN", "That PIN isn't right.");
      }
    }
    await ctx.runMutation(internal.auth.startActing, {
      sessionId: info.sessionId,
      memberId: args.memberId,
    });
    return null;
  },
});

export const pinCheckInfo = internalQuery({
  args: { sessionToken: v.string(), memberId: v.id("members") },
  handler: async (ctx, { sessionToken, memberId }) => {
    const s = await readSession(ctx, sessionToken);
    if (!s) fail("SIGNED_OUT", "This device is signed out.");
    if (s.session.kind !== "wall") fail("INVALID", "Only the shared wall device switches people.");
    const m = await ctx.db.get(memberId);
    if (!m || m.householdId !== s.household._id || m.removedAt !== undefined) {
      fail("NOT_FOUND", "That person isn't in this household.");
    }
    return {
      sessionId: s.session._id,
      pinHash: m.pinHash,
      pinSalt: m.pinSalt,
      pinLockedUntil: m.pinLockedUntil,
    };
  },
});

export const recordPinFailure = internalMutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const m = await ctx.db.get(memberId);
    if (!m) return;
    const failures = (m.pinFailures ?? 0) + 1;
    if (failures >= PIN_LOCK_AFTER) {
      await ctx.db.patch(memberId, { pinFailures: 0, pinLockedUntil: Date.now() + PIN_LOCK_MS });
    } else {
      await ctx.db.patch(memberId, { pinFailures: failures });
    }
  },
});

export const startActing = internalMutation({
  args: { sessionId: v.id("sessions"), memberId: v.id("members") },
  handler: async (ctx, { sessionId, memberId }) => {
    await ctx.db.patch(memberId, { pinFailures: 0, pinLockedUntil: undefined });
    await ctx.db.patch(sessionId, {
      actingMemberId: memberId,
      actingUntil: Date.now() + ACTING_MS,
      lastSeenAt: Date.now(),
    });
  },
});

export const stopActing = householdMutation({
  args: {},
  handler: async (ctx) => {
    if (ctx.s.session.kind === "wall") {
      await ctx.db.patch(ctx.s.session._id, { actingMemberId: undefined, actingUntil: undefined });
    }
    return null;
  },
});

/** Set or clear a wall PIN. Parents can set anyone's; people can set their own. */
export const setPin = action({
  args: { sessionToken: v.string(), memberId: v.id("members"), pin: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<null> => {
    const info = await ctx.runQuery(internal.auth.sessionContext, { sessionToken: args.sessionToken });
    if (!info) fail("SIGNED_OUT", "This device is signed out.");
    if (!info.isParentAccount && info.viewerId !== args.memberId) {
      fail("PARENT_ONLY", "Only a parent, or you, can change your PIN.");
    }
    let hashed: { hash: string; salt: string } | null = null;
    if (args.pin !== null) {
      checkPin(args.pin);
      hashed = hashSecret(args.pin);
    }
    await ctx.runMutation(internal.auth.savePin, {
      householdId: info.householdId,
      memberId: args.memberId,
      pinHash: hashed?.hash,
      pinSalt: hashed?.salt,
    });
    return null;
  },
});

export const savePin = internalMutation({
  args: {
    householdId: v.id("households"),
    memberId: v.id("members"),
    pinHash: v.optional(v.string()),
    pinSalt: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const m = await ctx.db.get(a.memberId);
    if (!m || m.householdId !== a.householdId) fail("NOT_FOUND", "That person isn't in this household.");
    await ctx.db.patch(a.memberId, {
      pinHash: a.pinHash,
      pinSalt: a.pinSalt,
      pinFailures: 0,
      pinLockedUntil: undefined,
    });
  },
});

// ---------------------------------------------------------------------------
// Who am I / devices

export const whoami = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const s = await readSession(ctx, sessionToken);
    if (!s) return null;
    const tz = s.household.timezone;
    const members = (
      await ctx.db
        .query("members")
        .withIndex("by_household", (q) => q.eq("householdId", s.household._id))
        .collect()
    )
      .filter((m) => m.removedAt === undefined)
      .sort(byKey)
      .map((m) => publicMember(m, tz));
    return {
      household: { _id: s.household._id, name: s.household.name, timezone: tz },
      session: {
        _id: s.session._id,
        kind: s.session.kind,
        label: s.session.label,
        actingUntil: s.viewer && s.session.kind === "wall" ? s.session.actingUntil ?? null : null,
      },
      viewer: s.viewer ? publicMember(s.viewer, tz) : null,
      isParentAccount: s.isParentAccount,
      members,
    };
  },
});

export const touch = householdMutation({
  args: {},
  handler: async () => null,
});

export const signOut = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const tokenHash = await sha256Hex(sessionToken);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) await deleteSession(ctx, session._id);
    return null;
  },
});

export const devices = householdQuery({
  args: {},
  handler: async (ctx) => {
    requireParent(ctx.s);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_household", (q) => q.eq("householdId", ctx.s.household._id))
      .collect();
    const out = [];
    for (const d of sessions) {
      const member: Doc<"members"> | null = d.memberId ? await ctx.db.get(d.memberId) : null;
      out.push({
        _id: d._id,
        kind: d.kind,
        label: d.label,
        memberName: member?.name ?? null,
        createdAt: d.createdAt,
        lastSeenAt: d.lastSeenAt,
        current: d._id === ctx.s.session._id,
      });
    }
    return out.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  },
});

export const revokeDevice = householdMutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    requireParent(ctx.s);
    const d = await ctx.db.get(sessionId);
    if (!d || d.householdId !== ctx.s.household._id) fail("NOT_FOUND", "That device is already gone.");
    await deleteSession(ctx, sessionId);
    return null;
  },
});


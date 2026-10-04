/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export const modules = import.meta.glob("../convex/**/*.ts");

export function newTest() {
  return convexTest(schema, modules);
}

export type T = ReturnType<typeof newTest>;

export const TZ = "America/Chicago";

/**
 * A household: two parents with logins, three kids, a wall tablet, and the
 * oldest kid's phone.
 */
export async function setupFamily(t: T) {
  const { token: dad } = await t.action(api.auth.setupHousehold, {
    householdName: "The Luis",
    timezone: TZ,
    name: "Dad",
    emoji: "🧔",
    color: "#4c6ef5",
    email: "dad@example.com",
    password: "fridge-door-1",
    deviceLabel: "Dad's phone",
  });
  const who = (await t.query(api.auth.whoami, { sessionToken: dad }))!;
  const dadId = who.viewer!._id;

  const add = (name: string, role: "parent" | "kid", emoji: string) =>
    t.mutation(api.members.add, { sessionToken: dad, name, role, emoji, color: "#e64980" });
  const momId = await add("Mom", "parent", "👩");
  const avaId = await add("Ava", "kid", "🦊");
  const bellaId = await add("Bella", "kid", "🐢");
  const coraId = await add("Cora", "kid", "🦄");

  const momCode = await t.action(api.auth.createPairingCode, {
    sessionToken: dad,
    purpose: "parentLogin",
    memberId: momId,
  });
  const { token: mom } = await t.action(api.auth.redeemCode, {
    code: momCode.code,
    deviceLabel: "Mom's phone",
    email: "mom@example.com",
    password: "fridge-door-2",
  });

  const wallCode = await t.action(api.auth.createPairingCode, { sessionToken: dad, purpose: "wall" });
  const { token: wall } = await t.action(api.auth.redeemCode, {
    code: wallCode.code,
    deviceLabel: "Kitchen tablet",
  });

  const avaCode = await t.action(api.auth.createPairingCode, {
    sessionToken: dad,
    purpose: "personal",
    memberId: avaId,
  });
  const { token: ava } = await t.action(api.auth.redeemCode, {
    code: avaCode.code.toLowerCase().replace("-", " "), // forgiving input
    deviceLabel: "Ava's phone",
  });

  return {
    tokens: { dad, mom, wall, ava },
    ids: { household: who.household._id, dad: dadId, mom: momId, ava: avaId, bella: bellaId, cora: coraId },
  };
}

/** Tap a picture on the wall (and PIN if needed). */
export async function actOnWall(t: T, wall: string, memberId: Id<"members">, pin?: string) {
  await t.action(api.auth.verifyPin, { sessionToken: wall, memberId, pin });
}

export async function expectError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ data: expect.objectContaining({ code }) });
}

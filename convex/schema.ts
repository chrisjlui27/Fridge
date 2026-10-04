import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Data model for the fridge door.
 *
 * Rules of thumb:
 * - Everything belongs to a household (one deployment can hold more than one,
 *   but normally it is just yours).
 * - Login accounts (parents) are separate from `members` (everyone).
 * - Completions and reactions are add-only rows, never edits to a shared field.
 * - Private notes live in their own table so the door queries can't leak them.
 */

export const noteColor = v.union(
  v.literal("yellow"),
  v.literal("pink"),
  v.literal("blue"),
  v.literal("green"),
  v.literal("orange"),
  v.literal("purple"),
  v.literal("white"),
);

export const lifespan = v.union(
  v.literal("pinned"), // stays, shown first
  v.literal("today"), // expires at local midnight
  v.literal("week"), // expires at the end of Sunday
  v.literal("keep"), // stays until someone takes it down
);

export const statusKind = v.union(
  v.literal("home"),
  v.literal("out"),
  v.literal("school"),
  v.literal("work"),
  v.literal("practice"),
  v.literal("away"),
);

export const schedule = v.union(
  // "Adaptive": the next one is N days after it was actually done.
  v.object({ kind: v.literal("every"), days: v.number() }),
  // Fixed weekdays (0 = Sunday ... 6 = Saturday).
  v.object({ kind: v.literal("weekly"), weekdays: v.array(v.number()) }),
);

export const requestStatus = v.union(
  v.literal("open"), // waiting for the recipient
  v.literal("accepted"),
  v.literal("proposed"), // recipient proposed another time
  v.literal("declined"), // "can't"
  v.literal("done"),
  v.literal("withdrawn"),
);

export default defineSchema({
  households: defineTable({
    name: v.string(),
    timezone: v.string(), // IANA, e.g. "America/Chicago"
    createdAt: v.number(),
  }),

  members: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    role: v.union(v.literal("parent"), v.literal("kid")),
    emoji: v.string(),
    color: v.string(),
    sortKey: v.string(),
    // Optional PIN for the shared wall tablet. "Not real security" - it only
    // stops siblings from posing as each other.
    pinHash: v.optional(v.string()),
    pinSalt: v.optional(v.string()),
    pinFailures: v.optional(v.number()),
    pinLockedUntil: v.optional(v.number()),
    // Coarse, opt-in, same options for everyone. Cleared at local midnight.
    status: v.optional(v.object({ kind: statusKind, setAt: v.number() })),
    // Notification preferences ("HH:MM", household time).
    digestTime: v.optional(v.string()),
    quietStart: v.optional(v.string()),
    quietEnd: v.optional(v.string()),
    lastDigestDay: v.optional(v.string()),
    removedAt: v.optional(v.number()),
  }).index("by_household", ["householdId"]),

  accounts: defineTable({
    householdId: v.id("households"),
    memberId: v.id("members"),
    email: v.string(), // lowercased
    passwordHash: v.string(),
    passwordSalt: v.string(),
    failedLogins: v.number(),
    lockedUntil: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_member", ["memberId"]),

  sessions: defineTable({
    householdId: v.id("households"),
    tokenHash: v.string(),
    // account  = a parent signed in with email + password
    // wall     = shared household device; tap an avatar (+PIN) to act
    // personal = a device paired to one member (e.g. a kid's phone)
    kind: v.union(v.literal("account"), v.literal("wall"), v.literal("personal")),
    accountId: v.optional(v.id("accounts")),
    memberId: v.optional(v.id("members")),
    label: v.string(),
    createdAt: v.number(),
    lastSeenAt: v.number(),
    actingMemberId: v.optional(v.id("members")),
    actingUntil: v.optional(v.number()),
  })
    .index("by_token", ["tokenHash"])
    .index("by_household", ["householdId"])
    .index("by_member", ["memberId"]),

  pairingCodes: defineTable({
    householdId: v.id("households"),
    codeHash: v.string(),
    purpose: v.union(v.literal("wall"), v.literal("personal"), v.literal("parentLogin")),
    memberId: v.optional(v.id("members")),
    createdBy: v.id("members"),
    createdAt: v.number(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_code", ["codeHash"])
    .index("by_household", ["householdId"]),

  notes: defineTable({
    householdId: v.id("households"),
    authorId: v.id("members"),
    text: v.string(),
    color: noteColor,
    toId: v.optional(v.id("members")), // undefined = everyone
    imageId: v.optional(v.id("_storage")),
    imageKind: v.optional(v.union(v.literal("photo"), v.literal("doodle"))),
    lifespan,
    expiresAt: v.optional(v.number()),
    sortKey: v.string(),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    archivedBy: v.optional(v.id("members")),
  })
    .index("by_household_archived", ["householdId", "archivedAt"])
    .index("by_expiry", ["archivedAt", "expiresAt"]),

  privateNotes: defineTable({
    householdId: v.id("households"),
    memberId: v.id("members"),
    text: v.string(),
    color: noteColor,
    createdAt: v.number(),
    doneAt: v.optional(v.number()),
  }).index("by_member", ["memberId"]),

  lists: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    emoji: v.string(),
    ownerId: v.id("members"),
    // Fair Play-style "minimum standard of care" the family agreed on.
    standard: v.optional(v.string()),
    sortKey: v.string(),
    createdAt: v.number(),
    archivedAt: v.optional(v.number()),
  }).index("by_household", ["householdId"]),

  listItems: defineTable({
    householdId: v.id("households"),
    listId: v.id("lists"),
    text: v.string(),
    addedBy: v.id("members"),
    sortKey: v.string(),
    createdAt: v.number(),
    checkedAt: v.optional(v.number()),
    checkedBy: v.optional(v.id("members")),
  }).index("by_list", ["listId"]),

  requests: defineTable({
    householdId: v.id("households"),
    fromId: v.id("members"),
    toId: v.id("members"),
    title: v.string(),
    details: v.optional(v.string()),
    dueDate: v.optional(v.string()), // "YYYY-MM-DD" household time
    dueTime: v.optional(v.string()), // "HH:MM"
    urgent: v.boolean(),
    status: requestStatus,
    reply: v.optional(v.string()),
    proposedDate: v.optional(v.string()),
    proposedTime: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index("by_household", ["householdId"])
    .index("by_to", ["toId"])
    .index("by_from", ["fromId"]),

  jobs: defineTable({
    householdId: v.id("households"),
    title: v.string(),
    emoji: v.string(),
    rotation: v.array(v.id("members")),
    turn: v.number(), // index into rotation
    schedule,
    nextDue: v.string(), // "YYYY-MM-DD"
    notes: v.optional(v.string()),
    sortKey: v.string(),
    createdBy: v.id("members"),
    createdAt: v.number(),
    archivedAt: v.optional(v.number()),
  }).index("by_household", ["householdId"]),

  // Add-only log of things people did for the family.
  completions: defineTable({
    householdId: v.id("households"),
    memberId: v.id("members"), // who did it
    kind: v.union(v.literal("job"), v.literal("request")),
    jobId: v.optional(v.id("jobs")),
    requestId: v.optional(v.id("requests")),
    title: v.string(),
    emoji: v.optional(v.string()),
    at: v.number(),
    day: v.string(),
    // Lets a mis-tap on the wall be undone.
    prevTurn: v.optional(v.number()),
    prevDue: v.optional(v.string()),
    undoneAt: v.optional(v.number()),
  })
    .index("by_household_at", ["householdId", "at"])
    .index("by_job", ["jobId"]),

  // Add-only: thanks and "got it" taps.
  reactions: defineTable({
    householdId: v.id("households"),
    fromId: v.id("members"),
    kind: v.union(v.literal("thanks"), v.literal("gotit")),
    completionId: v.optional(v.id("completions")),
    noteId: v.optional(v.id("notes")),
    toMemberId: v.optional(v.id("members")), // free-form thanks to a person
    text: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_household_at", ["householdId", "at"])
    .index("by_completion", ["completionId"])
    .index("by_note", ["noteId"]),

  calendarFeeds: defineTable({
    householdId: v.id("households"),
    name: v.string(),
    url: v.string(),
    color: v.string(),
    lastFetchedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    eventCount: v.optional(v.number()),
  }).index("by_household", ["householdId"]),

  calendarEvents: defineTable({
    householdId: v.id("households"),
    feedId: v.id("calendarFeeds"),
    title: v.string(),
    location: v.optional(v.string()),
    allDay: v.boolean(),
    start: v.number(), // epoch ms (all-day: local midnight)
    end: v.number(),
    startDay: v.string(), // household-local "YYYY-MM-DD"
    endDay: v.string(), // inclusive last day
  })
    .index("by_household_start", ["householdId", "start"])
    .index("by_feed", ["feedId"]),

  pushSubscriptions: defineTable({
    householdId: v.id("households"),
    memberId: v.id("members"),
    sessionId: v.id("sessions"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_member", ["memberId"])
    .index("by_endpoint", ["endpoint"])
    .index("by_session", ["sessionId"]),

  exports: defineTable({
    householdId: v.id("households"),
    storageId: v.id("_storage"),
    createdAt: v.number(),
    bytes: v.number(),
  }).index("by_household", ["householdId"]),
});

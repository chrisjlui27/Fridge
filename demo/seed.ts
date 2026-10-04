import type { TestConvex } from "convex-test";
import { api } from "../convex/_generated/api";
import type schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { addDays, localDay, nextWeekday, zonedToMs } from "../convex/lib/time";

const TZ = "America/Chicago";

/** A lived-in sample household for the demo. Returns a token per device. */
export async function seed(t: TestConvex<typeof schema>) {
  const now = Date.now();
  const today = localDay(now, TZ);
  const at = (day: string, time: string) => zonedToMs(day, time, TZ);

  const { token: mom } = await t.action(api.auth.setupHousehold, {
    householdName: "The Fridge Family",
    timezone: TZ,
    name: "Mom",
    emoji: "👩",
    color: "#e64980",
    email: "mom@example.com",
    password: "fridge-demo",
    deviceLabel: "Mom's phone",
  });
  const who = (await t.query(api.auth.whoami, { sessionToken: mom }))!;
  const momId = who.viewer!._id;
  const add = (name: string, role: "parent" | "kid", emoji: string, color: string) =>
    t.mutation(api.members.add, { sessionToken: mom, name, role, emoji, color });
  const dadId = await add("Dad", "parent", "🧔", "#4c6ef5");
  const avaId = await add("Ava", "kid", "🦊", "#e4572e");
  const bellaId = await add("Bella", "kid", "🐢", "#29bf12");
  const coraId = await add("Cora", "kid", "🦄", "#9c36b5");

  const redeem = async (purpose: "wall" | "personal" | "parentLogin", memberId?: typeof dadId, extra = {}) => {
    const { code } = await t.action(api.auth.createPairingCode, { sessionToken: mom, purpose, memberId });
    return (await t.action(api.auth.redeemCode, { code, deviceLabel: "Demo", ...extra })).token;
  };
  const dad = await redeem("parentLogin", dadId, { email: "dad@example.com", password: "fridge-demo" });
  const ava = await redeem("personal", avaId);
  const wall = await redeem("wall");
  await t.action(api.auth.setPin, { sessionToken: mom, memberId: bellaId, pin: "1234" });

  // Statuses
  await t.mutation(api.members.setStatus, { sessionToken: dad, status: "work" });
  await t.mutation(api.members.setStatus, { sessionToken: ava, status: "school" });

  // The door
  const note = (token: string, text: string, color: string, lifespan: string, toId?: typeof dadId) =>
    t.mutation(api.notes.create, {
      sessionToken: token,
      text,
      color: color as "yellow",
      lifespan: lifespan as "keep",
      toId,
    });
  await note(dad, "Grandma visits Saturday! Rooms tidy by Friday night please 🧹", "orange", "week");
  await note(mom, "Dentist Thursday 3:30 - I'll pick you up from school 🦷", "blue", "week", bellaId);
  const proud = await note(mom, "So proud of you for that science test. Love you! ❤️", "pink", "keep", avaId);
  await t.mutation(api.notes.gotIt, { sessionToken: ava, noteId: proud });
  await note(ava, "Volleyball moved to 5:30 tonight!", "green", "today");
  await note(dad, "Wi-Fi: FridgeDoor-5G (password is on the router) 📶", "yellow", "pinned");

  // Lists, with owners agreed at the family table
  const [groceries] = await t.query(api.lists.all, { sessionToken: mom });
  await t.mutation(api.lists.update, {
    sessionToken: mom,
    listId: groceries._id,
    standard: "Never out of milk, bread or fruit",
  });
  for (const [token, item] of [
    [dad, "Milk"],
    [ava, "Eggs"],
    [mom, "Bananas"],
    [ava, "Tortillas"],
    [dad, "Cheddar"],
    [mom, "Bread"],
  ] as const) {
    await t.mutation(api.lists.addItem, { sessionToken: token, listId: groceries._id, text: item });
  }
  const g = (await t.query(api.lists.get, { sessionToken: mom, listId: groceries._id }))!;
  await t.mutation(api.lists.toggleItem, { sessionToken: mom, itemId: g.items.find((i) => i.text === "Bread")!._id });
  const target = await t.mutation(api.lists.create, {
    sessionToken: dad,
    name: "Target run",
    emoji: "🎯",
    ownerId: dadId,
  });
  for (const item of ["Poster board", "Glue sticks", "Printer paper"]) {
    await t.mutation(api.lists.addItem, { sessionToken: ava, listId: target, text: item });
  }

  // Family jobs - grown-ups in the rotation too
  const job = (title: string, emoji: string, rotation: (typeof dadId)[], schedule: { kind: "every"; days: number } | { kind: "weekly"; weekdays: number[] }, firstDue: string) =>
    t.mutation(api.jobs.create, { sessionToken: mom, title, emoji, rotation, schedule, firstDue });
  const dishes = await job("Unload the dishwasher", "🍽️", [dadId, avaId, bellaId, momId], { kind: "every", days: 1 }, today);
  const dog = await job("Feed Biscuit", "🐶", [bellaId, coraId], { kind: "every", days: 1 }, today);
  await job("Trash & recycling", "🗑️", [avaId, dadId], { kind: "weekly", weekdays: [1, 4] }, nextWeekday(addDays(today, -1), [1, 4]));
  await job("Fold laundry", "🧺", [momId, avaId, bellaId], { kind: "every", days: 3 }, addDays(today, 1));
  await job("Water the plants", "🪴", [coraId], { kind: "every", days: 4 }, today);

  // Yesterday: Dad did the dishwasher; today: Bella fed Biscuit.
  const yesterday = addDays(today, -1);
  await t.run(async (ctx) => {
    await ctx.db.insert("completions", {
      householdId: who.household._id,
      memberId: dadId,
      kind: "job",
      jobId: dishes,
      title: "Unload the dishwasher",
      emoji: "🍽️",
      at: at(yesterday, "07:40"),
      day: yesterday,
    });
  });
  // Bella ticks it off on the wall with her PIN.
  await asWall(t, wall, bellaId, "1234");
  const fed = (await t.mutation(api.jobs.complete, { sessionToken: wall, jobId: dog }))!;
  await t.mutation(api.auth.stopActing, { sessionToken: wall });
  await t.mutation(api.thanks.thank, {
    sessionToken: mom,
    completionId: fed,
    text: "You're really good at remembering Biscuit's dinner!",
  });
  await t.mutation(api.thanks.thank, {
    sessionToken: dad,
    toMemberId: momId,
    text: "You noticed Ava's inhaler was running low and sorted the refill. Thank you.",
  });

  // Requests: ask, don't assign
  const poster = await t.mutation(api.requests.create, {
    sessionToken: mom,
    toId: avaId,
    title: "Get poster board for the science fair",
    dueDate: nextWeekday(today, [4]),
  });
  await t.mutation(api.requests.respond, {
    sessionToken: ava,
    requestId: poster,
    response: "propose",
    proposedDate: nextWeekday(today, [5]),
    reply: "Practice runs late Thursday - Friday after school?",
  });
  await t.mutation(api.requests.create, {
    sessionToken: ava,
    toId: dadId,
    title: "Ride to practice?",
    dueDate: today,
    dueTime: "17:15",
  });
  const shoes = await t.mutation(api.requests.create, {
    sessionToken: dad,
    toId: bellaId,
    title: "Put your soccer cleats in the garage",
  });
  await asWall(t, wall, bellaId, "1234");
  await t.mutation(api.requests.respond, { sessionToken: wall, requestId: shoes, response: "accept" });
  await t.mutation(api.auth.stopActing, { sessionToken: wall });

  // Read-only calendars (in real life these come from your calendar feeds)
  await t.run(async (ctx) => {
    const family = await ctx.db.insert("calendarFeeds", {
      householdId: who.household._id,
      name: "Family",
      url: "https://example.com/family.ics",
      color: "#4c6ef5",
      lastFetchedAt: now,
      eventCount: 4,
    });
    const school = await ctx.db.insert("calendarFeeds", {
      householdId: who.household._id,
      name: "School",
      url: "https://example.com/school.ics",
      color: "#29bf12",
      lastFetchedAt: now,
      eventCount: 2,
    });
    const timed = (feedId: typeof family, title: string, day: string, start: string, end: string, location?: string) =>
      ctx.db.insert("calendarEvents", {
        householdId: who.household._id,
        feedId,
        title,
        location,
        allDay: false,
        start: at(day, start),
        end: at(day, end),
        startDay: day,
        endDay: day,
      });
    const allDay = (feedId: typeof family, title: string, from: string, to: string) =>
      ctx.db.insert("calendarEvents", {
        householdId: who.household._id,
        feedId,
        title,
        allDay: true,
        start: at(from, "00:00"),
        end: at(addDays(to, 1), "00:00"),
        startDay: from,
        endDay: to,
      });
    await timed(family, "Ava - volleyball practice", today, "17:30", "19:00", "High school gym");
    await allDay(school, "Book fair", today, addDays(today, 1));
    await timed(family, "Bella - dentist", nextWeekday(today, [4]), "15:30", "16:15");
    await timed(school, "Early release", addDays(today, 1), "13:00", "13:30");
    await allDay(family, "Grandma visits", nextWeekday(today, [6]), nextWeekday(today, [6]));
    await timed(family, "Pizza night", addDays(today, 1), "18:00", "19:00");
  });

  return { mom, dad, ava, wall };
}

async function asWall(t: TestConvex<typeof schema>, wall: string, memberId: Id<"members">, pin?: string) {
  await t.action(api.auth.verifyPin, { sessionToken: wall, memberId, pin });
}

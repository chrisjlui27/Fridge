import { expect, test, type Browser, type Page } from "@playwright/test";

type Device = "mom" | "dad" | "ava" | "wall";

async function reset(page: Page, empty = false) {
  await page.request.post(`/__demo/reset${empty ? "?empty=1" : ""}`);
}

/** Open the app as one of the demo devices. */
async function open(browser: Browser, device: Device, path = "/", viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  const tokens = await (await page.request.get("/__demo/tokens")).json();
  await page.addInitScript((t) => localStorage.setItem("fridge.session", t), tokens[device]);
  await page.goto(path);
  return page;
}

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test("first run: set up a household and put up the first note", async ({ page }) => {
  await reset(page, true);
  await page.goto("/");
  await expect(page.getByText("You're the first one here")).toBeVisible();
  await page.getByLabel("Household name").fill("The Testers");
  await page.getByLabel("Your first name").fill("Pat");
  await page.getByLabel("Email (for signing in)").fill("pat@example.com");
  await page.getByLabel("Password").fill("a-good-password");
  await page.getByRole("button", { name: "Set up our fridge" }).click();
  await expect(page.getByText("The fridge door is empty")).toBeVisible();

  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("Note text").fill("Hello, family!");
  await page.getByRole("radio", { name: "📌 Pin" }).click();
  await page.getByRole("button", { name: "Put it on the fridge" }).click();
  await expect(page.locator(".note-text", { hasText: "Hello, family!" })).toBeVisible();

  // Groceries list exists from the start.
  await page.getByRole("link", { name: "Lists" }).click();
  await expect(page.getByText("Groceries")).toBeVisible();
});

test("a note for Ava shows up on her phone; she taps Got it", async ({ browser, page }) => {
  const mom = await open(browser, "mom");
  await mom.getByRole("button", { name: "New note" }).click();
  await mom.getByLabel("Note text").fill("Bring your library book");
  await mom.getByRole("radio", { name: "Ava" }).click();
  await mom.getByRole("button", { name: "Put it on the fridge" }).click();
  await expect(mom.locator(".note-text", { hasText: "Bring your library book" })).toBeVisible();

  const ava = await open(browser, "ava");
  await ava.locator(".note", { hasText: "Bring your library book" }).click();
  await ava.getByRole("button", { name: "👍 Got it" }).click();

  await expect(mom.locator(".note", { hasText: "Bring your library book" }).getByTitle("Got it")).toContainText("Ava");
  void page;
});

test("groceries: add, tick, clear - and the duplicate merges", async ({ browser }) => {
  const dad = await open(browser, "dad", "/lists");
  await dad.locator(".list-card", { hasText: "Groceries" }).click();
  const input = dad.getByLabel("Add to Groceries");
  await input.fill("Coffee");
  await input.press("Enter");
  await expect(dad.locator(".item", { hasText: "Coffee" })).toBeVisible();
  await input.fill("coffee");
  await input.press("Enter");
  await expect(dad.locator(".item", { hasText: /coffee/i })).toHaveCount(1);
  await dad.getByRole("button", { name: "Tick Coffee" }).click();
  await expect(dad.locator(".item.done", { hasText: "Coffee" })).toBeVisible();
  await dad.getByRole("button", { name: "Clear ticked" }).click();
  await expect(dad.locator(".item", { hasText: "Coffee" })).toHaveCount(0);
});

test("wall: Bella taps in with her PIN to tick off a job, then undoes it", async ({ browser }) => {
  const wall = await open(browser, "wall", "/wall", { width: 1280, height: 800 });
  await expect(wall.locator(".clock")).toBeVisible();
  // Writing on the wall asks who you are.
  await wall.locator(".wall-task", { hasText: "Unload the dishwasher" }).click();
  await expect(wall.getByText("Who did “Unload the dishwasher”?")).toBeVisible();
  await wall.locator(".profile-btn", { hasText: "Bella" }).click();
  for (const d of ["1", "2", "3", "5"]) await wall.locator(".pinpad button", { hasText: d }).first().click();
  await expect(wall.getByText("That PIN isn't right.")).toBeVisible();
  for (const d of ["1", "2", "3", "4"]) await wall.locator(".pinpad button", { hasText: d }).first().click();
  await expect(wall.getByText("Nice! Unload the dishwasher is done.")).toBeVisible();
  await expect(wall.locator(".acting-bar")).toContainText("Bella is tapped in");
  await expect(wall.locator(".wall-task.done", { hasText: "Unload the dishwasher" })).toBeVisible();

  await wall.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(wall.locator(".wall-task.done", { hasText: "Unload the dishwasher" })).toHaveCount(0);
  await wall.locator(".acting-bar").getByRole("button", { name: "Done" }).click();
  await expect(wall.locator(".acting-bar")).toHaveCount(0);
});

test("requests: Dad says he can't, and Ava sees why", async ({ browser }) => {
  const dad = await open(browser, "dad", "/jobs");
  const card = dad.locator(".request", { hasText: "Ride to practice?" });
  await card.getByRole("button", { name: "Can't" }).click();
  await dad.getByLabel("Why not? (optional)").fill("Stuck at work - ask Mom?");
  await dad.getByRole("button", { name: "Send" }).click();
  await expect(card).toContainText("Can't");

  const ava = await open(browser, "ava", "/jobs");
  const mine = ava.locator(".request", { hasText: "Ride to practice?" });
  await expect(mine).toContainText("Stuck at work - ask Mom?");
  await mine.getByRole("button", { name: "OK, never mind" }).click();
  await expect(ava.locator(".request", { hasText: "Ride to practice?" })).toHaveCount(0);
});

test("thanks: specific, other-praising thanks with a gentle nudge", async ({ browser }) => {
  const dad = await open(browser, "dad", "/thanks");
  await dad.locator(".feed-item", { hasText: "Feed Biscuit" }).getByRole("button", { name: "Say thanks" }).click();
  const box = dad.getByLabel("Say what you noticed");
  await box.fill("That really helped me out");
  await expect(dad.getByText("Tip: thanks about")).toBeVisible();
  await box.fill("You never forget Biscuit - you're so reliable");
  await expect(dad.getByText("Tip: thanks about")).toHaveCount(0);
  await dad.getByRole("button", { name: "Send thanks" }).click();
  await expect(dad.locator(".thanks-bubble", { hasText: "you're so reliable" })).toBeVisible();
});

test("private space stays private", async ({ browser }) => {
  const ava = await open(browser, "ava", "/me");
  await ava.getByLabel("Private note").fill("Birthday gift idea for Mom: a plant");
  await ava.getByRole("button", { name: "Add" }).click();
  await expect(ava.locator(".private-notes")).toContainText("Birthday gift idea");

  const mom = await open(browser, "mom", "/me");
  await expect(mom.getByText("My space")).toBeVisible();
  await expect(mom.getByText("Birthday gift idea")).toHaveCount(0);
});

test("a parent sets up the wall tablet with a one-time code", async ({ browser }) => {
  const mom = await open(browser, "mom", "/family");
  await mom.getByRole("button", { name: "🖼️ Set up the wall tablet" }).click();
  await expect(mom.locator(".big-code")).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const code = (await mom.locator(".big-code").textContent())!.trim();

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const tablet = await ctx.newPage();
  await tablet.goto("/");
  await tablet.getByRole("radio", { name: "I have a code" }).click();
  await tablet.getByLabel("Code from a parent's phone").fill(code.toLowerCase());
  await tablet.getByRole("button", { name: "Join" }).click();
  await expect(tablet).toHaveURL(/\/wall$/);
  await expect(tablet.locator(".clock")).toBeVisible();
  await expect(mom.locator(".big-code")).toBeVisible();
});

test("draw a doodle and put it on the fridge", async ({ browser }) => {
  const ava = await open(browser, "ava");
  await ava.getByRole("button", { name: "New note" }).click();
  await ava.getByRole("button", { name: "✏️ Draw" }).click();
  const canvas = ava.getByLabel("Drawing area");
  const box = (await canvas.boundingBox())!;
  await ava.mouse.move(box.x + 30, box.y + 30);
  await ava.mouse.down();
  await ava.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await ava.mouse.up();
  await ava.getByRole("button", { name: "Use drawing" }).click();
  await ava.getByLabel("Note text").fill("For the fridge!");
  await ava.getByRole("button", { name: "Put it on the fridge" }).click();
  const note = ava.locator(".note", { hasText: "For the fridge!" });
  await expect(note.locator("img")).toBeVisible();
  const loaded = await note.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);
});

test("calendar: a weekly event, with one date moved", async ({ browser }) => {
  const ava = await open(browser, "ava", "/calendar");
  await ava.getByRole("button", { name: "＋ Event" }).click();
  await ava.getByLabel("What").fill("Swim lessons");
  await ava.locator(".sheet .field", { hasText: "Starts" }).locator("input").fill("16:00");
  await ava.locator(".sheet").getByRole("button", { name: /Ava/ }).click(); // tag Ava
  // Tapping the heading must not press a button inside it (it used to pick "Everyone").
  await ava.locator(".sheet").getByText("Who's involved").click();
  await expect(ava.locator(".sheet").getByRole("button", { name: /Ava/ })).toHaveAttribute("aria-pressed", "true");
  await ava.getByRole("radio", { name: "Weekly" }).click();
  await ava.getByRole("button", { name: "Save" }).click();

  const swims = ava.locator(".event-row", { hasText: "Swim lessons" });
  await expect(swims.first()).toContainText("4:00");
  expect(await swims.count()).toBeGreaterThanOrEqual(4); // weekly over the next 30 days

  // Move only the second one to 5pm.
  await swims.nth(1).click();
  await ava.getByRole("button", { name: "Edit" }).click();
  await expect(ava.getByRole("radio", { name: /^Only / })).toHaveAttribute("aria-checked", "true");
  await ava.locator(".sheet .field", { hasText: "Starts" }).first().locator("input[type=time]").fill("17:00");
  await ava.getByRole("button", { name: "Save" }).click();
  await expect(swims.nth(1)).toContainText("5:00");
  await expect(swims.nth(0)).toContainText("4:00");
  await expect(swims.nth(2)).toContainText("4:00");

  // Someone else can see it but not change it.
  const wall = await open(browser, "wall", "/calendar");
  await wall.locator(".event-row", { hasText: "Swim lessons" }).first().click();
  await expect(wall.getByText("Added by Ava")).toBeVisible();
  await expect(wall.getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("polls: ask, vote, and see the count", async ({ browser }) => {
  const mom = await open(browser, "mom");
  await mom.getByRole("button", { name: "New poll" }).click();
  await mom.getByLabel("Question").fill("Taco Tuesday?");
  await mom.getByLabel("Choice 1").fill("Yes!");
  await mom.getByLabel("Choice 2").fill("Pasta instead");
  await mom.getByRole("button", { name: "Put it on the fridge" }).click();
  const poll = mom.locator(".poll", { hasText: "Taco Tuesday?" });
  await poll.getByRole("button", { name: /Yes!/ }).click();
  await expect(poll.getByRole("button", { name: /Yes!/ })).toHaveAttribute("aria-pressed", "true");

  const ava = await open(browser, "ava");
  const hers = ava.locator(".poll", { hasText: "Taco Tuesday?" });
  await hers.getByRole("button", { name: /Pasta instead/ }).click();
  await hers.getByRole("button", { name: /Yes!/ }).click(); // changed her mind
  await expect(hers).toContainText("2 votes");
  await expect(mom.locator(".poll", { hasText: "Taco Tuesday?" }).getByRole("button", { name: /Yes!/ })).toContainText("2");
});

test("camera: snap a photo straight onto the door, and it's on the art wall", async ({ browser }) => {
  const ava = await open(browser, "ava");
  await ava.getByLabel("Take a photo for the door").setInputFiles("demo/sample-doodle.png");
  await expect(ava.locator(".compose-img img")).toBeVisible();
  await ava.getByLabel("Note text").fill("Look what I made");
  await ava.getByRole("button", { name: "Put it on the fridge" }).click();
  const note = ava.locator(".note", { hasText: "Look what I made" });
  await expect(note.locator("img")).toBeVisible();

  await ava.getByRole("link", { name: "🖼️ Art wall" }).click();
  await expect(ava.locator(".art-tile")).toHaveCount(2); // the seeded drawing + this photo
  await ava.locator(".art-tile").first().click();
  await expect(ava.getByText("Look what I made")).toBeVisible();
});

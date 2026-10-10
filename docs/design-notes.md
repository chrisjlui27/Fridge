# Design notes

How the research brief (*"Build the fridge door, not a 'smart' fridge"*) turned into code, and the judgment calls made along the way.

## Research → behaviour

| Finding | What the app does | Where |
|---|---|---|
| The paper fridge works because it's flexible: anyone posts, rearranges and removes, and items have very different lifespans (Swan & Taylor 2005). | Free-form notes with colour, author, photo or doodle, and "for" a person. Drag to rearrange. Lifespans are *pinned / today / this week / until removed*, and expired notes archive themselves. Anyone can take a note down (it's recoverable); only a parent can delete it for good. | `convex/notes.ts`, `src/pages/Door.tsx` |
| Adoption depends on at-a-glance visibility in a prominent spot plus access from outside the home (LINC). | One PWA serves both `/wall` (the kitchen) and phones. | `src/pages/Wall.tsx` |
| Household notes request action, express affection and mark identity (HomeNote). Coarse presence gives reassurance (Whereabouts Clock). | Love notes and doodles sit next to logistics. Optional status (Home / Out / School / Work / Practice / Away), the same for everyone. | `members.setStatus` |
| A shared list can make the mental load *worse* if one person still anticipates and monitors everything (Daminger; Weeks et al. 2025). | Lists have an **owner** responsible for noticing, planning, getting and checking, plus an agreed "standard". *Who owns what* supports a weekly re-deal. | `convex/lists.ts`, `OwnersPage` |
| Expected tangible rewards undermine motivation, especially in kids; praise doesn't (Deci, Koestner & Ryan; Warneken & Tomasello). | No points, stars, allowance or leaderboards. Contributions are visible and people thank each other for them. | `convex/thanks.ts` |
| Other-praising thanks predicts responsiveness and love; self-benefit thanks doesn't (Algoe et al. 2016). | Thanks starters ("You're really good at…", "You noticed…") and a gentle tip when the wording drifts to "helped me". A "thank someone for something nobody saw" button. | `src/components/ThanksSheet.tsx` |
| Kids push back on control and notice double standards (Penn State review; Blackwell et al. 2016). | Parents are in job rotations under the same rules. No location, no automatic read receipts, no "last seen". "Got it" is tapped, never recorded automatically. Everyone has a private space, parents included. | `jobs.ts`, `notes.gotIt`, `mine.ts` |
| Family plans break; kids negotiate chores (Davidoff et al.; Klein et al.). | Requests, not assignments: *Yes / Another time / Can't*. Jobs have "Not today". | `convex/requests.ts` |
| Batching notifications reduces stress; none at all raises anxiety (Fitz et al. 2019). Notification storms kill family apps. | One evening digest. Pings only for urgent or due-today requests and for notes marked time-sensitive, held until quiet hours end. Digests never mention undone chores. | `convex/digest.ts`, `lib/notify.ts` |
| Calendar sync is the commonest way family displays fail (Cast-Hub). | **Revised after v1:** the household doesn't live in Google Calendar, so the family calendar is **built in**, with no sync to break. Repeating events, people tags, and edits to one date or every date. Optional read-only .ics feeds (school, team) still show alongside. | `convex/events.ts`, `lib/recur.ts`, `lib/calendarData.ts`, `src/pages/Calendar.tsx` |
| Fridge items have very different lifespans; kids' art is kept for years (Swan & Taylor 2005). | The **art wall** keeps every photo and drawing, even after it comes off the door. Only a parent's "delete for good" removes it. | `convex/art.ts`, `src/pages/Art.tsx` |
| Family coordination works when others contribute, not just one scheduler (Neustaedter et al.). | **Quick polls** let anyone put a small family decision to a vote on the door. They close on their own and tidy away a day later, so they don't silt up. | `convex/polls.ts` |
| Kids engage by *doing* on the screen, not just reading (The Quality Edit). | The wall has big tap-to-tick jobs and grocery ticks. Tapping asks "Who did it?". | `WallPage` |
| Free tiers that pause after a quiet week would leave a dead wall after a vacation. | Convex free tier (the brief notes the pause policy as unverified, so check it). Thin data layer, nightly export, optional webhook. | `convex/exporter.ts` |
| Apps die when their maintainer stops maintaining them. | A small surface, 58 backend tests, 9 end-to-end flows, a no-account demo, and no CRDTs or sync engine. | `tests/`, `e2e/` |

## Judgment calls

- **Rearranging, not free placement.** Notes reorder by drag in a responsive grid (fractional sort keys, so one row changes per move) instead of x/y positions. Free placement doesn't survive the jump from an 11-inch wall to a phone. Pinned notes come first.
- **Custom sessions instead of a hosted auth product.** The household model needs three kinds of device (parent login, shared wall, paired kid phone) plus PIN "acting" on the wall. Plain session tokens (stored hashed) make that simple, make every permission rule testable, and need no extra keys to configure. Passwords and PINs are hashed with scrypt (`@noble/hashes`). Secrets are generated only in actions, never in deterministic queries or mutations.
- **Wall acting.** Tapping a picture (and PIN) makes that person the actor for 2 minutes, extended by each action. Parent-level powers never come from the wall, even when a parent taps in.
- **PINs are exactly 4 digits** so the keypad can auto-submit for small kids. They lock for 5 minutes after 5 misses.
- **The private space is a separate table**, so no door, export or digest query can leak it by accident. Removing a member deletes it.
- **Status clears at midnight** so yesterday's "Out" never lingers.
- **"Every N days" counts from when it was actually done** (Donetick's "adaptive" recurrence). Fixed-weekday jobs done early count for the current occurrence.
- **Completions and reactions are add-only rows.** An undo marks a completion as undone (within 10 minutes, only if nothing happened since) instead of deleting history.
- **Requests ping the asker back** only when their plan for *today* changed ("can't" or "another time" on something urgent or due today).
- **Floating calendar times** (no time zone in the feed) are read as household wall-clock time. All-day events keep their dates.
- **The wall caches its last known state** (and the session) in local storage, so a reload during a Wi-Fi blip shows the fridge, not a spinner. Writes made while offline are queued in memory by the Convex client and are lost if the tablet reloads before reconnecting. It dims 9pm–6am, and if anything crashes it reloads itself after 30 seconds.
- **The demo is the real backend.** `npm run demo` runs the actual Convex functions in an in-memory database (`convex-test`) inside the Vite dev server, with a tiny stand-in client. The end-to-end tests use it, so they need no account or network.

- **Repeating events are one row plus exceptions.** Changing a single date adds it to the series' `skipDays` and creates a one-off row that remembers which date it replaced; "every date" edits the series row. Repeats are expanded when they're read, for at most a 62-day window plus the event's length.
- **The camera uses the phone's own camera app** (`<input capture>`), not an in-app viewfinder. It gives the best photo quality with the fewest permissions, and photos are shrunk on the phone before uploading.
- **Updates install themselves; the reload asks first.** A new service worker takes over as soon as it's downloaded, because waiting for every copy of the app to close left installed iPhone apps stuck on old versions. Open pages show "Refresh" rather than reloading under someone mid-tap; the wall reloads itself after a minute. The app checks for a new version when it's opened and every 30 minutes.
- **Forms:** a field's heading is a real `<label>` only when it wraps a single input; groups of chips are labelled groups, so tapping a heading never presses the first chip.

## Known limits

- The code was built and tested against `convex-test` and a local bundling check, not yet against a live Convex deployment. The first `npx convex dev` is the real smoke test; report anything it complains about.
- iOS web push needs iOS 16.4+ and the app added to the Home Screen.
- Fully Kiosk's JavaScript interface (screen wake on new notes) needs the PLUS license with the interface enabled. Fully's support for Android 15/16 is unverified.
- Convex's free-tier pausing policy isn't stated on its pricing page, so check it before relying on it for the wall.
- Big households with years of history: completions and reactions are paged in exports, but the thanks feed only looks back 7 days by design.

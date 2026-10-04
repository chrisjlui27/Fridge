import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("archive expired notes", { minutes: 30 }, internal.notes.archiveExpired, {});
crons.interval("clear yesterday's statuses", { hours: 1 }, internal.maintenance.clearStaleStatuses, {});
crons.interval("refresh calendars", { minutes: 20 }, internal.calendar.refreshAll, {});
crons.interval("evening digest", { minutes: 15 }, internal.digest.tick, {});
// ~3am US Central. Snapshots are kept for 14 nights.
crons.daily("nightly export", { hourUTC: 8, minuteUTC: 17 }, internal.exporter.nightly, {});
crons.daily("cleanup", { hourUTC: 9, minuteUTC: 7 }, internal.maintenance.cleanup, {});

export default crons;

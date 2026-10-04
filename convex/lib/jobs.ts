import type { Doc, Id } from "../_generated/dataModel";
import { fail } from "./session";
import { addDays, nextWeekday, weekdayOf } from "./time";

type Schedule = Doc<"jobs">["schedule"];

export function assigneeOf(job: Doc<"jobs">): Id<"members"> | null {
  if (job.rotation.length === 0) return null;
  return job.rotation[job.turn % job.rotation.length];
}

export function checkSchedule(s: Schedule): Schedule {
  if (s.kind === "every") {
    if (!Number.isInteger(s.days) || s.days < 1 || s.days > 365) {
      fail("INVALID", "Repeat every 1 to 365 days.");
    }
    return s;
  }
  const weekdays = [...new Set(s.weekdays)].sort((a, b) => a - b);
  if (weekdays.length === 0 || weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    fail("INVALID", "Pick at least one day of the week.");
  }
  return { kind: "weekly", weekdays };
}

/** For weekly jobs, the first due day must land on one of the chosen days. */
export function alignDue(day: string, s: Schedule): string {
  if (s.kind === "weekly" && !s.weekdays.includes(weekdayOf(day))) {
    return nextWeekday(day, s.weekdays);
  }
  return day;
}

/** When is it due next, if it was done today? */
export function nextDueAfterDone(job: Pick<Doc<"jobs">, "schedule" | "nextDue">, today: string): string {
  if (job.schedule.kind === "every") return addDays(today, job.schedule.days);
  // Fixed days: doing it early counts for the current one.
  const from = job.nextDue > today ? job.nextDue : today;
  return nextWeekday(from, job.schedule.weekdays);
}


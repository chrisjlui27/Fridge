import { useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { daysBetween, weekdayOf } from "../../convex/lib/time";
import { useM, useQ, useSession, type MemberId } from "../lib/session";
import { addDays, dayLabel, formatDate, formatHHMM, ordinal, shortWeekday, useNow } from "../lib/format";
import { Avatar } from "../components/Avatar";
import { EmptyState, Field, Segmented } from "../components/Controls";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";

export type CalItem = FunctionReturnType<typeof api.calendar.range>[number];
type Repeat = NonNullable<CalItem["repeat"]>;

const UPCOMING_DAYS = 30;

export function timeText(e: Pick<CalItem, "allDay" | "startTime" | "endTime">) {
  if (e.allDay || !e.startTime) return "All day";
  return e.endTime ? `${formatHHMM(e.startTime)} – ${formatHHMM(e.endTime)}` : formatHHMM(e.startTime);
}

export function repeatText(r: Repeat, startDay: string) {
  const n = r.interval;
  let text: string;
  switch (r.freq) {
    case "daily":
      text = n === 1 ? "Every day" : `Every ${n} days`;
      break;
    case "weekly": {
      const days = (r.weekdays?.length ? r.weekdays : [weekdayOf(startDay)]).map(shortWeekday).join(", ");
      text = `${n === 1 ? "Every week" : `Every ${n} weeks`} on ${days}`;
      break;
    }
    case "monthly":
      text = `${n === 1 ? "Every month" : `Every ${n} months`} on the ${ordinal(Number(startDay.slice(8)))}`;
      break;
    case "yearly":
      text = `Every year on ${formatDate(startDay, { month: "long", day: "numeric" })}`;
      break;
  }
  return r.until ? `${text}, until ${formatDate(r.until, { month: "short", day: "numeric" })}` : text;
}

/** Each item once per day it covers (multi-day events appear every day). */
function byDay(items: CalItem[], from: string, to: string) {
  const days = new Map<string, CalItem[]>();
  for (const e of items) {
    for (let d = e.startDay < from ? from : e.startDay; d <= e.endDay && d <= to; d = addDays(d, 1)) {
      days.set(d, [...(days.get(d) ?? []), e]);
    }
  }
  return days;
}

export function CalendarPage() {
  const { tz, viewer } = useSession();
  const { today } = useNow(tz, 60_000);
  const [view, setView] = useState<"upcoming" | "month">("upcoming");
  const [justMe, setJustMe] = useState(false);
  const [month, setMonth] = useState(today.slice(0, 7) + "-01");
  const [selected, setSelected] = useState(today);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ item?: CalItem; day: string } | null>(null);

  // Month view shows whole weeks, Sunday first.
  const gridStart = addDays(month, -weekdayOf(month));
  const nextMonth = addDays(month, 32).slice(0, 7) + "-01";
  const gridEnd = addDays(nextMonth, 6 - weekdayOf(addDays(nextMonth, -1)) - 1);
  const from = view === "upcoming" ? today : gridStart;
  const to = view === "upcoming" ? addDays(today, UPCOMING_DAYS) : gridEnd;
  const items = useQ(api.calendar.range, { fromDay: from, toDay: to });

  const shown = useMemo(
    () =>
      (items ?? []).filter(
        (e) => !justMe || !viewer || e.memberIds.length === 0 || e.memberIds.includes(viewer._id),
      ),
    [items, justMe, viewer],
  );
  const days = useMemo(() => byDay(shown, from, to), [shown, from, to]);
  const open = shown.find((e) => e._id === openKey) ?? null;

  return (
    <div className="page calendar">
      <div className="page-head">
        <h1>Calendar</h1>
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "upcoming", label: "Upcoming" },
            { value: "month", label: "Month" },
          ]}
        />
      </div>
      {viewer && (
        <div className="row wrap cal-filter">
          <button className={`chip${!justMe ? " on" : ""}`} aria-pressed={!justMe} onClick={() => setJustMe(false)}>
            👪 Everyone
          </button>
          <button className={`chip${justMe ? " on" : ""}`} aria-pressed={justMe} onClick={() => setJustMe(true)}>
            <Avatar member={viewer} size={20} /> Just me
          </button>
        </div>
      )}

      {view === "month" ? (
        <>
          <div className="row between month-head">
            <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addDays(month, -1).slice(0, 7) + "-01")}>
              ‹
            </button>
            <h2>{formatDate(month, { month: "long", year: "numeric" })}</h2>
            <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(nextMonth)}>
              ›
            </button>
          </div>
          <div className="month-grid" role="grid" aria-label="Month">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <div key={d} className="month-dow" aria-hidden>
                {shortWeekday(d)}
              </div>
            ))}
            {Array.from({ length: daysBetween(gridStart, gridEnd) + 1 }, (_, i) => addDays(gridStart, i)).map((d) => {
              const list = days.get(d) ?? [];
              return (
                <button
                  key={d}
                  role="gridcell"
                  className={`month-day${d.slice(0, 7) !== month.slice(0, 7) ? " other" : ""}${d === today ? " today" : ""}${d === selected ? " selected" : ""}`}
                  onClick={() => setSelected(d)}
                  aria-label={`${formatDate(d, { weekday: "long", month: "long", day: "numeric" })}, ${list.length} events`}
                >
                  <span className="month-num">{Number(d.slice(8))}</span>
                  {list.slice(0, 3).map((e) => (
                    <span key={e._id} className="month-bar" style={{ background: e.color }}>
                      {e.title}
                    </span>
                  ))}
                  {list.length > 3 && <span className="month-more">+{list.length - 3}</span>}
                </button>
              );
            })}
          </div>
          <DayList day={selected} today={today} items={days.get(selected) ?? []} onOpen={setOpenKey} />
        </>
      ) : items === undefined ? (
        <p className="muted">Loading…</p>
      ) : days.size === 0 ? (
        <EmptyState emoji="📅" title="Nothing coming up">
          Add practices, appointments, trips and birthdays - anyone in the family can.
        </EmptyState>
      ) : (
        [...days.keys()]
          .sort()
          .map((d) => <DayList key={d} day={d} today={today} items={days.get(d)!} onOpen={setOpenKey} />)
      )}

      <button className="fab" onClick={() => setEditing({ day: view === "month" ? selected : today })}>
        ＋ Event
      </button>
      {open && (
        <EventSheet
          item={open}
          today={today}
          onClose={() => setOpenKey(null)}
          onEdit={() => {
            setEditing({ item: open, day: open.startDay });
            setOpenKey(null);
          }}
        />
      )}
      {editing && <EventEditor item={editing.item} day={editing.day} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DayList({
  day,
  today,
  items,
  onOpen,
}: {
  day: string;
  today: string;
  items: CalItem[];
  onOpen: (key: string) => void;
}) {
  return (
    <section className="cal-day">
      <h2>
        {dayLabel(day, today)}
        {daysBetween(today, day) >= 0 && daysBetween(today, day) < 2 && (
          <span className="muted small"> · {formatDate(day, { weekday: "short", month: "short", day: "numeric" })}</span>
        )}
      </h2>
      {items.length === 0 ? (
        <p className="muted small">Nothing on.</p>
      ) : (
        items.map((e) => <EventRow key={`${e._id}@${day}`} e={e} onOpen={() => onOpen(e._id)} />)
      )}
    </section>
  );
}

export function EventRow({ e, onOpen }: { e: CalItem; onOpen?: () => void }) {
  const { member } = useSession();
  return (
    <button className="card event-row" onClick={onOpen} style={{ ["--event" as string]: e.color }}>
      <span className="event-when">{timeText(e)}</span>
      <span className="grow">
        <span className="event-title">
          {e.title}
          {e.repeat && <span title="Repeats"> 🔁</span>}
        </span>
        {(e.location || e.feedName) && (
          <span className="muted small block">{[e.location, e.feedName && `from ${e.feedName}`].filter(Boolean).join(" · ")}</span>
        )}
      </span>
      <span className="event-people">
        {e.memberIds.map((id) => (
          <Avatar key={id} member={member(id)} size={22} />
        ))}
      </span>
    </button>
  );
}

function EventSheet({
  item,
  today,
  onClose,
  onEdit,
}: {
  item: CalItem;
  today: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { member } = useSession();
  const remove = useM(api.events.remove);
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const isSeries = item.repeat !== null && item.seriesId !== null;
  const days = item.endDay > item.startDay ? ` – ${dayLabel(item.endDay, today)}` : "";

  async function del(scope: "one" | "all") {
    const target = scope === "all" && item.seriesId ? item.seriesId : item.eventId!;
    const ok = await remove({ eventId: target, scope, occurrenceDay: item.occurrenceDay ?? undefined });
    if (ok !== undefined) {
      toast.show(scope === "one" && isSeries ? "Removed that date." : "Deleted.");
      onClose();
    }
  }

  return (
    <Sheet
      title={item.title}
      onClose={onClose}
      footer={
        item.canEdit ? (
          confirming ? (
            isSeries ? (
              <>
                <button className="btn ghost" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
                <button className="btn danger" onClick={() => void del("one")}>
                  Just this date
                </button>
                <button className="btn primary danger" onClick={() => void del("all")}>
                  Every date
                </button>
              </>
            ) : (
              <>
                <button className="btn ghost" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
                <button className="btn primary danger" onClick={() => void del("all")}>
                  Delete
                </button>
              </>
            )
          ) : (
            <>
              <button className="btn ghost danger" onClick={() => setConfirming(true)}>
                Delete
              </button>
              <button className="btn primary" onClick={onEdit}>
                Edit
              </button>
            </>
          )
        ) : undefined
      }
    >
      <p className="event-big-when">
        <strong>
          {dayLabel(item.startDay, today)}
          {days}
        </strong>{" "}
        · {timeText(item)}
      </p>
      {item.repeat && item.seriesStartDay && <p className="muted">🔁 {repeatText(item.repeat, item.seriesStartDay)}</p>}
      {item.seriesId && !item.repeat && <p className="muted small">This date was changed on its own; the rest of the series is unchanged.</p>}
      {item.location && <p>📍 {item.location}</p>}
      <div className="row wrap">
        {item.memberIds.length === 0 ? (
          <span className="chip static">👪 Whole family</span>
        ) : (
          item.memberIds.map((id) => (
            <span key={id} className="chip static">
              <Avatar member={member(id)} size={22} /> {member(id)?.name ?? "Someone"}
            </span>
          ))
        )}
      </div>
      {item.notes && <p className="pre">{item.notes}</p>}
      {item.source === "feed" && <p className="muted small">From the {item.feedName} calendar (read-only).</p>}
      {item.source === "fridge" && !item.canEdit && (
        <p className="muted small">Added by {member(item.createdBy)?.name ?? "someone"} - they (or a parent) can change it.</p>
      )}
      {confirming && <p className="error-text">{isSeries ? "Delete just this date, or every date?" : "Delete this event?"}</p>}
    </Sheet>
  );
}

const FREQS: { value: "none" | Repeat["freq"]; label: string }[] = [
  { value: "none", label: "Never" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

export function EventEditor({ item, day, onClose }: { item?: CalItem; day: string; onClose: () => void }) {
  const { members } = useSession();
  const create = useM(api.events.create);
  const update = useM(api.events.update);
  const isSeries = !!item && item.repeat !== null && item.seriesId !== null && item.seriesId === item.eventId;
  const [scope, setScope] = useState<"one" | "all">("one");
  const seriesMode = isSeries && scope === "all";

  const [title, setTitle] = useState(item?.title ?? "");
  const [allDay, setAllDay] = useState(item?.allDay ?? false);
  const [occurrenceDayValue, setOccurrenceDayValue] = useState(item?.startDay ?? day);
  const [seriesStart, setSeriesStart] = useState(item?.seriesStartDay ?? item?.startDay ?? day);
  const startDay = seriesMode ? seriesStart : occurrenceDayValue;
  // Multi-day events keep their length when the start moves.
  const [spanDays, setSpanDays] = useState(item ? daysBetween(item.startDay, item.endDay) : 0);
  const endDay = addDays(startDay, spanDays);
  const [startTime, setStartTime] = useState(item?.startTime ?? "16:00");
  const [endTime, setEndTime] = useState(item?.endTime ?? "");
  const [location, setLocation] = useState(item?.location ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [memberIds, setMemberIds] = useState<MemberId[]>(item?.memberIds ?? []);
  const [freq, setFreq] = useState<"none" | Repeat["freq"]>(item?.repeat?.freq ?? "none");
  const [every, setEvery] = useState(item?.repeat?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(item?.repeat?.weekdays ?? [weekdayOf(day)]);
  const [until, setUntil] = useState(item?.repeat?.until ?? "");
  const [busy, setBusy] = useState(false);
  // A single date of a series can't start repeating on its own.
  const canRepeat = !item || !item.seriesId || seriesMode;

  function setStart(d: string) {
    if (seriesMode) setSeriesStart(d);
    else setOccurrenceDayValue(d);
  }

  async function save() {
    setBusy(true);
    const fields = {
      title,
      allDay,
      startDay,
      endDay: allDay ? endDay : undefined,
      startTime: allDay ? undefined : startTime,
      endTime: allDay || !endTime ? undefined : endTime,
      location: location || undefined,
      notes: notes || undefined,
      memberIds,
      repeat:
        canRepeat && freq !== "none"
          ? { freq, interval: every, weekdays: freq === "weekly" ? weekdays : undefined, until: until || undefined }
          : null,
    };
    const ok = item
      ? await update({
          eventId: item.eventId!,
          scope: isSeries ? scope : "all",
          occurrenceDay: isSeries ? item.occurrenceDay ?? undefined : undefined,
          ...fields,
        })
      : await create(fields);
    setBusy(false);
    if (ok) onClose();
  }

  const unit = { daily: "days", weekly: "weeks", monthly: "months", yearly: "years" } as const;

  return (
    <Sheet
      title={item ? "Edit event" : "New event"}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || !title.trim() || (freq === "weekly" && canRepeat && weekdays.length === 0)}
            onClick={save}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {isSeries && (
        <Field label="This event repeats. Change…">
          <Segmented
            label="Change which dates"
            value={scope}
            onChange={setScope}
            options={[
              { value: "one", label: `Only ${formatDate(item!.startDay, { month: "short", day: "numeric" })}` },
              { value: "all", label: "Every date" },
            ]}
          />
        </Field>
      )}
      <Field label="What">
        <input autoFocus value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Volleyball practice" />
      </Field>
      <Segmented
        label="Time"
        value={allDay ? "allday" : "timed"}
        onChange={(v) => setAllDay(v === "allday")}
        options={[
          { value: "timed", label: "At a time" },
          { value: "allday", label: "All day" },
        ]}
      />
      <div className="row wrap">
        <Field label={seriesMode ? "Starts" : allDay ? "From" : "Day"}>
          <input type="date" value={startDay} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </Field>
        {allDay ? (
          <Field label="To">
            <input
              type="date"
              value={endDay}
              min={startDay}
              onChange={(e) => e.target.value && setSpanDays(Math.max(0, daysBetween(startDay, e.target.value)))}
            />
          </Field>
        ) : (
          <>
            <Field label="Starts">
              <input type="time" value={startTime} onChange={(e) => e.target.value && setStartTime(e.target.value)} />
            </Field>
            <Field label="Ends (optional)">
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </>
        )}
      </div>
      <Field label="Who's involved" hint="Leave everyone unselected for a whole-family event.">
        <div className="person-picker">
          <button type="button" className={`chip${memberIds.length === 0 ? " on" : ""}`} onClick={() => setMemberIds([])}>
            👪 Everyone
          </button>
          {members.map((m) => {
            const on = memberIds.includes(m._id);
            return (
              <button
                key={m._id}
                type="button"
                aria-pressed={on}
                className={`chip${on ? " on" : ""}`}
                onClick={() => setMemberIds(on ? memberIds.filter((x) => x !== m._id) : [...memberIds, m._id])}
              >
                <Avatar member={m} size={22} /> {m.name}
              </button>
            );
          })}
        </div>
      </Field>
      {canRepeat && (
        <Field label="Repeats">
          <Segmented label="Repeats" value={freq} onChange={setFreq} options={FREQS} />
        </Field>
      )}
      {canRepeat && freq !== "none" && (
        <div className="repeat-box">
          {freq === "weekly" && (
            <div className="row wrap" role="group" aria-label="On these days">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={weekdays.includes(d)}
                  className={`chip${weekdays.includes(d) ? " on" : ""}`}
                  onClick={() =>
                    setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d].sort((a, b) => a - b))
                  }
                >
                  {shortWeekday(d)}
                </button>
              ))}
            </div>
          )}
          <div className="row wrap">
            <label className="row inline-field">
              Every
              <input
                type="number"
                min={1}
                max={52}
                value={every}
                onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))}
                aria-label="Repeat interval"
              />
              {unit[freq]}
            </label>
            <label className="row inline-field">
              until
              <input type="date" value={until} min={startDay} onChange={(e) => setUntil(e.target.value)} aria-label="Repeat until" />
            </label>
          </div>
          <p className="muted small">
            {repeatText({ freq, interval: every, weekdays: freq === "weekly" ? weekdays : undefined, until: until || undefined }, startDay)}
          </p>
        </div>
      )}
      <Field label="Where (optional)">
        <input value={location} maxLength={120} onChange={(e) => setLocation(e.target.value)} placeholder="High school gym" />
      </Field>
      <Field label="Notes (optional)">
        <textarea rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bring knee pads" />
      </Field>
    </Sheet>
  );
}

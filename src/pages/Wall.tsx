import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useConvexConnectionState } from "convex/react";
import { api } from "../../convex/_generated/api";
import { STATUS_OPTIONS } from "../../convex/lib/constants";
import { zonedParts } from "../../convex/lib/time";
import { useM, useQ, useSession, type Member } from "../lib/session";
import { useLastKnown } from "../lib/cache";
import { addDays, formatDate, formatHHMM, formatTime, useNow, weekdayName } from "../lib/format";
import { Avatar } from "../components/Avatar";
import { NoteCard, NoteComposer, NoteDetail } from "../components/Notes";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { PrivateSpace } from "./Me";

declare global {
  interface Window {
    /** Fully Kiosk Browser's JavaScript interface, when running in it. */
    fully?: { turnScreenOn?: () => void };
  }
}

const statusMeta = (kind: string | null) => STATUS_OPTIONS.find((o) => o.kind === kind);

/** The always-on kitchen screen. Built for distance: big type, no hovering. */
export function WallPage() {
  const { tz, who, viewer, member, members, requestActor } = useSession();
  const { now, today } = useNow(tz, 15_000);
  const connection = useConvexConnectionState();
  const tomorrow = addDays(today, 1);

  const notes = useLastKnown("door", useQ(api.notes.door, {}));
  const summary = useLastKnown("summary", useQ(api.today.summary, { today }));
  const events = useLastKnown("events", useQ(api.calendar.range, { fromDay: today, toDay: tomorrow }));
  const lists = useLastKnown("lists", useQ(api.lists.all, {}));
  const groceriesId = lists.value?.[0]?._id;
  const groceries = useLastKnown("groceries", useQ(api.lists.get, groceriesId ? { listId: groceriesId } : "skip"));
  const thanks = useLastKnown("thanks", useQ(api.thanks.recent, {}));
  const stale =
    notes.stale || summary.stale || (connection.hasEverConnected && !connection.isWebSocketConnected);

  const complete = useM(api.jobs.complete);
  const undo = useM(api.jobs.undo);
  const toggleItem = useM(api.lists.toggleItem);
  const addItem = useM(api.lists.addItem);
  const toast = useToast();

  const [composing, setComposing] = useState(false);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [statusFor, setStatusFor] = useState<Member | null>(null);
  const [grocery, setGrocery] = useState("");

  const hour = zonedParts(now, tz).hour;
  const night = hour >= 21 || hour < 6;

  // Wake the screen (Fully Kiosk) when a new note goes up.
  const newest = notes.value?.reduce((m, n) => Math.max(m, n.createdAt), 0) ?? 0;
  const seen = useRef(newest);
  useEffect(() => {
    if (newest > seen.current) window.fully?.turnScreenOn?.();
    seen.current = newest;
  }, [newest]);

  const todayEvents = events.value?.filter((e) => e.startDay <= today && e.endDay >= today) ?? [];
  const tomorrowEvents = events.value?.filter((e) => e.startDay <= tomorrow && e.endDay >= tomorrow) ?? [];
  const jobsByPerson = members
    .map((m) => ({
      m,
      jobs: summary.value?.jobs.filter((j) => j.assigneeId === m._id) ?? [],
      asks: summary.value?.requests.filter((r) => r.toId === m._id) ?? [],
      done: summary.value?.doneToday.filter((d) => d.memberId === m._id) ?? [],
    }))
    .filter((p) => p.jobs.length || p.asks.length || p.done.length);
  const doorNotes = notes.value ?? [];
  const open = doorNotes.find((n) => n._id === openNote);

  async function doJob(jobId: (typeof jobsByPerson)[number]["jobs"][number]["_id"], title: string) {
    if (!(await requestActor({ title: `Who did “${title}”?` }))) return;
    const completionId = await complete({ jobId });
    if (completionId) {
      toast.show(`Nice! ${title} is done.`, {
        tone: "success",
        action: { label: "Undo", onClick: () => void undo({ completionId }) },
      });
    }
  }

  return (
    <div className={`wall${night ? " night" : ""}`}>
      <header className="wall-top">
        <div className="wall-clock">
          <span className="clock">{formatTime(now, tz)}</span>
          <span className="wall-date">
            {weekdayName(today)}, {formatDate(today, { month: "long", day: "numeric" })}
          </span>
        </div>
        <div className="people-bar" aria-label="Family">
          {members.map((m) => {
            const st = statusMeta(m.status);
            return (
              <button
                key={m._id}
                className={`person${viewer?._id === m._id ? " acting" : ""}`}
                onClick={async () => {
                  if (await requestActor({ only: m._id, title: `Hi ${m.name}!` })) setStatusFor(m);
                }}
              >
                <Avatar member={m} size={54} ring={viewer?._id === m._id} />
                <span className="person-name">{m.name}</span>
                <span className="person-status">{st ? `${st.emoji} ${st.label}` : " "}</span>
              </button>
            );
          })}
        </div>
      </header>

      {stale && <div className="offline-banner">Offline - showing the last known fridge. Changes will sync when the Wi-Fi is back.</div>}

      <main className="wall-grid">
        <section className="wall-col">
          <h2>Today</h2>
          {todayEvents.length === 0 ? (
            <p className="muted">Nothing on the calendar.</p>
          ) : (
            <ul className="wall-events">
              {todayEvents.map((e) => (
                <li key={e._id}>
                  <span className="dot" style={{ background: e.color }} />
                  <span className="event-time">{e.allDay ? "All day" : formatTime(e.start, tz)}</span>
                  <span className="grow">{e.title}</span>
                </li>
              ))}
            </ul>
          )}
          {jobsByPerson.length > 0 && <h2>Jobs</h2>}
          {jobsByPerson.map(({ m, jobs, asks, done }) => (
            <div key={m._id} className="wall-person">
              <div className="wall-person-head">
                <Avatar member={m} size={34} /> <strong>{m.name}</strong>
              </div>
              {jobs.map((j) => (
                <button key={j._id} className={`wall-task${j.overdue ? " overdue" : ""}`} onClick={() => void doJob(j._id, j.title)}>
                  <span className="wall-check" aria-hidden />
                  <span className="grow">
                    {j.emoji} {j.title}
                  </span>
                  {j.overdue && <span className="badge">late</span>}
                </button>
              ))}
              {asks.map((r) => (
                <div key={r._id} className="wall-task ask">
                  <span aria-hidden>🙋</span>
                  <span className="grow">
                    {r.title}
                    <span className="muted small">
                      {" "}
                      - {member(r.fromId)?.name}
                      {r.dueTime ? `, ${formatHHMM(r.dueTime)}` : ""}
                    </span>
                  </span>
                </div>
              ))}
              {done.map((d) => (
                <div key={d.completionId} className="wall-task done">
                  <span className="wall-check on" aria-hidden>
                    ✓
                  </span>
                  <span className="grow">
                    {d.emoji ?? ""} {d.title}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {tomorrowEvents.length > 0 && (
            <>
              <h2 className="soft">Tomorrow</h2>
              <ul className="wall-events soft">
                {tomorrowEvents.slice(0, 5).map((e) => (
                  <li key={e._id}>
                    <span className="dot" style={{ background: e.color }} />
                    <span className="event-time">{e.allDay ? "All day" : formatTime(e.start, tz)}</span>
                    <span className="grow">{e.title}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="wall-col wall-door">
          <div className="row between">
            <h2>{who.household.name}</h2>
            <button className="btn primary" onClick={() => setComposing(true)}>
              ＋ Note
            </button>
          </div>
          {doorNotes.length === 0 ? (
            <p className="muted">The door is empty. Put something up!</p>
          ) : (
            <div className="wall-notes">
              {doorNotes.slice(0, 12).map((n) => (
                <NoteCard key={n._id} note={n} onOpen={() => setOpenNote(n._id)} />
              ))}
            </div>
          )}
        </section>

        <section className="wall-col">
          {groceries.value && (
            <>
              <h2>
                {groceries.value.list.emoji} {groceries.value.list.name}
              </h2>
              <form
                className="add-row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const text = grocery.trim();
                  if (!text || !groceriesId) return;
                  setGrocery("");
                  if ((await addItem({ listId: groceriesId, text })) === undefined) setGrocery(text);
                }}
              >
                <input value={grocery} onChange={(e) => setGrocery(e.target.value)} placeholder="We're out of…" aria-label="Add to groceries" />
                <button className="btn primary" disabled={!grocery.trim()}>
                  Add
                </button>
              </form>
              <ul className="wall-list">
                {groceries.value.items
                  .filter((i) => i.checkedAt === null)
                  .slice(0, 14)
                  .map((i) => (
                    <li key={i._id}>
                      <button className="check" aria-label={`Tick ${i.text}`} onClick={() => void toggleItem({ itemId: i._id })} />
                      {i.text}
                    </li>
                  ))}
              </ul>
            </>
          )}
          {thanks.value && thanks.value.length > 0 && (
            <>
              <h2>💛 Thanks</h2>
              <ul className="wall-thanks">
                {thanks.value.map((t) => (
                  <li key={t._id}>
                    <Avatar member={member(t.fromId)} size={24} />→<Avatar member={member(t.toId)} size={24} />
                    <span className="grow">
                      “{t.text}”{t.what && <span className="muted small"> - {t.what}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <nav className="wall-links">
            <Link to="/lists">Lists</Link>
            <Link to="/jobs?tab=family">Jobs</Link>
            <Link to="/thanks">Thanks</Link>
          </nav>
        </section>
      </main>

      <ActingBar onSpace={() => viewer && setStatusFor(viewer)} />

      {composing && <NoteComposer onClose={() => setComposing(false)} />}
      {open && <NoteDetail note={open} onClose={() => setOpenNote(null)} />}
      {statusFor && <PersonSheet member={statusFor} onClose={() => setStatusFor(null)} />}
    </div>
  );
}

function ActingBar({ onSpace }: { onSpace: () => void }) {
  const { viewer, who, isWall, endActing } = useSession();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!isWall || !viewer) return null;
  const left = Math.max(0, Math.round(((who.session.actingUntil ?? now) - now) / 1000));
  return (
    <div className="acting-bar" role="status">
      <Avatar member={viewer} size={32} />
      <span className="grow">
        <strong>{viewer.name}</strong> is tapped in
        <span className="muted small"> · {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
      </span>
      <button className="btn small" onClick={onSpace}>
        🔒 My space
      </button>
      <button className="btn primary small" onClick={endActing}>
        Done
      </button>
    </div>
  );
}

/** Tapped in on the wall: set your status, open your private space. */
function PersonSheet({ member, onClose }: { member: Member; onClose: () => void }) {
  const { viewer, endActing } = useSession();
  const setStatus = useM(api.members.setStatus);
  const current = viewer?._id === member._id ? viewer.status : member.status;
  return (
    <Sheet
      title={`Hi ${member.name}!`}
      onClose={onClose}
      wide
      footer={
        <button
          className="btn"
          onClick={() => {
            endActing();
            onClose();
          }}
        >
          I'm done
        </button>
      }
    >
      <h3>Where are you?</h3>
      <div className="row wrap">
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.kind}
            className={`chip big${current === o.kind ? " on" : ""}`}
            onClick={() => void setStatus({ status: current === o.kind ? null : o.kind })}
          >
            {o.emoji} {o.label}
          </button>
        ))}
      </div>
      {viewer?._id === member._id && <PrivateSpace />}
    </Sheet>
  );
}

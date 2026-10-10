import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { useM, useQ, useSession } from "../lib/session";
import { formatDate, formatTime, timeAgo, useNow, weekdayName } from "../lib/format";
import { NoteCard, NoteComposer, NoteDetail, type DoorNote } from "../components/Notes";
import { Sortable } from "../components/SortableGrid";
import { EmptyState } from "../components/Controls";
import { Sheet } from "../components/Sheet";
import { Avatar } from "../components/Avatar";
import { PollComposer, PollList } from "../components/Polls";

export function DoorPage() {
  const notes = useQ(api.notes.door, {});
  const move = useM(api.notes.move);
  const [composing, setComposing] = useState<false | true | File>(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [archive, setArchive] = useState(false);
  const pinned = useMemo(() => notes?.filter((n) => n.lifespan === "pinned") ?? [], [notes]);
  const rest = useMemo(() => notes?.filter((n) => n.lifespan !== "pinned") ?? [], [notes]);
  const open = notes?.find((n) => n._id === openId) ?? null;

  const grid = (items: DoorNote[]) => (
    <Sortable
      items={items}
      className="door-grid"
      onMove={(id, before, after) => void move({ noteId: id, beforeId: before, afterId: after })}
      render={(n) => <NoteCard note={n} onOpen={() => setOpenId(n._id)} />}
    />
  );

  return (
    <div className="page door">
      <TodayStrip />
      <PollList />
      {notes === undefined ? (
        <div className="door-grid skeleton" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="note placeholder" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <EmptyState emoji="🧲" title="The fridge door is empty">
          Put up a note, a photo or a doodle. Anyone can post, move or take things down.
        </EmptyState>
      ) : (
        <>
          {pinned.length > 0 && grid(pinned)}
          {rest.length > 0 && grid(rest)}
        </>
      )}
      <p className="center row wrap door-links">
        <Link className="btn ghost small" to="/art">
          🖼️ Art wall
        </Link>
        <button className="btn ghost small" onClick={() => setArchive(true)}>
          Taken down recently
        </button>
      </p>
      <div className="fab-row">
        <label className="fab round" title="Take a photo for the door">
          <span aria-hidden>📸</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Take a photo for the door"
            className="visually-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) setComposing(file);
            }}
          />
        </label>
        <button className="fab round secondary" onClick={() => setPollOpen(true)} aria-label="New poll" title="New poll">
          🗳️
        </button>
        <button className="fab" onClick={() => setComposing(true)} aria-label="New note">
          ＋ Note
        </button>
      </div>
      {composing && (
        <NoteComposer onClose={() => setComposing(false)} initialPhoto={composing instanceof File ? composing : undefined} />
      )}
      {pollOpen && <PollComposer onClose={() => setPollOpen(false)} />}
      {open && <NoteDetail note={open} onClose={() => setOpenId(null)} />}
      {archive && <ArchiveSheet onClose={() => setArchive(false)} />}
    </div>
  );
}

function TodayStrip() {
  const { tz, viewer, member } = useSession();
  const { today } = useNow(tz, 60_000);
  const events = useQ(api.calendar.range, { fromDay: today, toDay: today });
  const summary = useQ(api.today.summary, { today });
  const mine = summary?.jobs.filter((j) => j.assigneeId === viewer?._id) ?? [];
  const asks = summary?.requests.filter((r) => r.toId === viewer?._id) ?? [];
  return (
    <section className="today-strip card" aria-label="Today">
      <div className="today-date">
        <span className="today-weekday">{weekdayName(today)}</span>
        <span className="muted">{formatDate(today, { month: "long", day: "numeric" })}</span>
      </div>
      <ul className="today-events">
        {events === undefined ? null : events.length === 0 ? (
          <li className="muted">Nothing on the calendar today</li>
        ) : (
          events.slice(0, 4).map((e) => (
            <li key={e._id}>
              <span className="dot" style={{ background: e.color }} />
              <span className="event-time">{e.allDay ? "All day" : formatTime(e.start, tz)}</span>
              <Link to="/calendar" className="grow plain-link">
                {e.title}
              </Link>
              {e.memberIds.map((id) => (
                <Avatar key={id} member={member(id)} size={18} />
              ))}
            </li>
          ))
        )}
        {events && events.length > 4 && <li className="muted">+{events.length - 4} more</li>}
      </ul>
      {viewer && (mine.length > 0 || asks.length > 0) && (
        <Link to="/jobs" className="today-mine">
          {mine.length > 0 && (
            <span>
              🧹 {mine.length} job{mine.length > 1 ? "s" : ""} for you today
            </span>
          )}
          {asks.length > 0 && (
            <span>
              🙋 {asks.length} ask{asks.length > 1 ? "s" : ""} from {member(asks[0].fromId)?.name}
              {asks.length > 1 ? " & others" : ""}
            </span>
          )}
        </Link>
      )}
      {summary && summary.doneToday.length > 0 && (
        <div className="today-done" aria-label="Done today">
          {summary.doneToday.slice(-6).map((d) => (
            <span key={d.completionId} className="done-chip" title={`${member(d.memberId)?.name}: ${d.title}`}>
              <Avatar member={member(d.memberId)} size={18} /> {d.emoji ?? "✅"}
            </span>
          ))}
          <span className="muted small">done today</span>
        </div>
      )}
    </section>
  );
}

function ArchiveSheet({ onClose }: { onClose: () => void }) {
  const { member, isParent } = useSession();
  const archived = useQ(api.notes.archived, {});
  const restore = useM(api.notes.restore);
  const del = useM(api.notes.deleteForever);
  return (
    <Sheet title="Taken down (last 30 days)" onClose={onClose}>
      {archived === undefined ? (
        <p className="muted">Loading…</p>
      ) : archived.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <ul className="plain-list">
          {archived.map((n) => (
            <li key={n._id} className={`archived note-bg-${n.color}`}>
              <div className="grow">
                <p className="clamp">{n.text || (n.imageUrl ? "🖼️ Picture" : "")}</p>
                <p className="muted small">
                  by {member(n.authorId)?.name ?? "someone"} ·{" "}
                  {n.expired ? "expired" : `taken down by ${member(n.archivedBy)?.name ?? "someone"}`}{" "}
                  {timeAgo(n.archivedAt)}
                </p>
              </div>
              <button className="btn small" onClick={() => void restore({ noteId: n._id })}>
                Put back
              </button>
              {isParent && (
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (window.confirm("Delete this note for good? This can't be undone.")) {
                      void del({ noteId: n._id });
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

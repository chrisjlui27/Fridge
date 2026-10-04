import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { useM, useQ, useSession, type MemberId } from "../lib/session";
import { addDays, dayLabel, formatHHMM, timeAgo, useNow, weekdayName } from "../lib/format";
import { Avatar, NameTag } from "../components/Avatar";
import { EmptyState, Field, PersonPicker, RotationPicker, Segmented } from "../components/Controls";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";

type Job = FunctionReturnType<typeof api.jobs.list>[number];
type Req = FunctionReturnType<typeof api.requests.active>[number];

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function scheduleText(s: Job["schedule"]) {
  if (s.kind === "every") return s.days === 1 ? "Every day" : s.days === 7 ? "Every week" : `Every ${s.days} days`;
  if (s.weekdays.length === 7) return "Every day";
  // 2026-10-04 is a Sunday; use it to name weekdays in the user's locale.
  return s.weekdays.map((d) => weekdayName(addDays("2026-10-04", d), "short")).join(", ");
}

function dueText(day: string, today: string, time?: string | null) {
  const label = day < today ? `Overdue (${dayLabel(day, today)})` : dayLabel(day, today);
  return time ? `${label}, ${formatHHMM(time)}` : label;
}

export function JobsPage() {
  const { viewer, tz } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "mine" | "family" | null) ?? (viewer ? "mine" : "family");
  const { today } = useNow(tz, 60_000);
  const [asking, setAsking] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | "new" | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Jobs</h1>
        <Segmented
          label="Show"
          value={tab}
          onChange={(v) => setParams({ tab: v }, { replace: true })}
          options={[
            { value: "mine", label: viewer ? "Mine" : "Mine" },
            { value: "family", label: "Family" },
          ]}
        />
      </div>
      {tab === "mine" ? <Mine today={today} /> : <Family today={today} onEdit={setEditingJob} />}
      <div className="fab-row">
        {tab === "family" && (
          <button className="fab secondary" onClick={() => setEditingJob("new")}>
            ＋ Job
          </button>
        )}
        <button className="fab" onClick={() => setAsking(true)}>
          🙋 Ask someone
        </button>
      </div>
      {asking && <AskSheet onClose={() => setAsking(false)} today={today} />}
      {editingJob && (
        <JobEditor job={editingJob === "new" ? undefined : editingJob} today={today} onClose={() => setEditingJob(null)} />
      )}
    </div>
  );
}

function Mine({ today }: { today: string }) {
  const { viewer } = useSession();
  const jobs = useQ(api.jobs.list, viewer ? {} : "skip");
  const reqs = useQ(api.requests.mine, viewer ? {} : "skip");
  if (!viewer) {
    return (
      <EmptyState emoji="👆" title="Tap your picture to see your jobs">
        On the wall, pick who you are first.
      </EmptyState>
    );
  }
  const myJobs = (jobs ?? []).filter((j) => j.assigneeId === viewer._id);
  const soon = myJobs.filter((j) => j.nextDue <= addDays(today, 6));
  const later = myJobs.filter((j) => j.nextDue > addDays(today, 6));
  return (
    <>
      <section>
        <h2>Your turn</h2>
        {jobs === undefined ? (
          <p className="muted">Loading…</p>
        ) : soon.length === 0 ? (
          <p className="muted">Nothing this week. 🎉</p>
        ) : (
          soon.map((j) => <JobCard key={j._id} job={j} today={today} />)
        )}
        {later.length > 0 && (
          <p className="muted small">
            Later: {later.map((j) => `${j.emoji} ${j.title} (${dayLabel(j.nextDue, today)})`).join(" · ")}
          </p>
        )}
      </section>
      <section>
        <h2>Asked of you</h2>
        {!reqs ? null : reqs.toMe.length === 0 ? (
          <p className="muted">No requests right now.</p>
        ) : (
          reqs.toMe.map((r) => <RequestCard key={r._id} r={r} today={today} />)
        )}
      </section>
      <section>
        <h2>You asked</h2>
        {!reqs ? null : reqs.fromMe.length === 0 ? (
          <p className="muted">Need a hand? Ask someone - they can say yes, suggest another time, or say they can't.</p>
        ) : (
          reqs.fromMe.map((r) => <RequestCard key={r._id} r={r} today={today} />)
        )}
      </section>
    </>
  );
}

function Family({ today, onEdit }: { today: string; onEdit: (j: Job) => void }) {
  const jobs = useQ(api.jobs.list, {});
  const reqs = useQ(api.requests.active, {});
  return (
    <>
      <section>
        <h2>Family jobs</h2>
        <p className="muted small">Grown-ups are in the rotation too. Same board, same rules.</p>
        {jobs === undefined ? (
          <p className="muted">Loading…</p>
        ) : jobs.length === 0 ? (
          <EmptyState emoji="🧹" title="No family jobs yet">
            Add the jobs that come round again - dishes, trash, feeding the dog - and who takes turns.
          </EmptyState>
        ) : (
          jobs.map((j) => <JobCard key={j._id} job={j} today={today} onEdit={() => onEdit(j)} showRotation />)
        )}
      </section>
      <section>
        <h2>Open requests</h2>
        {reqs === undefined ? null : reqs.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          reqs.map((r) => <RequestCard key={r._id} r={r} today={today} />)
        )}
      </section>
    </>
  );
}

export function JobCard({
  job,
  today,
  onEdit,
  showRotation = false,
}: {
  job: Job;
  today: string;
  onEdit?: () => void;
  showRotation?: boolean;
}) {
  const { member, viewer, isWall } = useSession();
  const complete = useM(api.jobs.complete);
  const undo = useM(api.jobs.undo);
  const snooze = useM(api.jobs.snooze);
  const toast = useToast();
  const assignee = member(job.assigneeId);
  const due = job.nextDue <= today;
  return (
    <article className={`card job${due ? " due" : ""}${job.nextDue < today ? " overdue" : ""}`}>
      <span className="job-emoji" aria-hidden>
        {job.emoji}
      </span>
      <div className="grow">
        <div className="job-title">{job.title}</div>
        <div className="muted small">
          {dueText(job.nextDue, today)} · {scheduleText(job.schedule)}
          {job.lastDone && ` · last done by ${member(job.lastDone.memberId)?.name ?? "someone"} ${timeAgo(job.lastDone.at)}`}
        </div>
        {showRotation && (
          <div className="rotation" aria-label="Rotation">
            {job.rotation.map((id) => (
              <Avatar key={id} member={member(id)} size={22} ring={id === job.assigneeId} />
            ))}
          </div>
        )}
      </div>
      <div className="job-actions">
        <span className="whose" title="Whose turn">
          <Avatar member={assignee} size={30} />
        </span>
        <button
          className="btn primary small"
          onClick={async () => {
            const completionId = await complete({ jobId: job._id });
            if (completionId) {
              toast.show(`${job.emoji} ${job.title} - done!`, {
                tone: "success",
                action: { label: "Undo", onClick: () => void undo({ completionId }) },
              });
            }
          }}
        >
          Done ✓
        </button>
        {(viewer?._id === job.assigneeId || (isWall && !viewer)) && due && (
          <button className="btn ghost small" onClick={() => void snooze({ jobId: job._id })}>
            Not today
          </button>
        )}
        {onEdit && job.canManage && (
          <button className="btn ghost small" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
    </article>
  );
}

const STATUS_TEXT: Record<Req["status"], string> = {
  open: "Waiting for an answer",
  accepted: "Said yes",
  proposed: "Suggested another time",
  declined: "Can't",
  done: "Done",
  withdrawn: "Withdrawn",
};

export function RequestCard({ r, today }: { r: Req; today: string }) {
  const { member, viewer } = useSession();
  const respond = useM(api.requests.respond);
  const complete = useM(api.requests.complete);
  const acceptProposal = useM(api.requests.acceptProposal);
  const withdraw = useM(api.requests.withdraw);
  const toast = useToast();
  const [answering, setAnswering] = useState<"propose" | "decline" | null>(null);
  const from = member(r.fromId);
  const to = member(r.toId);
  const mineToDo = viewer?._id === r.toId;
  const iAsked = viewer?._id === r.fromId;
  const finished = r.status === "done" || r.status === "withdrawn";

  return (
    <article className={`card request status-${r.status}`}>
      <div className="row">
        <NameTag member={from} />
        <span className="muted">→</span>
        <NameTag member={to} />
        {r.urgent && <span className="badge urgent">time-sensitive</span>}
      </div>
      <div className="request-title">{r.title}</div>
      {r.details && <p className="muted small">{r.details}</p>}
      <div className="muted small">
        {r.dueDate ? dueText(r.dueDate, today, r.dueTime) : "No particular time"} ·{" "}
        <span className={`status-pill ${r.status}`}>{STATUS_TEXT[r.status]}</span>
        {r.status === "proposed" && r.proposedDate && (
          <> - how about {dueText(r.proposedDate, today, r.proposedTime)}?</>
        )}
      </div>
      {r.reply && <p className="reply">“{r.reply}”</p>}
      {!finished && (mineToDo || iAsked) && (
        <div className="row wrap actions">
          {mineToDo && r.status === "open" && (
            <>
              <button className="btn primary small" onClick={() => void respond({ requestId: r._id, response: "accept" })}>
                Yes
              </button>
              <button className="btn small" onClick={() => setAnswering("propose")}>
                Another time
              </button>
              <button className="btn ghost small" onClick={() => setAnswering("decline")}>
                Can't
              </button>
            </>
          )}
          {mineToDo && (r.status === "accepted" || r.status === "open" || r.status === "declined") && (
            <button
              className={`btn small${r.status === "accepted" ? " primary" : ""}`}
              onClick={async () => {
                if (await complete({ requestId: r._id })) {
                  toast.show(`Done - ${from?.name} will see it.`, { tone: "success" });
                }
              }}
            >
              Done ✓
            </button>
          )}
          {mineToDo && r.status === "accepted" && (
            <button className="btn ghost small" onClick={() => setAnswering("decline")}>
              Can't after all
            </button>
          )}
          {mineToDo && r.status === "declined" && (
            <button className="btn ghost small" onClick={() => void respond({ requestId: r._id, response: "accept" })}>
              Actually, I can
            </button>
          )}
          {iAsked && r.status === "proposed" && (
            <button className="btn primary small" onClick={() => void acceptProposal({ requestId: r._id })}>
              That works
            </button>
          )}
          {iAsked && (
            <button className="btn ghost small" onClick={() => void withdraw({ requestId: r._id })}>
              {r.status === "declined" ? "OK, never mind" : "Withdraw"}
            </button>
          )}
        </div>
      )}
      {answering && <AnswerSheet r={r} mode={answering} today={today} onClose={() => setAnswering(null)} />}
    </article>
  );
}

function WhenPicker({
  today,
  date,
  time,
  onDate,
  onTime,
}: {
  today: string;
  date: string;
  time: string;
  onDate: (d: string) => void;
  onTime: (t: string) => void;
}) {
  return (
    <div className="when">
      <div className="row wrap">
        <button type="button" className={`chip${date === "" ? " on" : ""}`} onClick={() => onDate("")}>
          Whenever
        </button>
        <button type="button" className={`chip${date === today ? " on" : ""}`} onClick={() => onDate(today)}>
          Today
        </button>
        <button
          type="button"
          className={`chip${date === addDays(today, 1) ? " on" : ""}`}
          onClick={() => onDate(addDays(today, 1))}
        >
          Tomorrow
        </button>
        <input type="date" value={date} min={today} onChange={(e) => onDate(e.target.value)} aria-label="Date" />
      </div>
      {date && (
        <input type="time" value={time} onChange={(e) => onTime(e.target.value)} aria-label="Time (optional)" />
      )}
    </div>
  );
}

function AnswerSheet({
  r,
  mode,
  today,
  onClose,
}: {
  r: Req;
  mode: "propose" | "decline";
  today: string;
  onClose: () => void;
}) {
  const respond = useM(api.requests.respond);
  const [date, setDate] = useState(r.dueDate ?? addDays(today, 1));
  const [time, setTime] = useState(r.dueTime ?? "");
  const [reply, setReply] = useState("");
  return (
    <Sheet
      title={mode === "propose" ? "Suggest another time" : "Can't do it"}
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          disabled={mode === "propose" && !date}
          onClick={async () => {
            const ok = await respond({
              requestId: r._id,
              response: mode,
              proposedDate: mode === "propose" ? date : undefined,
              proposedTime: mode === "propose" && time ? time : undefined,
              reply: reply || undefined,
            });
            if (ok !== undefined) onClose();
          }}
        >
          Send
        </button>
      }
    >
      <p className="request-title">{r.title}</p>
      {mode === "propose" && <WhenPicker today={today} date={date} time={time} onDate={setDate} onTime={setTime} />}
      <Field label={mode === "propose" ? "Note (optional)" : "Why not? (optional)"}>
        <input
          value={reply}
          maxLength={280}
          onChange={(e) => setReply(e.target.value)}
          placeholder={mode === "propose" ? "Practice runs late Thursday" : "I have a test that day"}
        />
      </Field>
    </Sheet>
  );
}

function AskSheet({ onClose, today }: { onClose: () => void; today: string }) {
  const { members, viewer } = useSession();
  const create = useM(api.requests.create);
  const [toId, setToId] = useState<MemberId | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [urgent, setUrgent] = useState(false);
  const to = members.find((m) => m._id === toId);
  return (
    <Sheet
      title="Ask someone"
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          disabled={!toId || !title.trim()}
          onClick={async () => {
            const id = await create({
              toId: toId!,
              title,
              details: details || undefined,
              dueDate: date || undefined,
              dueTime: date && time ? time : undefined,
              urgent,
            });
            if (id) onClose();
          }}
        >
          Send request
        </button>
      }
    >
      <Field label="Ask">
        <PersonPicker
          members={members.filter((m) => m._id !== viewer?._id)}
          value={toId}
          onChange={setToId}
          label="Who to ask"
        />
      </Field>
      <Field label="What?">
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Poster board for Thursday" />
      </Field>
      <Field label="When?">
        <WhenPicker today={today} date={date} time={time} onDate={setDate} onTime={setTime} />
      </Field>
      <Field label="Details (optional)">
        <textarea rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
        <span>
          Time-sensitive - notify {to?.name ?? "them"} now
          <span className="field-hint"> (asks due today notify anyway; the rest wait for the evening summary)</span>
        </span>
      </label>
    </Sheet>
  );
}

function JobEditor({ job, today, onClose }: { job?: Job; today: string; onClose: () => void }) {
  const { members } = useSession();
  const create = useM(api.jobs.create);
  const update = useM(api.jobs.update);
  const archive = useM(api.jobs.archive);
  const [title, setTitle] = useState(job?.title ?? "");
  const [emoji, setEmoji] = useState(job?.emoji ?? "🧹");
  const [rotation, setRotation] = useState<MemberId[]>(job?.rotation ?? members.map((m) => m._id));
  const [kind, setKind] = useState<"every" | "weekly">(job?.schedule.kind ?? "every");
  const [days, setDays] = useState(job?.schedule.kind === "every" ? job.schedule.days : 1);
  const [weekdays, setWeekdays] = useState<number[]>(job?.schedule.kind === "weekly" ? job.schedule.weekdays : [1]);
  const [nextDue, setNextDue] = useState(job?.nextDue ?? today);
  const [notes, setNotes] = useState(job?.notes ?? "");
  const schedule = kind === "every" ? { kind, days } : { kind, weekdays };

  async function save() {
    const ok = job
      ? await update({ jobId: job._id, title, emoji, rotation, schedule, nextDue, notes })
      : await create({ title, emoji, rotation, schedule, firstDue: nextDue, notes: notes || undefined });
    if (ok !== undefined) onClose();
  }

  return (
    <Sheet
      title={job ? "Edit job" : "New family job"}
      onClose={onClose}
      footer={
        <>
          {job && (
            <button
              className="btn ghost danger"
              onClick={async () => {
                if (window.confirm(`Remove "${job.title}"?`) && (await archive({ jobId: job._id })) !== undefined) {
                  onClose();
                }
              }}
            >
              Remove
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!title.trim() || rotation.length === 0}>
            Save
          </button>
        </>
      }
    >
      <div className="row">
        <input
          className="emoji-input"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value.slice(-2) || "🧹")}
          aria-label="Emoji"
        />
        <input
          className="grow"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Unload the dishwasher"
          maxLength={60}
          aria-label="Job name"
        />
      </div>
      <Field label="Who takes turns (in order)" hint="Include the grown-ups - kids notice when rules only apply to them.">
        <RotationPicker members={members} value={rotation} onChange={setRotation} />
      </Field>
      <Field label="How often">
        <Segmented
          label="Schedule"
          value={kind}
          onChange={setKind}
          options={[
            { value: "every", label: "Every few days" },
            { value: "weekly", label: "On set days" },
          ]}
        />
      </Field>
      {kind === "every" ? (
        <Field label="Days between" hint="Counts from when it was actually done.">
          <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} />
        </Field>
      ) : (
        <div className="row wrap" role="group" aria-label="Days of the week">
          {WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={weekdays.includes(d)}
              className={`chip${weekdays.includes(d) ? " on" : ""}`}
              onClick={() =>
                setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d].sort())
              }
            >
              {weekdayName(addDays("2026-10-04", d), "short")}
            </button>
          ))}
        </div>
      )}
      <Field label={job ? "Next due" : "First time"}>
        <input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
      </Field>
      <Field label="Notes (optional)" hint="What does 'done' look like?">
        <input value={notes} maxLength={280} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Sheet>
  );
}

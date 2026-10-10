import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { useM, useQ, useSession } from "../lib/session";
import { addDays, dayLabel, localDay, useNow } from "../lib/format";
import { Avatar } from "./Avatar";
import { Field, Segmented } from "./Controls";
import { Sheet } from "./Sheet";

type Poll = FunctionReturnType<typeof api.polls.active>[number];

/** Open polls (and ones that closed in the last day) at the top of the door. */
export function PollList({ big = false }: { big?: boolean }) {
  const polls = useQ(api.polls.active, {});
  if (!polls || polls.length === 0) return null;
  return (
    <div className={`polls${big ? " big" : ""}`}>
      {polls.map((p) => (
        <PollCard key={p._id} poll={p} />
      ))}
    </div>
  );
}

function closesText(p: Poll, now: number, tz: string) {
  const today = localDay(now, tz);
  // Polls close at midnight at the end of the chosen day.
  const lastDay = addDays(localDay(p.closesAt, tz), -1);
  if (lastDay === today) return "Closes tonight";
  if (lastDay === addDays(today, 1)) return "Closes tomorrow night";
  return `Closes ${dayLabel(lastDay, today)} night`;
}

export function PollCard({ poll }: { poll: Poll }) {
  const { member, tz } = useSession();
  const { now } = useNow(tz, 30_000);
  const vote = useM(api.polls.vote);
  const close = useM(api.polls.close);
  const remove = useM(api.polls.remove);
  const open = poll.closedAt === null && poll.closesAt > now;
  const total = poll.options.reduce((n, o) => n + o.voters.length, 0);
  const top = Math.max(0, ...poll.options.map((o) => o.voters.length));
  const winners = poll.options.filter((o) => top > 0 && o.voters.length === top);
  const author = member(poll.authorId);

  return (
    <article className={`card poll${open ? "" : " closed"}`} aria-label={`Poll: ${poll.question}`}>
      <div className="poll-head">
        <span aria-hidden>🗳️</span>
        <h3 className="grow">{poll.question}</h3>
        <Avatar member={author} size={24} title={`Asked by ${author?.name}`} />
      </div>
      <div className="poll-options">
        {poll.options.map((o) => {
          const mine = poll.myVote === o.id;
          const pct = total ? Math.round((o.voters.length / total) * 100) : 0;
          const won = !open && winners.some((w) => w.id === o.id);
          return (
            <button
              key={o.id}
              className={`poll-option${mine ? " mine" : ""}${won ? " won" : ""}`}
              disabled={!open}
              aria-pressed={mine}
              onClick={() => void vote({ pollId: poll._id, optionId: o.id })}
            >
              <span className="poll-fill" style={{ width: `${pct}%` }} aria-hidden />
              <span className="poll-text">
                {won && "🏆 "}
                {o.text}
                {mine && <span className="muted small"> · your pick</span>}
              </span>
              <span className="poll-voters">
                {o.voters.map((id) => (
                  <Avatar key={id} member={member(id)} size={20} />
                ))}
                <span className="poll-count">{o.voters.length}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="row between poll-foot">
        <span className="muted small">
          {open
            ? `${closesText(poll, now, tz)} · ${total} vote${total === 1 ? "" : "s"}`
            : winners.length > 1
              ? `Closed - it's a tie!`
              : winners.length === 1
                ? `Closed - ${winners[0].text} wins`
                : "Closed - nobody voted"}
        </span>
        {poll.canManage && (
          <span className="row">
            {open && (
              <button className="btn ghost small" onClick={() => void close({ pollId: poll._id })}>
                Close now
              </button>
            )}
            <button className="btn ghost small" onClick={() => void remove({ pollId: poll._id })}>
              Take down
            </button>
          </span>
        )}
      </div>
    </article>
  );
}

export function PollComposer({ onClose }: { onClose: () => void }) {
  const create = useM(api.polls.create);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [closes, setCloses] = useState<"today" | "tomorrow" | "3days" | "week">("tomorrow");
  const [busy, setBusy] = useState(false);
  const filled = options.filter((o) => o.trim()).length;
  return (
    <Sheet
      title="New poll"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || !question.trim() || filled < 2}
            onClick={async () => {
              setBusy(true);
              const id = await create({ question, options, closes });
              setBusy(false);
              if (id) onClose();
            }}
          >
            Put it on the fridge
          </button>
        </>
      }
    >
      <Field label="Question">
        <input autoFocus value={question} maxLength={140} onChange={(e) => setQuestion(e.target.value)} placeholder="Friday dinner?" />
      </Field>
      <Field label="Choices">
        <div className="stack">
          {options.map((o, i) => (
            <div key={i} className="row">
              <input
                value={o}
                maxLength={60}
                aria-label={`Choice ${i + 1}`}
                placeholder={["Pizza", "Tacos", "Breakfast for dinner", "Leftovers", "", ""][i]}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {options.length > 2 && (
                <button
                  className="icon-btn subtle"
                  aria-label={`Remove choice ${i + 1}`}
                  onClick={() => setOptions(options.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <button className="btn ghost small" onClick={() => setOptions([...options, ""])}>
              ＋ Add a choice
            </button>
          )}
        </div>
      </Field>
      <Field label="Voting closes">
        <Segmented
          label="Voting closes"
          value={closes}
          onChange={setCloses}
          options={[
            { value: "today", label: "Tonight" },
            { value: "tomorrow", label: "Tomorrow" },
            { value: "3days", label: "In 3 days" },
            { value: "week", label: "In a week" },
          ]}
        />
      </Field>
    </Sheet>
  );
}

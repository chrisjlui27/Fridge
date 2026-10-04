import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useM, useQ, useSession, type MemberId } from "../lib/session";
import { Avatar } from "../components/Avatar";
import { EmptyState, Field, PersonPicker } from "../components/Controls";
import { Sheet } from "../components/Sheet";
import { Sortable } from "../components/SortableGrid";
import { useToast } from "../components/Toast";

export function ListsPage() {
  const lists = useQ(api.lists.all, {});
  const { member } = useSession();
  const [creating, setCreating] = useState(false);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Lists</h1>
        <Link className="btn ghost small" to="/owners">
          Who owns what
        </Link>
      </div>
      {lists === undefined ? (
        <p className="muted">Loading…</p>
      ) : lists.length === 0 ? (
        <EmptyState emoji="🛒" title="No lists yet" />
      ) : (
        <div className="list-cards">
          {lists.map((l) => (
            <Link key={l._id} to={`/lists/${l._id}`} className="card list-card">
              <span className="list-emoji" aria-hidden>
                {l.emoji}
              </span>
              <span className="grow">
                <span className="list-name">{l.name}</span>
                <span className="muted small clamp">
                  {l.openCount === 0 ? "All done" : l.preview.join(", ") + (l.openCount > 3 ? "…" : "")}
                </span>
              </span>
              <span className="list-meta">
                <span className="count">{l.openCount}</span>
                <Avatar member={member(l.ownerId)} size={24} title={`Owner: ${member(l.ownerId)?.name}`} />
              </span>
            </Link>
          ))}
        </div>
      )}
      <button className="fab" onClick={() => setCreating(true)} aria-label="New list">
        ＋ List
      </button>
      {creating && <ListEditor onClose={() => setCreating(false)} />}
    </div>
  );
}

export function ListDetailPage() {
  const { listId } = useParams();
  const id = listId as Id<"lists">;
  const data = useQ(api.lists.get, { listId: id });
  const { member } = useSession();
  const add = useM(api.lists.addItem);
  const toggle = useM(api.lists.toggleItem);
  const remove = useM(api.lists.removeItem);
  const move = useM(api.lists.moveItem);
  const clear = useM(api.lists.clearChecked);
  const toast = useToast();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);

  if (data === undefined) return <div className="page muted">Loading…</div>;
  if (data === null)
    return (
      <div className="page">
        <EmptyState emoji="🤷" title="That list is gone">
          <Link to="/lists">Back to lists</Link>
        </EmptyState>
      </div>
    );
  const { list, items } = data;
  const open = items.filter((i) => i.checkedAt === null);
  const done = items.filter((i) => i.checkedAt !== null);
  const owner = member(list.ownerId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    if ((await add({ listId: id, text: value })) === undefined) setText(value);
  }

  return (
    <div className="page">
      <div className="page-head">
        <Link to="/lists" className="icon-btn" aria-label="Back to lists">
          ←
        </Link>
        <h1 className="grow">
          {list.emoji} {list.name}
        </h1>
        {list.canManage && (
          <button className="btn ghost small" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      <div className="owner-line">
        <Avatar member={owner} size={24} />
        <span>
          <strong>{owner?.name}</strong> owns this list: noticing, planning, getting it and checking. Anyone can add.
          {list.standard && <span className="standard"> Agreed standard: {list.standard}</span>}
        </span>
      </div>
      <form className="add-row" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Add to ${list.name}…`}
          aria-label={`Add to ${list.name}`}
          enterKeyHint="done"
          maxLength={120}
        />
        <button className="btn primary" disabled={!text.trim()}>
          Add
        </button>
      </form>
      {open.length === 0 && done.length === 0 && <p className="muted center">Nothing on this list.</p>}
      <Sortable
        items={open}
        layout="list"
        className="items"
        onMove={(itemId, before, after) => void move({ itemId, beforeId: before, afterId: after })}
        render={(i) => (
          <div className="item">
            <button className="check" aria-label={`Tick ${i.text}`} onClick={() => void toggle({ itemId: i._id })} />
            <span className="grow">{i.text}</span>
            <Avatar member={member(i.addedBy)} size={20} title={`Added by ${member(i.addedBy)?.name}`} />
            <button
              className="icon-btn subtle"
              aria-label={`Remove ${i.text}`}
              onClick={async () => {
                if ((await remove({ itemId: i._id })) !== undefined) {
                  toast.show(`Removed ${i.text}`, {
                    action: { label: "Undo", onClick: () => void add({ listId: id, text: i.text }) },
                  });
                }
              }}
            >
              ✕
            </button>
          </div>
        )}
      />
      {done.length > 0 && (
        <>
          <div className="row between done-head">
            <span className="muted small">Ticked</span>
            <button className="btn ghost small" onClick={() => void clear({ listId: id })}>
              Clear ticked
            </button>
          </div>
          <div className="items">
            {done.map((i) => (
              <div key={i._id} className="item done">
                <button
                  className="check on"
                  aria-label={`Untick ${i.text}`}
                  onClick={() => void toggle({ itemId: i._id })}
                >
                  ✓
                </button>
                <span className="grow">{i.text}</span>
                <Avatar member={member(i.checkedBy)} size={20} title={`Ticked by ${member(i.checkedBy)?.name}`} />
              </div>
            ))}
          </div>
        </>
      )}
      {editing && <ListEditor list={list} onClose={() => setEditing(false)} />}
    </div>
  );
}

type ListInfo = {
  _id: Id<"lists">;
  name: string;
  emoji: string;
  ownerId: MemberId;
  standard: string | null;
};

const LIST_EMOJI = ["🛒", "🎯", "🎒", "🏕️", "🎁", "🎈", "🏠", "💊", "🐶", "🧺", "📚", "✈️"];

export function ListEditor({ list, onClose }: { list?: ListInfo; onClose: () => void }) {
  const { members, viewer, isParent } = useSession();
  const create = useM(api.lists.create);
  const update = useM(api.lists.update);
  const archive = useM(api.lists.archive);
  const navigate = useNavigate();
  const [name, setName] = useState(list?.name ?? "");
  const [emoji, setEmoji] = useState(list?.emoji ?? "🛒");
  const [ownerId, setOwnerId] = useState<MemberId | null>(list?.ownerId ?? viewer?._id ?? members[0]?._id);
  const [standard, setStandard] = useState(list?.standard ?? "");

  async function save() {
    if (!ownerId) return;
    if (list) {
      const ok = await update({ listId: list._id, name, emoji, ownerId, standard });
      if (ok !== undefined) onClose();
    } else {
      const id = await create({ name, emoji, ownerId, standard });
      if (id) {
        onClose();
        navigate(`/lists/${id}`);
      }
    }
  }

  return (
    <Sheet
      title={list ? "Edit list" : "New list"}
      onClose={onClose}
      footer={
        <>
          {list && isParent && (
            <button
              className="btn ghost danger"
              onClick={async () => {
                if (!window.confirm(`Archive ${list.name}?`)) return;
                if ((await archive({ listId: list._id })) !== undefined) {
                  onClose();
                  navigate("/lists");
                }
              }}
            >
              Archive
            </button>
          )}
          <button className="btn primary" onClick={save} disabled={!name.trim() || !ownerId}>
            Save
          </button>
        </>
      }
    >
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Groceries" />
      </Field>
      <div className="emoji-grid small" role="radiogroup" aria-label="List icon">
        {LIST_EMOJI.map((e) => (
          <button key={e} type="button" className={emoji === e ? "on" : ""} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <Field
        label="Owner"
        hint="The owner does the noticing, planning and checking for this area - not just the shopping."
      >
        <PersonPicker members={members} value={ownerId} onChange={setOwnerId} label="List owner" />
      </Field>
      <Field label="Agreed standard (optional)" hint='e.g. "Never out of milk, bread or fruit"'>
        <input value={standard} onChange={(e) => setStandard(e.target.value)} maxLength={280} />
      </Field>
    </Sheet>
  );
}

/** The weekly "re-deal": who owns which area, and who's in which rotation. */
export function OwnersPage() {
  const lists = useQ(api.lists.all, {});
  const jobs = useQ(api.jobs.list, {});
  const { member, members } = useSession();
  const [editing, setEditing] = useState<ListInfo | null>(null);
  const count = (id: MemberId) =>
    (lists?.filter((l) => l.ownerId === id).length ?? 0) + (jobs?.filter((j) => j.rotation.includes(id)).length ?? 0);
  return (
    <div className="page">
      <div className="page-head">
        <Link to="/lists" className="icon-btn" aria-label="Back">
          ←
        </Link>
        <h1>Who owns what</h1>
      </div>
      <p className="muted">
        Agree on these at the family table every week or two - then let the fridge remember. Owning an area means
        noticing, planning and checking it, not just doing what you're told.
      </p>
      <div className="owner-summary">
        {members.map((m) => (
          <span key={m._id} className="chip static">
            <Avatar member={m} size={22} /> {m.name} · {count(m._id)}
          </span>
        ))}
      </div>
      <h2>Areas</h2>
      <ul className="plain-list">
        {lists?.map((l) => (
          <li key={l._id} className="card row">
            <span className="list-emoji">{l.emoji}</span>
            <span className="grow">
              <strong>{l.name}</strong>
              <span className="muted small block">{l.standard ?? "No standard agreed yet"}</span>
            </span>
            <Avatar member={member(l.ownerId)} size={28} />
            <button className="btn ghost small" onClick={() => setEditing(l)}>
              Change
            </button>
          </li>
        ))}
      </ul>
      <h2>Family jobs</h2>
      <ul className="plain-list">
        {jobs?.map((j) => (
          <li key={j._id} className="card row">
            <span className="list-emoji">{j.emoji}</span>
            <span className="grow">
              <strong>{j.title}</strong>
              <span className="rotation small">
                {j.rotation.map((id) => (
                  <Avatar key={id} member={member(id)} size={20} ring={id === j.assigneeId} />
                ))}
              </span>
            </span>
            <Link className="btn ghost small" to="/jobs?tab=family">
              Edit
            </Link>
          </li>
        ))}
      </ul>
      {editing && <ListEditor list={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

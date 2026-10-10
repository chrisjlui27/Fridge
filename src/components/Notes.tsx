import { useEffect, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useM, useSession, type MemberId } from "../lib/session";
import { resizeImage, uploadBlob } from "../lib/images";
import { formatTime, timeAgo } from "../lib/format";
import { Avatar } from "./Avatar";
import { ColorPicker, Field, PersonPicker, Segmented, type NoteColor } from "./Controls";
import { DoodlePad } from "./DoodlePad";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

export type DoorNote = FunctionReturnType<typeof api.notes.door>[number];
type Lifespan = DoorNote["lifespan"];

const LIFESPANS: { value: Lifespan; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "keep", label: "Until removed" },
  { value: "pinned", label: "📌 Pin" },
];

function lifespanBadge(n: DoorNote, tz: string) {
  if (n.lifespan === "pinned") return "📌";
  if (n.lifespan === "today") return n.expiresAt ? `until ${formatTime(n.expiresAt - 1, tz)}` : "today";
  if (n.lifespan === "week") return "this week";
  return null;
}

export function NoteCard({ note, onOpen, big = false }: { note: DoorNote; onOpen?: () => void; big?: boolean }) {
  const { member, tz } = useSession();
  const author = member(note.authorId);
  const to = note.toId ? member(note.toId) : null;
  const badge = lifespanBadge(note, tz);
  // A stable little tilt, like a real note held by a magnet.
  const tilt = ((note._id.charCodeAt(note._id.length - 1) % 5) - 2) * 0.6;
  return (
    <article
      className={`note note-bg-${note.color}${big ? " big" : ""}${note.lifespan === "pinned" ? " pinned" : ""}`}
      style={{ ["--tilt" as string]: `${tilt}deg` }}
    >
      <button className="note-hit" onClick={onOpen} aria-label={`Open note from ${author?.name ?? "someone"}`}>
        <span className="magnet" style={{ background: author?.color }} aria-hidden />
        {to && (
          <span className="note-to">
            for <Avatar member={to} size={18} /> {to.name}
          </span>
        )}
        {note.imageUrl && (
          <img
            className={`note-img ${note.imageKind ?? ""}`}
            src={note.imageUrl}
            alt={note.imageKind === "doodle" ? `Drawing by ${author?.name}` : `Photo from ${author?.name}`}
            loading="lazy"
          />
        )}
        {note.text && <p className="note-text">{note.text}</p>}
        <span className="note-foot">
          <Avatar member={author} size={20} />
          <span className="note-author">{author?.name}</span>
          {badge && <span className="badge">{badge}</span>}
          {note.gotIt.length > 0 && (
            <span className="badge got" title="Got it">
              👍{" "}
              {note.gotIt
                .map((id) => member(id)?.name)
                .filter(Boolean)
                .join(", ")}
            </span>
          )}
        </span>
      </button>
    </article>
  );
}

/** Write a note, or edit one you're allowed to edit. */
export function NoteComposer({
  onClose,
  editing,
  initialPhoto,
}: {
  onClose: () => void;
  editing?: DoorNote;
  /** A photo just taken with the camera shortcut. */
  initialPhoto?: File;
}) {
  const { members, viewer } = useSession();
  const toast = useToast();
  const create = useM(api.notes.create);
  const edit = useM(api.notes.edit);
  const uploadUrl = useM(api.notes.generateUploadUrl);
  const [text, setText] = useState(editing?.text ?? "");
  const [color, setColor] = useState<NoteColor>((editing?.color as NoteColor) ?? "yellow");
  const [toId, setToId] = useState<MemberId | null>(editing?.toId ?? null);
  const [lifespan, setLifespan] = useState<Lifespan>(editing?.lifespan ?? "today");
  const [ping, setPing] = useState(false);
  const [image, setImage] = useState<{ blob: Blob; kind: "photo" | "doodle"; url: string } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );

  const usedInitial = useRef(false);
  useEffect(() => {
    if (initialPhoto && !usedInitial.current) {
      usedInitial.current = true;
      void pickPhoto(initialPhoto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPhoto]);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await resizeImage(file);
      setImage({ blob, kind: "photo", url: URL.createObjectURL(blob) });
    } catch (e) {
      toast.show((e as Error).message, { tone: "error" });
    }
  }

  async function submit() {
    if (!text.trim() && !image && !editing?.imageUrl) {
      toast.show("Write something or add a picture.", { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const ok = await edit({ noteId: editing._id, text, color, lifespan, toId });
        if (ok !== undefined) onClose();
        return;
      }
      let imageId: Id<"_storage"> | undefined;
      if (image) {
        const url = await uploadUrl({});
        if (!url) return;
        imageId = (await uploadBlob(url, image.blob)) as Id<"_storage">;
      }
      const id = await create({
        text,
        color,
        lifespan,
        toId: toId ?? undefined,
        imageId,
        imageKind: image?.kind,
        ping: toId !== null && ping,
      });
      if (id) onClose();
    } catch (e) {
      toast.show((e as Error).message || "Couldn't post that.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (drawing) {
    return (
      <Sheet title="Draw something" onClose={() => setDrawing(false)} wide>
        <DoodlePad
          onCancel={() => setDrawing(false)}
          onDone={(blob) => {
            setImage({ blob, kind: "doodle", url: URL.createObjectURL(blob) });
            setDrawing(false);
          }}
        />
      </Sheet>
    );
  }

  const others = members.filter((m) => m._id !== viewer?._id);
  return (
    <Sheet
      title={editing ? "Edit note" : "New note"}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? "Posting…" : editing ? "Save" : "Put it on the fridge"}
          </button>
        </>
      }
    >
      <div className={`compose-note note-bg-${color}`}>
        {(image || editing?.imageUrl) && (
          <div className="compose-img">
            <img src={image?.url ?? editing?.imageUrl ?? ""} alt="" />
            {image && (
              <button className="icon-btn" onClick={() => setImage(null)} aria-label="Remove picture">
                ✕
              </button>
            )}
          </div>
        )}
        <textarea
          autoFocus
          value={text}
          maxLength={500}
          rows={4}
          placeholder="Practice moved to 5… Love you… Out of milk…"
          onChange={(e) => setText(e.target.value)}
          aria-label="Note text"
        />
      </div>
      {!editing && (
        <div className="row wrap">
          <label className="btn ghost small file-btn">
            📸 Take photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Take a photo"
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <label className="btn ghost small file-btn">
            🖼️ Choose photo
            <input
              type="file"
              accept="image/*"
              aria-label="Choose a photo"
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <button className="btn ghost small" onClick={() => setDrawing(true)}>
            ✏️ Draw
          </button>
        </div>
      )}
      <Field label="Colour">
        <ColorPicker value={color} onChange={setColor} />
      </Field>
      <Field label="For">
        <PersonPicker members={others} value={toId} onChange={setToId} allowEveryone label="Who it's for" />
      </Field>
      <Field label="How long should it stay up?">
        <Segmented value={lifespan} options={LIFESPANS} onChange={setLifespan} label="How long it stays" />
      </Field>
      {!editing && toId && (
        <label className="check-row">
          <input type="checkbox" checked={ping} onChange={(e) => setPing(e.target.checked)} />
          <span>
            Time-sensitive: send {members.find((m) => m._id === toId)?.name} a notification now
            <span className="field-hint"> (otherwise they'll see it on the fridge or in tonight's summary)</span>
          </span>
        </label>
      )}
    </Sheet>
  );
}

/** A note, big, with what you can do with it. */
export function NoteDetail({ note, onClose }: { note: DoorNote; onClose: () => void }) {
  const { viewer, isWall, member, requestActor } = useSession();
  const toast = useToast();
  const gotIt = useM(api.notes.gotIt);
  const takeDown = useM(api.notes.takeDown);
  const restore = useM(api.notes.restore);
  const [editing, setEditing] = useState(false);
  const author = member(note.authorId);
  const canGetIt =
    note.authorId !== viewer?._id && (note.toId === null || note.toId === viewer?._id || (isWall && !viewer));
  const alreadyGot = viewer ? note.gotIt.includes(viewer._id) : false;

  if (editing) return <NoteComposer editing={note} onClose={onClose} />;

  return (
    <Sheet
      title={`Note from ${author?.name ?? "someone"}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn ghost"
            onClick={async () => {
              if ((await takeDown({ noteId: note._id })) !== undefined) {
                toast.show("Taken down.", {
                  action: { label: "Undo", onClick: () => void restore({ noteId: note._id }) },
                });
                onClose();
              }
            }}
          >
            Take down
          </button>
          {note.canEdit && (
            <button className="btn ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {canGetIt && !alreadyGot && (
            <button
              className="btn primary"
              onClick={async () => {
                if (isWall && note.toId && !(await requestActor({ only: note.toId }))) return;
                if ((await gotIt({ noteId: note._id })) !== undefined) onClose();
              }}
            >
              👍 Got it
            </button>
          )}
        </>
      }
    >
      <NoteCard note={note} big />
      <p className="muted small center">
        Posted {timeAgo(note.createdAt)}
        {note.editedAt ? " · edited" : ""}
      </p>
    </Sheet>
  );
}

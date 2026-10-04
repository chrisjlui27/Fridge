import type { ReactNode } from "react";
import type { Member, MemberId } from "../lib/session";
import { Avatar } from "./Avatar";

export const NOTE_COLORS = ["yellow", "pink", "blue", "green", "orange", "purple", "white"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export function ColorPicker({ value, onChange }: { value: NoteColor; onChange: (c: NoteColor) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Note colour">
      {NOTE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className={`swatch note-bg-${c}${value === c ? " on" : ""}`}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pick one person (or "everyone" when allowEveryone). */
export function PersonPicker({
  members,
  value,
  onChange,
  allowEveryone = false,
  label,
}: {
  members: Member[];
  value: MemberId | null;
  onChange: (id: MemberId | null) => void;
  allowEveryone?: boolean;
  label: string;
}) {
  return (
    <div className="person-picker" role="radiogroup" aria-label={label}>
      {allowEveryone && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          className={`chip${value === null ? " on" : ""}`}
          onClick={() => onChange(null)}
        >
          👪 Everyone
        </button>
      )}
      {members.map((m) => (
        <button
          key={m._id}
          type="button"
          role="radio"
          aria-checked={value === m._id}
          className={`chip${value === m._id ? " on" : ""}`}
          onClick={() => onChange(m._id)}
        >
          <Avatar member={m} size={22} /> {m.name}
        </button>
      ))}
    </div>
  );
}

/** Pick several people, in order (for job rotations). */
export function RotationPicker({
  members,
  value,
  onChange,
}: {
  members: Member[];
  value: MemberId[];
  onChange: (ids: MemberId[]) => void;
}) {
  return (
    <div className="person-picker" aria-label="Who takes turns">
      {members.map((m) => {
        const idx = value.indexOf(m._id);
        return (
          <button
            key={m._id}
            type="button"
            aria-pressed={idx >= 0}
            className={`chip${idx >= 0 ? " on" : ""}`}
            onClick={() => onChange(idx >= 0 ? value.filter((x) => x !== m._id) : [...value, m._id])}
          >
            {idx >= 0 && <span className="chip-num">{idx + 1}</span>}
            <Avatar member={m} size={22} /> {m.name}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-emoji" aria-hidden>
        {emoji}
      </div>
      <p className="empty-title">{title}</p>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export const EMOJI_CHOICES = [
  "🦊", "🐢", "🦄", "🐼", "🦁", "🐙", "🐝", "🦋", "🐸", "🐧", "🐶", "🐱",
  "🌻", "🌈", "⭐", "🚀", "⚽", "🎸", "🎨", "📚", "🧔", "👩", "👨", "👵",
];

export function EmojiPicker({ value, onChange }: { value: string; onChange: (e: string) => void }) {
  return (
    <div className="emoji-grid" role="radiogroup" aria-label="Picture">
      {EMOJI_CHOICES.map((e) => (
        <button
          key={e}
          type="button"
          role="radio"
          aria-checked={value === e}
          className={value === e ? "on" : ""}
          onClick={() => onChange(e)}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

export const MEMBER_COLORS = ["#e4572e", "#f3a712", "#29bf12", "#17bebb", "#4c6ef5", "#9c36b5", "#e64980", "#795548"];

export function MemberColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Colour">
      {MEMBER_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className={`swatch round${value === c ? " on" : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

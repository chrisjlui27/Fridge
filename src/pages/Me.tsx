import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { STATUS_OPTIONS } from "../../convex/lib/constants";
import { useA, useM, useQ, useSession } from "../lib/session";
import { currentSubscription, pushSupport, subscribePush } from "../lib/push";
import { Avatar } from "../components/Avatar";
import { ColorPicker, EmojiPicker, Field, MemberColorPicker, type NoteColor } from "../components/Controls";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";

export function MePage() {
  const { viewer, isWall, isParent, who, signOut } = useSession();
  if (!viewer) {
    return (
      <div className="page">
        <h1>Me</h1>
        <p className="muted">This is the shared wall screen. Tap your picture on the wall to see your own space.</p>
        <Link className="btn" to="/wall">
          Back to the wall
        </Link>
      </div>
    );
  }
  return (
    <div className="page me">
      <div className="page-head">
        <Avatar member={viewer} size={48} />
        <h1 className="grow">{viewer.name}</h1>
        {isParent && (
          <Link className="btn small" to="/family">
            ⚙️ Family settings
          </Link>
        )}
      </div>
      <StatusPicker />
      <PrivateSpace />
      {!isWall && <Notifications />}
      <Profile />
      <section className="card">
        <h2>This device</h2>
        <p className="muted small">
          {who.session.label} · {who.session.kind === "account" ? "signed in as a parent" : isWall ? "shared wall screen" : `${viewer.name}'s device`}
        </p>
        <div className="row wrap">
          <Link className="btn ghost small" to="/wall">
            🖼️ Wall view
          </Link>
          <button
            className="btn ghost small danger"
            onClick={() => window.confirm("Sign this device out?") && signOut()}
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}

export function StatusPicker({ compact = false }: { compact?: boolean }) {
  const { viewer } = useSession();
  const setStatus = useM(api.members.setStatus);
  return (
    <section className={compact ? "" : "card"}>
      {!compact && (
        <>
          <h2>Where are you?</h2>
          <p className="muted small">Optional, coarse, the same for everyone - and it clears at midnight.</p>
        </>
      )}
      <div className="row wrap">
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.kind}
            className={`chip${viewer?.status === o.kind ? " on" : ""}`}
            aria-pressed={viewer?.status === o.kind}
            onClick={() => void setStatus({ status: viewer?.status === o.kind ? null : o.kind })}
          >
            {o.emoji} {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function PrivateSpace() {
  const notes = useQ(api.mine.list, {});
  const add = useM(api.mine.add);
  const toggle = useM(api.mine.toggleDone);
  const remove = useM(api.mine.remove);
  const [text, setText] = useState("");
  const [color, setColor] = useState<NoteColor>("purple");
  return (
    <section className="card">
      <h2>🔒 My space</h2>
      <p className="muted small">Only you can see this - not your parents, not your kids.</p>
      <form
        className="add-row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          if (await add({ text, color })) setText("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          placeholder="A private reminder, an idea, a list…"
          aria-label="Private note"
        />
        <button className="btn primary" disabled={!text.trim()}>
          Add
        </button>
      </form>
      <ColorPicker value={color} onChange={setColor} />
      <ul className="private-notes">
        {notes?.map((n) => (
          <li key={n._id} className={`note-bg-${n.color}${n.doneAt ? " done" : ""}`}>
            <button className="check" aria-label={n.doneAt ? "Mark not done" : "Mark done"} onClick={() => void toggle({ id: n._id })}>
              {n.doneAt ? "✓" : ""}
            </button>
            <span className="grow pre">{n.text}</span>
            <button
              className="icon-btn subtle"
              aria-label="Delete"
              onClick={() => window.confirm("Delete this private note?") && void remove({ id: n._id })}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notifications() {
  const config = useQuery(api.push.config, {});
  const prefs = useQ(api.members.myPrefs, {});
  const preview = useQ(api.digest.preview, {});
  const updatePrefs = useM(api.members.updatePrefs);
  const subscribe = useM(api.push.subscribe);
  const unsubscribe = useM(api.push.unsubscribe);
  const sendTest = useM(api.push.sendTest);
  const toast = useToast();
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const status = useQ(api.push.deviceStatus, endpoint ? { endpoint } : "skip");
  const support = pushSupport();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void currentSubscription().then((s) => setEndpoint(s?.endpoint ?? null));
  }, []);

  const on = !!endpoint && status === true;

  async function turnOn() {
    if (!config?.vapidPublicKey) return;
    setBusy(true);
    try {
      const sub = await subscribePush(config.vapidPublicKey);
      if ((await subscribe(sub)) !== undefined) {
        setEndpoint(sub.endpoint);
        toast.show("Notifications are on for this device.", { tone: "success" });
      }
    } catch (e) {
      toast.show((e as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>🔔 Notifications</h2>
      <p className="muted small">
        Quiet by default: one evening summary, plus a ping only for things that are time-sensitive for you. Never
        reminders about chores.
      </p>
      {support === "needs-install" ? (
        <p className="tip">
          On iPhone and iPad: tap <strong>Share → Add to Home Screen</strong>, open the fridge from there, then
          come back here to turn notifications on (needs iOS 16.4 or later).
        </p>
      ) : support === "unsupported" ? (
        <p className="muted">This browser can't do notifications.</p>
      ) : !config?.vapidPublicKey ? (
        <p className="muted small">Notifications aren't set up on the server yet (see the README).</p>
      ) : on ? (
        <div className="row wrap">
          <span className="badge got">On for this device</span>
          <button className="btn ghost small" onClick={() => void sendTest({})}>
            Send a test
          </button>
          <button
            className="btn ghost small"
            onClick={async () => {
              const sub = await currentSubscription();
              if (sub) {
                await unsubscribe({ endpoint: sub.endpoint });
                await sub.unsubscribe();
              }
              setEndpoint(null);
            }}
          >
            Turn off
          </button>
        </div>
      ) : (
        <button className="btn primary" disabled={busy} onClick={turnOn}>
          Turn on for this device
        </button>
      )}
      {prefs && (
        <div className="prefs">
          <Field label="Evening summary">
            <div className="row">
              <input
                type="time"
                value={prefs.digestTime ?? ""}
                disabled={prefs.digestTime === null}
                onChange={(e) => void updatePrefs({ ...prefs, digestTime: e.target.value || null })}
              />
              <label className="check-row inline">
                <input
                  type="checkbox"
                  checked={prefs.digestTime !== null}
                  onChange={(e) => void updatePrefs({ ...prefs, digestTime: e.target.checked ? "19:00" : null })}
                />
                <span>Send it</span>
              </label>
            </div>
          </Field>
          <Field label="Quiet hours" hint="Time-sensitive pings wait until quiet hours end.">
            <div className="row">
              <input
                type="time"
                value={prefs.quietStart}
                onChange={(e) => e.target.value && void updatePrefs({ ...prefs, quietStart: e.target.value })}
                aria-label="Quiet from"
              />
              <span>to</span>
              <input
                type="time"
                value={prefs.quietEnd}
                onChange={(e) => e.target.value && void updatePrefs({ ...prefs, quietEnd: e.target.value })}
                aria-label="Quiet until"
              />
            </div>
          </Field>
        </div>
      )}
      {preview && (
        <details>
          <summary className="small">What would tonight's summary say?</summary>
          {preview.length === 0 ? (
            <p className="muted small">Nothing - so it wouldn't be sent.</p>
          ) : (
            <ul className="small">
              {preview.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
        </details>
      )}
    </section>
  );
}

function Profile() {
  const { viewer, isParent, who } = useSession();
  const update = useM(api.members.update);
  const setPin = useA(api.auth.setPin);
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [pinSheet, setPinSheet] = useState(false);
  const [pwSheet, setPwSheet] = useState(false);
  if (!viewer) return null;
  return (
    <section className="card">
      <h2>Profile</h2>
      <div className="row wrap">
        <button className="btn ghost small" onClick={() => setPicking(true)}>
          Change picture
        </button>
        <button className="btn ghost small" onClick={() => setPinSheet(true)}>
          {viewer.hasPin ? "Change wall PIN" : "Set a wall PIN"}
        </button>
        {viewer.hasPin && (
          <button
            className="btn ghost small"
            onClick={async () => {
              if ((await setPin({ memberId: viewer._id, pin: null })) !== undefined) toast.show("PIN removed.");
            }}
          >
            Remove PIN
          </button>
        )}
        {isParent && who.session.kind === "account" && (
          <button className="btn ghost small" onClick={() => setPwSheet(true)}>
            Change password
          </button>
        )}
      </div>
      <p className="muted small">
        A PIN stops brothers and sisters from tapping in as you on the wall. It's not a password - don't reuse a
        real one.
      </p>
      {picking && (
        <Sheet title="Your picture" onClose={() => setPicking(false)}>
          <EmojiPicker value={viewer.emoji} onChange={(emoji) => void update({ memberId: viewer._id, emoji })} />
          <MemberColorPicker value={viewer.color} onChange={(color) => void update({ memberId: viewer._id, color })} />
        </Sheet>
      )}
      {pinSheet && <PinSheet memberId={viewer._id} name="your" onClose={() => setPinSheet(false)} />}
      {pwSheet && <PasswordSheet onClose={() => setPwSheet(false)} />}
    </section>
  );
}

export function PinSheet({
  memberId,
  name,
  onClose,
}: {
  memberId: import("../lib/session").MemberId;
  name: string;
  onClose: () => void;
}) {
  const setPin = useA(api.auth.setPin);
  const toast = useToast();
  const [pin, setPinValue] = useState("");
  return (
    <Sheet
      title={`Set ${name} wall PIN`}
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          disabled={!/^\d{4}$/.test(pin)}
          onClick={async () => {
            if ((await setPin({ memberId, pin })) !== undefined) {
              toast.show("PIN saved.", { tone: "success" });
              onClose();
            }
          }}
        >
          Save PIN
        </button>
      }
    >
      <Field label="4 digits">
        <input
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{4}"
          maxLength={4}
          value={pin}
          onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
        />
      </Field>
    </Sheet>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const change = useA(api.auth.changePassword);
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  return (
    <Sheet
      title="Change password"
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          disabled={!current || next.length < 8}
          onClick={async () => {
            if ((await change({ currentPassword: current, newPassword: next })) !== undefined) {
              toast.show("Password changed.", { tone: "success" });
              onClose();
            }
          }}
        >
          Change
        </button>
      }
    >
      <Field label="Current password">
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="New password" hint="At least 8 characters.">
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
    </Sheet>
  );
}


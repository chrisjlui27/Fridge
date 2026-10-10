import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { useA, useM, useQ, useSession, type MemberId } from "../lib/session";
import { timeAgo } from "../lib/format";
import { Avatar } from "../components/Avatar";
import { EmojiPicker, Field, MemberColorPicker, MEMBER_COLORS, Segmented } from "../components/Controls";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { PinSheet } from "./Me";

type Managed = FunctionReturnType<typeof api.members.manage>[number];
type CodePurpose = "wall" | "personal" | "parentLogin";

export function FamilyPage() {
  const { isParent, who } = useSession();
  if (!isParent) {
    return (
      <div className="page">
        <h1>Family settings</h1>
        <p className="muted">A parent needs to open this from their own signed-in phone or laptop.</p>
      </div>
    );
  }
  return (
    <div className="page family">
      <div className="page-head">
        <Link to="/me" className="icon-btn" aria-label="Back">
          ←
        </Link>
        <h1>Family settings</h1>
      </div>
      <p className="muted small">
        {who.household.name} · {who.household.timezone}
      </p>
      <People />
      <Devices />
      <Calendars />
      <YourData />
    </div>
  );
}

function People() {
  const members = useQ(api.members.manage, {});
  const remove = useM(api.members.remove);
  const { viewer } = useSession();
  const [editing, setEditing] = useState<Managed | "new" | null>(null);
  const [code, setCode] = useState<{ purpose: CodePurpose; member?: Managed } | null>(null);
  const [pinFor, setPinFor] = useState<Managed | null>(null);
  return (
    <section className="card">
      <div className="row between">
        <h2>People</h2>
        <button className="btn small" onClick={() => setEditing("new")}>
          ＋ Add someone
        </button>
      </div>
      <ul className="plain-list people">
        {members?.map((m) => (
          <li key={m._id}>
            <Avatar member={m} size={40} />
            <div className="grow">
              <strong>{m.name}</strong> <span className="muted small">{m.role === "parent" ? "Parent" : "Kid"}</span>
              <div className="muted small">
                {m.email
                  ? `Signs in as ${m.email}`
                  : m.role === "parent"
                    ? "No login yet"
                    : m.deviceCount > 0
                      ? "Has a paired phone"
                      : "Uses the wall"}
                {m.email && m.deviceCount > 0 && ` · ${m.deviceCount} device${m.deviceCount > 1 ? "s" : ""}`}
                {m.hasPin ? " · has a wall PIN" : ""}
              </div>
            </div>
            <div className="row wrap people-actions">
              {m.role === "parent" && !m.email && (
                <button className="btn small" onClick={() => setCode({ purpose: "parentLogin", member: m })}>
                  Give a login
                </button>
              )}
              {m.role === "kid" && (
                <button className="btn small" onClick={() => setCode({ purpose: "personal", member: m })}>
                  Connect their phone
                </button>
              )}
              <button className="btn ghost small" onClick={() => setPinFor(m)}>
                PIN
              </button>
              <button className="btn ghost small" onClick={() => setEditing(m)}>
                Edit
              </button>
              {m._id !== viewer?._id && (
                <button
                  className="btn ghost small danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${m.name}? Their devices are signed out and their private space is deleted. Past contributions stay.`,
                      )
                    ) {
                      void remove({ memberId: m._id });
                    }
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editing && <MemberEditor member={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {code && <CodeSheet purpose={code.purpose} member={code.member} onClose={() => setCode(null)} />}
      {pinFor && <PinSheet memberId={pinFor._id} name={`${pinFor.name}'s`} onClose={() => setPinFor(null)} />}
    </section>
  );
}

function MemberEditor({ member, onClose }: { member?: Managed; onClose: () => void }) {
  const add = useM(api.members.add);
  const update = useM(api.members.update);
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState<"parent" | "kid">(member?.role ?? "kid");
  const [emoji, setEmoji] = useState(member?.emoji ?? "🦊");
  const [color, setColor] = useState(member?.color ?? MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)]);
  return (
    <Sheet
      title={member ? `Edit ${member.name}` : "Add someone"}
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          disabled={!name.trim()}
          onClick={async () => {
            const ok = member
              ? await update({ memberId: member._id, name, role, emoji, color })
              : await add({ name, role, emoji, color });
            if (ok !== undefined) onClose();
          }}
        >
          Save
        </button>
      }
    >
      <Field label="First name" hint="First names only - keep kids' data light.">
        <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <Segmented
        label="Role"
        value={role}
        onChange={setRole}
        options={[
          { value: "kid", label: "Kid" },
          { value: "parent", label: "Parent" },
        ]}
      />
      <Field label="Picture">
        <EmojiPicker value={emoji} onChange={setEmoji} />
      </Field>
      <Field label="Colour">
        <MemberColorPicker value={color} onChange={setColor} />
      </Field>
    </Sheet>
  );
}

function CodeSheet({ purpose, member, onClose }: { purpose: CodePurpose; member?: Managed; onClose: () => void }) {
  const create = useA(api.auth.createPairingCode);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void create({ purpose, memberId: member?._id as MemberId | undefined }).then((c) => c && setCode(c));
  }, [create, purpose, member]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;
  const title =
    purpose === "wall"
      ? "Set up the wall tablet"
      : purpose === "personal"
        ? `Connect ${member?.name}'s phone`
        : `Give ${member?.name} a login`;
  return (
    <Sheet title={title} onClose={onClose}>
      <ol className="steps">
        <li>
          On the {purpose === "wall" ? "tablet" : "other device"}, open <strong>{window.location.host}</strong>
          {purpose === "wall" ? " in the kiosk browser" : ""}.
        </li>
        <li>
          Tap <strong>I have a code</strong> and type:
        </li>
      </ol>
      <div className="big-code" aria-live="polite">
        {code ? code.code : "…"}
      </div>
      <p className="muted small center">
        {left > 0 ? `Works once, for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} more.` : "Expired."}
      </p>
      {purpose === "parentLogin" && (
        <p className="muted small">They'll choose their own email and password.</p>
      )}
      {purpose === "personal" && (
        <p className="muted small">The phone stays signed in as {member?.name}. You can sign it out from Devices any time.</p>
      )}
      {purpose === "wall" && (
        <p className="muted small">
          The wall stays signed in for the household. People tap their picture (and PIN) to do things there.
        </p>
      )}
    </Sheet>
  );
}

function Devices() {
  const devices = useQ(api.auth.devices, {});
  const revoke = useM(api.auth.revokeDevice);
  const [wallCode, setWallCode] = useState(false);
  return (
    <section className="card">
      <div className="row between">
        <h2>Devices</h2>
        <button className="btn small" onClick={() => setWallCode(true)}>
          🖼️ Set up the wall tablet
        </button>
      </div>
      <ul className="plain-list">
        {devices?.map((d) => (
          <li key={d._id} className="row">
            <span className="grow">
              <strong>{d.label}</strong>
              <span className="muted small block">
                {d.kind === "wall" ? "Wall screen" : d.kind === "account" ? `${d.memberName} (signed in)` : `${d.memberName}'s device`}{" "}
                · used {timeAgo(d.lastSeenAt)}
                {d.current ? " · this device" : ""}
              </span>
            </span>
            {!d.current && (
              <button
                className="btn ghost small danger"
                onClick={() => window.confirm(`Sign out ${d.label}?`) && void revoke({ sessionId: d._id })}
              >
                Sign out
              </button>
            )}
          </li>
        ))}
      </ul>
      {wallCode && <CodeSheet purpose="wall" onClose={() => setWallCode(false)} />}
    </section>
  );
}

function Calendars() {
  const feeds = useQ(api.calendar.feeds, {});
  const add = useM(api.calendar.addFeed);
  const remove = useM(api.calendar.removeFeed);
  const refresh = useM(api.calendar.refreshNow);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState(MEMBER_COLORS[4]);
  return (
    <section className="card">
      <h2>📅 Outside calendars (optional)</h2>
      <p className="muted small">
        The family calendar lives in the app (the Calendar tab). If the school or a team publishes a calendar link,
        you can also show it here, read-only. Feeds refresh every 20 minutes.
      </p>
      <ul className="plain-list">
        {feeds?.map((f) => (
          <li key={f._id} className="row">
            <span className="dot big" style={{ background: f.color }} />
            <span className="grow">
              <strong>{f.name}</strong>
              <span className="muted small block">
                {f.where} ·{" "}
                {f.lastError ? (
                  <span className="error-text">{f.lastError}</span>
                ) : f.lastFetchedAt ? (
                  `${f.eventCount} events · checked ${timeAgo(f.lastFetchedAt)}`
                ) : (
                  "checking…"
                )}
              </span>
            </span>
            <button className="btn ghost small" onClick={() => void refresh({ feedId: f._id })}>
              Refresh
            </button>
            <button
              className="btn ghost small danger"
              onClick={() => window.confirm(`Remove ${f.name}?`) && void remove({ feedId: f._id })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await add({ name, url, color })) {
            setName("");
            setUrl("");
          }
        }}
      >
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Family, School, Volleyball…" maxLength={40} />
        </Field>
        <Field
          label="Calendar link (.ics / webcal)"
          hint={
            <>
              Google Calendar: Settings → your calendar → <em>Secret address in iCal format</em>. Apple: share the
              calendar as a public calendar and copy the link. School and team sites often have a “subscribe” link.
            </>
          }
        >
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="webcal://… or https://….ics" inputMode="url" />
        </Field>
        <MemberColorPicker value={color} onChange={setColor} />
        <button className="btn" disabled={!name.trim() || !url.trim()}>
          Add calendar
        </button>
      </form>
    </section>
  );
}

function YourData() {
  const download = useA(api.exporter.download);
  const recent = useQ(api.exporter.recent, {});
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <section className="card">
      <h2>💾 Your data</h2>
      <p className="muted small">
        Everything on the fridge in one file you keep - notes, lists, jobs, thanks. Private spaces and passwords are
        never included. A copy is also saved every night (last 14 kept).
      </p>
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await download({});
          setBusy(false);
          if (!res) return;
          const url = URL.createObjectURL(new Blob([res.json], { type: "application/json" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = res.filename;
          a.click();
          URL.revokeObjectURL(url);
          toast.show("Downloaded.", { tone: "success" });
        }}
      >
        {busy ? "Preparing…" : "Download everything (JSON)"}
      </button>
      {recent && recent.length > 0 && (
        <details>
          <summary className="small">Nightly copies</summary>
          <ul className="small">
            {recent.map((r) => (
              <li key={r._id}>
                {r.url ? (
                  <a href={r.url} download>
                    {new Date(r.createdAt).toLocaleString()}
                  </a>
                ) : (
                  new Date(r.createdAt).toLocaleString()
                )}{" "}
                · {Math.round(r.bytes / 1024)} KB
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

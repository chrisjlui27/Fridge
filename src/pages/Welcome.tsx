import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { errorData } from "../lib/errors";
import { browserTimeZone, deviceLabel } from "../lib/format";
import { EmojiPicker, Field, MemberColorPicker, MEMBER_COLORS, Segmented } from "../components/Controls";

type Mode = "signin" | "code" | "setup";

/** Shown on any device that isn't signed in yet. */
export function Welcome({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const status = useQuery(api.auth.status, {});
  const [mode, setMode] = useState<Mode | null>(null);
  const effective: Mode =
    mode ?? (status && !status.hasHousehold ? "setup" : new URLSearchParams(location.search).has("code") ? "code" : "signin");

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-hero" aria-hidden>
          <span className="hero-note note-bg-yellow">Milk!</span>
          <span className="hero-note note-bg-pink">Love you ♥</span>
          <span className="hero-note note-bg-blue">Practice 5pm</span>
        </div>
        <h1>Fridge Door</h1>
        <p className="muted">Our family's notes, lists, requests and jobs - on the kitchen wall and everyone's phone.</p>
        {import.meta.env.MODE === "demo" && <DemoChooser onSignedIn={onSignedIn} />}
        {status === undefined ? (
          <p className="muted">Connecting…</p>
        ) : (
          <>
            {(status.hasHousehold || status.allowNewHouseholds) && (
              <Segmented
                label="How are you joining?"
                value={effective}
                onChange={setMode}
                options={[
                  { value: "signin", label: "Parent sign in" },
                  { value: "code", label: "I have a code" },
                  ...(status.hasHousehold && !status.allowNewHouseholds ? [] : [{ value: "setup" as Mode, label: "Set up" }]),
                ]}
              />
            )}
            {effective === "setup" && <Setup onSignedIn={onSignedIn} />}
            {effective === "signin" && <SignIn onSignedIn={onSignedIn} />}
            {effective === "code" && <Code onSignedIn={onSignedIn} />}
          </>
        )}
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="error-text" role="alert">
      {error}
    </p>
  ) : null;
}

function Setup({ onSignedIn }: { onSignedIn: (t: string) => void }) {
  const setup = useAction(api.auth.setupHousehold);
  const [householdName, setHouseholdName] = useState("");
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🧔");
  const [color, setColor] = useState(MEMBER_COLORS[4]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [timezone, setTimezone] = useState(browserTimeZone());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const { token } = await setup({
            householdName,
            name,
            emoji,
            color,
            email,
            password,
            timezone,
            deviceLabel: deviceLabel(),
          });
          onSignedIn(token);
        } catch (err) {
          setError(errorData(err).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="small">
        You're the first one here, so you'll set up the household. You can add everyone else next - kids don't
        need email addresses.
      </p>
      <Field label="Household name">
        <input required value={householdName} onChange={(e) => setHouseholdName(e.target.value)} placeholder="The Luis" maxLength={60} />
      </Field>
      <Field label="Your first name">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Dad" maxLength={30} />
      </Field>
      <Field label="Your picture">
        <EmojiPicker value={emoji} onChange={setEmoji} />
      </Field>
      <MemberColorPicker value={color} onChange={setColor} />
      <Field label="Email (for signing in)">
        <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" hint="At least 8 characters.">
        <input required type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Time zone">
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
      </Field>
      <ErrorLine error={error} />
      <button className="btn primary big" disabled={busy}>
        {busy ? "Setting up…" : "Set up our fridge"}
      </button>
    </form>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (t: string) => void }) {
  const signIn = useAction(api.auth.signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const { token } = await signIn({ email, password, deviceLabel: deviceLabel() });
          onSignedIn(token);
        } catch (err) {
          setError(errorData(err).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Email">
        <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <ErrorLine error={error} />
      <button className="btn primary big" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="muted small">Kids and the kitchen tablet join with a code from a parent's phone instead.</p>
    </form>
  );
}

function Code({ onSignedIn }: { onSignedIn: (t: string) => void }) {
  const navigate = useNavigate();
  const describe = useAction(api.auth.describeCode);
  const redeem = useAction(api.auth.redeemCode);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("code") ?? "");
  const [info, setInfo] = useState<{ purpose: "wall" | "personal" | "parentLogin"; memberName: string | null } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!info) {
        const d = await describe({ code });
        if (!d) throw new Error("That code didn't work. Codes last 15 minutes and work once.");
        setInfo(d);
        if (d.purpose !== "parentLogin") await finish(d.purpose);
      } else {
        await finish(info.purpose);
      }
    } catch (err) {
      setError(err instanceof Error && !("data" in err) ? err.message : errorData(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish(purpose: "wall" | "personal" | "parentLogin") {
    const { token } = await redeem({
      code,
      deviceLabel: purpose === "wall" ? "Kitchen wall" : deviceLabel(),
      email: purpose === "parentLogin" ? email : undefined,
      password: purpose === "parentLogin" ? password : undefined,
    });
    navigate(purpose === "wall" ? "/wall" : "/", { replace: true });
    onSignedIn(token);
  }

  return (
    <form className="stack" onSubmit={go}>
      {!info ? (
        <Field label="Code from a parent's phone" hint="Family settings → Connect a phone / Set up the wall tablet.">
          <input
            required
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-EFGH"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            spellCheck={false}
          />
        </Field>
      ) : (
        <>
          <p>
            Hi {info.memberName}! Choose the email and password you'll sign in with.
          </p>
          <Field label="Email">
            <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <input required type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </>
      )}
      <ErrorLine error={error} />
      <button className="btn primary big" disabled={busy}>
        {busy ? "Checking…" : info ? "Finish" : "Join"}
      </button>
    </form>
  );
}

/** Demo mode only: jump straight in as one of the sample devices. */
function DemoChooser({ onSignedIn }: { onSignedIn: (t: string) => void }) {
  const navigate = useNavigate();
  const [tokens, setTokens] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    void fetch("/__demo/tokens")
      .then((r) => r.json())
      .then(setTokens)
      .catch(() => setTokens(null));
  }, []);
  if (!tokens || !Object.keys(tokens).length) return null;
  const choices: [string, string, string][] = [
    ["mom", "👩 Mom's phone", "parent"],
    ["dad", "🧔 Dad's phone", "parent"],
    ["ava", "🦊 Ava's phone", "teen, paired device"],
    ["wall", "🖼️ Kitchen wall", "shared tablet"],
  ];
  return (
    <div className="demo-chooser">
      <p className="small">
        <strong>Demo:</strong> pick a device. Everything runs locally with sample data.
      </p>
      <div className="row wrap">
        {choices
          .filter(([k]) => tokens[k])
          .map(([k, label, sub]) => (
            <button
              key={k}
              className="btn"
              onClick={() => {
                navigate(k === "wall" ? "/wall" : "/", { replace: true });
                onSignedIn(tokens[k]);
              }}
            >
              {label}
              <span className="muted small block">{sub}</span>
            </button>
          ))}
      </div>
    </div>
  );
}

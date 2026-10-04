import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { errorData } from "../lib/errors";
import { useSession, type Member, type MemberId } from "../lib/session";
import { Avatar } from "./Avatar";
import { Sheet } from "./Sheet";

/** Wall tablet: tap your picture, then your PIN if you have one. */
export function ProfilePicker({
  members,
  title,
  onDone,
}: {
  members: Member[];
  title: string;
  onDone: (memberId: MemberId | null) => void;
}) {
  const { token } = useSession();
  const verifyPin = useAction(api.auth.verifyPin);
  const [chosen, setChosen] = useState<Member | null>(members.length === 1 ? members[0] : null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function tryAct(m: Member, withPin?: string) {
    setBusy(true);
    setError(null);
    try {
      await verifyPin({ sessionToken: token, memberId: m._id, pin: withPin });
      onDone(m._id);
    } catch (e) {
      setError(errorData(e).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  function choose(m: Member) {
    setChosen(m);
    setPin("");
    setError(null);
    if (!m.hasPin) void tryAct(m);
  }

  function press(d: string) {
    if (!chosen || busy) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) void tryAct(chosen, next);
  }

  return (
    <Sheet title={chosen?.hasPin ? `Hi ${chosen.name}! Your PIN` : title} onClose={() => onDone(null)}>
      {!chosen?.hasPin ? (
        <div className="profile-grid">
          {members.map((m) => (
            <button key={m._id} className="profile-btn" onClick={() => choose(m)} disabled={busy}>
              <Avatar member={m} size={72} />
              <span>{m.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="pinpad-wrap">
          <div className="pin-dots" aria-label={`${pin.length} digits entered`}>
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className={i < pin.length ? "on" : ""} />
            ))}
          </div>
          <div className="pinpad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button key={d} onClick={() => press(d)} disabled={busy}>
                {d}
              </button>
            ))}
            <button onClick={() => setPin(pin.slice(0, -1))} aria-label="Delete" disabled={busy}>
              ⌫
            </button>
            <button onClick={() => press("0")} disabled={busy}>
              0
            </button>
            <span aria-hidden />
          </div>
          {members.length > 1 && (
            <button className="btn ghost" onClick={() => setChosen(null)}>
              ← Not {chosen.name}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

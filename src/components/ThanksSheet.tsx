import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useM, useSession, type MemberId } from "../lib/session";
import { Field, PersonPicker } from "./Controls";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

/**
 * Thanks that praise the other person ("you're really good at that") land
 * better than thanks about how it helped me (Algoe et al. 2016). The starters
 * nudge that way; a gentle tip appears if it drifts toward "helped me".
 */
const STARTERS = ["You're really good at ", "You noticed ", "That was so thoughtful - you ", "I saw you "];
const SELF_FOCUSED = /\b(helped me|saved me|for me|made my|my life|i needed)\b/i;

export function ThanksSheet({
  onClose,
  completion,
}: {
  onClose: () => void;
  completion?: { _id: Id<"completions">; memberId: MemberId; title: string };
}) {
  const { members, viewer, member } = useSession();
  const toast = useToast();
  const thank = useM(api.thanks.thank);
  const [toId, setToId] = useState<MemberId | null>(completion?.memberId ?? null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const to = member(toId);

  async function send() {
    setBusy(true);
    const ok = await thank(
      completion ? { completionId: completion._id, text } : { toMemberId: toId ?? undefined, text },
    );
    setBusy(false);
    if (ok) {
      toast.show(`Sent to ${to?.name} 💛`, { tone: "success" });
      onClose();
    }
  }

  return (
    <Sheet
      title={completion ? `Thank ${to?.name} for “${completion.title}”` : "Thank someone"}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !text.trim() || !toId} onClick={send}>
            Send thanks
          </button>
        </>
      }
    >
      {!completion && (
        <Field label="Who?" hint="Thank people for the invisible stuff too - the things nobody saw.">
          <PersonPicker
            members={members.filter((m) => m._id !== viewer?._id)}
            value={toId}
            onChange={setToId}
            label="Who to thank"
          />
        </Field>
      )}
      <div className="row wrap">
        {STARTERS.map((s) => (
          <button key={s} className="chip" onClick={() => setText(s)}>
            {s.trim()}…
          </button>
        ))}
      </div>
      <Field label="Say what you noticed">
        <textarea
          autoFocus
          rows={3}
          maxLength={280}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            completion ? `You're really good at ${completion.title.toLowerCase()}!` : "You noticed we were out of milk"
          }
        />
      </Field>
      {SELF_FOCUSED.test(text) && (
        <p className="tip" role="note">
          💡 Tip: thanks about <em>them</em> (“you're great at…”, “you noticed…”) tend to land better than how it
          helped you.
        </p>
      )}
    </Sheet>
  );
}

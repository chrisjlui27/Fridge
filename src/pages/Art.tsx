import { useState } from "react";
import { Link } from "react-router-dom";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { useM, useQ, useSession } from "../lib/session";
import { formatDate, localDay } from "../lib/format";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/Controls";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";

type Art = FunctionReturnType<typeof api.art.list>["items"][number];

const PAGE = 48;

/** Every photo and doodle that has been on the door, kept for good. */
export function ArtPage() {
  const { tz, member } = useSession();
  const [limit, setLimit] = useState(PAGE);
  const data = useQ(api.art.list, { limit });
  const [openId, setOpenId] = useState<string | null>(null);

  const months = new Map<string, Art[]>();
  for (const a of data?.items ?? []) {
    const key = localDay(a.createdAt, tz).slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), a]);
  }
  const open = data?.items.find((a) => a._id === openId) ?? null;

  return (
    <div className="page">
      <div className="page-head">
        <Link to="/" className="icon-btn" aria-label="Back to the door">
          ←
        </Link>
        <h1>Art wall</h1>
      </div>
      <p className="muted small">Every photo and drawing that's been on the fridge - kept even after it comes down.</p>
      {data === undefined ? (
        <p className="muted">Loading…</p>
      ) : data.items.length === 0 ? (
        <EmptyState emoji="🖍️" title="No art yet">
          Draw something or snap a photo for the door - it'll be kept here.
        </EmptyState>
      ) : (
        [...months.entries()].map(([month, items]) => (
          <section key={month}>
            <h2>{formatDate(`${month}-01`, { month: "long", year: "numeric" })}</h2>
            <div className="art-grid">
              {items.map((a) => (
                <button key={a._id} className="art-tile" onClick={() => setOpenId(a._id)}>
                  {a.imageUrl && <img src={a.imageUrl} alt={a.text || `${a.imageKind} by ${member(a.authorId)?.name}`} loading="lazy" />}
                  <span className="art-by">
                    <Avatar member={member(a.authorId)} size={20} />
                  </span>
                  {a.onDoor && <span className="art-badge">on the door</span>}
                </button>
              ))}
            </div>
          </section>
        ))
      )}
      {data?.hasMore && (
        <p className="center">
          <button className="btn" onClick={() => setLimit(limit + PAGE)}>
            Show older
          </button>
        </p>
      )}
      {open && <ArtSheet art={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ArtSheet({ art, onClose }: { art: Art; onClose: () => void }) {
  const { member, isParent, tz } = useSession();
  const restore = useM(api.notes.restore);
  const del = useM(api.notes.deleteForever);
  const toast = useToast();
  const author = member(art.authorId);
  return (
    <Sheet
      title={art.imageKind === "doodle" ? `Drawing by ${author?.name ?? "someone"}` : `Photo from ${author?.name ?? "someone"}`}
      onClose={onClose}
      wide
      footer={
        <>
          {isParent && (
            <button
              className="btn ghost danger"
              onClick={async () => {
                if (!window.confirm("Delete this for good? It can't be undone.")) return;
                if ((await del({ noteId: art._id })) !== undefined) onClose();
              }}
            >
              Delete for good
            </button>
          )}
          {!art.onDoor && (
            <button
              className="btn primary"
              onClick={async () => {
                if ((await restore({ noteId: art._id })) !== undefined) {
                  toast.show("Back on the door.", { tone: "success" });
                  onClose();
                }
              }}
            >
              Put it back on the door
            </button>
          )}
        </>
      }
    >
      {art.imageUrl && <img className="art-full" src={art.imageUrl} alt={art.text || ""} />}
      {art.text && <p className="pre art-caption">{art.text}</p>}
      <p className="muted small">
        <Avatar member={author} size={18} /> {author?.name} · {formatDate(localDay(art.createdAt, tz), { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
      </p>
    </Sheet>
  );
}

import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { useQ, useSession } from "../lib/session";
import { dayLabel, formatTime, localDay, useNow } from "../lib/format";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/Controls";
import { ThanksSheet } from "../components/ThanksSheet";

type Feed = FunctionReturnType<typeof api.thanks.feed>;
type FeedItem = Feed["items"][number];
type Completion = Extract<FeedItem, { type: "completion" }>;

/**
 * What everyone did for the family this week, and thanks for it.
 * Deliberately no points, totals per person or leaderboards.
 */
export function ThanksPage() {
  const feed = useQ(api.thanks.feed, { days: 7 });
  const { tz, member, viewer } = useSession();
  const { today } = useNow(tz, 60_000);
  const [thanking, setThanking] = useState<Completion | "free" | null>(null);

  const groups = new Map<string, FeedItem[]>();
  for (const item of feed?.items ?? []) {
    const day = item.type === "completion" ? item.day : localDay(item.at, tz);
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Thanks</h1>
      </div>
      {feed && (
        <p className="week-line">
          This week: <strong>{feed.weekCount}</strong> thing{feed.weekCount === 1 ? "" : "s"} done for the family by{" "}
          <strong>{feed.helpers}</strong> {feed.helpers === 1 ? "person" : "people"}.
        </p>
      )}
      <button className="card noticed" onClick={() => setThanking("free")}>
        <span aria-hidden>💛</span>
        <span>
          <strong>Noticed something nobody saw?</strong>
          <span className="muted small block">Thank someone for the invisible stuff - “you noticed we were out of milk”.</span>
        </span>
      </button>
      {feed === undefined ? (
        <p className="muted">Loading…</p>
      ) : feed.items.length === 0 ? (
        <EmptyState emoji="🌱" title="Nothing yet this week">
          When someone finishes a job or a request, it shows up here so others can thank them.
        </EmptyState>
      ) : (
        [...groups.entries()].map(([day, items]) => (
          <section key={day} className="feed-day">
            <h2>{dayLabel(day, today)}</h2>
            {items.map((item) =>
              item.type === "completion" ? (
                <article key={item._id} className="card feed-item">
                  <div className="row">
                    <Avatar member={member(item.memberId)} size={32} />
                    <div className="grow">
                      <strong>{member(item.memberId)?.name ?? "Someone"}</strong> {item.kind === "job" ? "did" : "finished"}{" "}
                      {item.emoji ?? "✅"} {item.title}
                      <span className="muted small block">{formatTime(item.at, tz)}</span>
                    </div>
                    {viewer && viewer._id !== item.memberId && (
                      <button className="btn small" onClick={() => setThanking(item)}>
                        Say thanks
                      </button>
                    )}
                  </div>
                  {item.thanks.map((th, i) => (
                    <p key={i} className="thanks-bubble">
                      <Avatar member={member(th.fromId)} size={20} /> “{th.text}”
                    </p>
                  ))}
                </article>
              ) : (
                <article key={item._id} className="card feed-item shoutout">
                  <div className="row">
                    <Avatar member={member(item.fromId)} size={28} />
                    <span className="muted">→</span>
                    <Avatar member={member(item.toId)} size={28} />
                    <p className="grow thanks-text">“{item.text}”</p>
                  </div>
                </article>
              ),
            )}
          </section>
        ))
      )}
      {thanking && (
        <ThanksSheet
          completion={thanking === "free" ? undefined : thanking}
          onClose={() => setThanking(null)}
        />
      )}
    </div>
  );
}

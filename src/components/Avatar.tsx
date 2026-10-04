import type { Member } from "../lib/session";

export function Avatar({
  member,
  size = 36,
  ring = false,
  title,
}: {
  member: Pick<Member, "emoji" | "color" | "name"> | undefined;
  size?: number;
  ring?: boolean;
  title?: string;
}) {
  if (!member) return <span className="avatar ghost" style={{ width: size, height: size }} aria-hidden />;
  return (
    <span
      className={`avatar${ring ? " ring" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.55, ["--member" as string]: member.color }}
      title={title ?? member.name}
      role="img"
      aria-label={member.name}
    >
      {member.emoji}
    </span>
  );
}

export function NameTag({ member }: { member: Member | undefined }) {
  return (
    <span className="name-tag">
      <Avatar member={member} size={22} />
      <span>{member?.name ?? "Someone"}</span>
    </span>
  );
}

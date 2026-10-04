export const MEMBER_COLORS = [
  "#e4572e", // tomato
  "#f3a712", // marigold
  "#29bf12", // leaf
  "#17bebb", // teal
  "#4c6ef5", // blue
  "#9c36b5", // grape
  "#e64980", // pink
  "#795548", // cocoa
];

export const STATUS_OPTIONS = [
  { kind: "home", label: "Home", emoji: "🏠" },
  { kind: "out", label: "Out", emoji: "🚗" },
  { kind: "school", label: "School", emoji: "🏫" },
  { kind: "work", label: "Work", emoji: "💼" },
  { kind: "practice", label: "Practice", emoji: "⚽" },
  { kind: "away", label: "Away", emoji: "🧳" },
] as const;

export type StatusKind = (typeof STATUS_OPTIONS)[number]["kind"];

export const DEFAULT_DIGEST_TIME = "19:00";
export const DEFAULT_QUIET_START = "21:00";
export const DEFAULT_QUIET_END = "07:00";

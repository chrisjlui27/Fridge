import { generateKeyBetween } from "fractional-indexing";

/**
 * Fractional sort keys: moving one item writes one row, not the whole list.
 * Keys compare with plain string comparison (not localeCompare).
 */
export function keyBetween(before: string | null | undefined, after: string | null | undefined): string {
  return generateKeyBetween(before ?? null, after ?? null);
}

export function byKey<T extends { sortKey: string }>(a: T, b: T): number {
  return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
}

/** Key for a new row at the end of an already-sorted list. */
export function keyAtEnd(sorted: { sortKey: string }[]): string {
  return keyBetween(sorted.length ? sorted[sorted.length - 1].sortKey : null, null);
}

/** Key for a new row at the start of an already-sorted list. */
export function keyAtStart(sorted: { sortKey: string }[]): string {
  return keyBetween(null, sorted.length ? sorted[0].sortKey : null);
}

import { useEffect } from "react";
import { safeGet, safeSet } from "./storage";

/**
 * Last-known state for the wall tablet: if the Wi-Fi drops or the page
 * reloads offline, show what we had instead of a blank screen.
 */
export function useLastKnown<T>(key: string, live: T | undefined): { value: T | undefined; stale: boolean } {
  useEffect(() => {
    if (live !== undefined) safeSet(`fridge.cache.${key}`, JSON.stringify(live));
  }, [key, live]);
  if (live !== undefined) return { value: live, stale: false };
  const raw = safeGet(`fridge.cache.${key}`);
  if (!raw) return { value: undefined, stale: false };
  try {
    return { value: JSON.parse(raw) as T, stale: true };
  } catch {
    return { value: undefined, stale: false };
  }
}

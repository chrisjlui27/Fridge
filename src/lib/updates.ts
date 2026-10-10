import { useSyncExternalStore } from "react";

/**
 * "A new version is ready" plumbing. main.tsx registers the service worker and
 * hands us its update function; the banner subscribes to readiness.
 */

let apply: ((reloadPage?: boolean) => Promise<void>) | null = null;
let ready = false;
const listeners = new Set<() => void>();

export function setUpdater(fn: (reloadPage?: boolean) => Promise<void>) {
  apply = fn;
}

export function markUpdateReady() {
  ready = true;
  listeners.forEach((l) => l());
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => ready,
  );
}

export async function applyUpdate() {
  if (apply) await apply(true);
  else window.location.reload();
}

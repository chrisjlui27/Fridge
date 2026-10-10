import { useSyncExternalStore } from "react";

/**
 * "A new version is ready" plumbing. The service worker installs updates by
 * itself; main.tsx tells us when one has taken over, and the banner offers a
 * reload so nobody loses what they were typing.
 */

let ready = false;
const listeners = new Set<() => void>();

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

export function applyUpdate() {
  window.location.reload();
}

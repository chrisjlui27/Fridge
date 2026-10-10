import { useEffect } from "react";
import { applyUpdate, useUpdateReady } from "../lib/updates";

/** Shown when a new version has been deployed and downloaded. */
export function UpdateBanner() {
  const ready = useUpdateReady();
  useEffect(() => {
    // Nobody taps banners on the kitchen wall: update it after a minute.
    if (ready && window.location.pathname.startsWith("/wall")) {
      const id = window.setTimeout(() => void applyUpdate(), 60_000);
      return () => window.clearTimeout(id);
    }
  }, [ready]);
  if (!ready) return null;
  return (
    <div className="update-banner" role="status">
      <span>✨ A new version of the fridge is ready.</span>
      <button className="btn small primary" onClick={() => void applyUpdate()}>
        Refresh
      </button>
    </div>
  );
}

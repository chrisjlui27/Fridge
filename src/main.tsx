import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import { markUpdateReady, setUpdater } from "./lib/updates";
import "./styles.css";

const isDemo = import.meta.env.MODE === "demo";

async function start() {
  const root = createRoot(document.getElementById("root")!);
  let client: ConvexReactClient;
  if (isDemo) {
    const { DemoClient } = await import("./demo/DemoClient");
    client = new DemoClient() as unknown as ConvexReactClient;
  } else {
    const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
    if (!url) {
      root.render(
        <div className="welcome">
          <div className="welcome-card">
            <h1>Almost there</h1>
            <p>
              This build doesn't know where its backend is. Set <code>VITE_CONVEX_URL</code> (run{" "}
              <code>npx convex dev</code> once, or see the README), or try <code>npm run demo</code>.
            </p>
          </div>
        </div>,
      );
      return;
    }
    client = new ConvexReactClient(url);
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      const { registerSW } = await import("virtual:pwa-register");
      setUpdater(
        registerSW({
          immediate: true,
          onNeedRefresh: markUpdateReady,
          onRegisteredSW(_url, registration) {
            if (!registration) return;
            // Installed apps can stay open for days: look for updates every
            // half hour and whenever the app comes back to the foreground.
            const check = () => void registration.update().catch(() => {});
            window.setInterval(check, 30 * 60 * 1000);
            document.addEventListener("visibilitychange", () => {
              if (document.visibilityState === "visible") check();
            });
          },
        }),
      );
    }
  }
  root.render(
    <StrictMode>
      <ConvexProvider client={client}>
        <BrowserRouter>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </ConvexProvider>
    </StrictMode>,
  );
}

void start();

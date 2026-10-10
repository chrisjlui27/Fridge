import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { demoBackend } from "./demo/plugin.ts";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === "demo" && demoBackend(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // Ask before switching to a new version (see src/components/UpdateBanner.tsx).
      registerType: "prompt",
      injectRegister: false,
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"] },
      devOptions: { enabled: false },
      manifest: {
        name: "Fridge Door",
        short_name: "Fridge",
        description: "Our family's notes, lists, requests and jobs.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#f6f1e7",
        theme_color: "#f6f1e7",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Wall view", url: "/wall" },
          { name: "Groceries", url: "/lists" },
        ],
      },
    }),
  ],
  define: {
    __APP_BUILD__: JSON.stringify({
      sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
      at: new Date().toISOString(),
    }),
  },
  server: { port: 5173 },
}));

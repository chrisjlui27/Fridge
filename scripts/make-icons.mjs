// Renders public/favicon.svg into the PNG icons the PWA manifest needs.
// Usage: node scripts/make-icons.mjs  (uses Playwright's Chromium)
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const svg = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
const out = (name) => new URL(`../public/${name}`, import.meta.url).pathname;

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const page = await browser.newPage();

async function render(name, size, { padding = 0, background = "transparent", mono = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - padding * 2;
  const art = mono
    ? svg.replace(/fill="#[0-9a-f]{6}"/gi, 'fill="#fff"').replace(/stroke="#[0-9a-f]{6}"/gi, 'stroke="#fff"')
    : svg;
  await page.setContent(
    `<html><body style="margin:0;background:${background};display:grid;place-items:center;width:${size}px;height:${size}px">
       <div style="width:${inner}px;height:${inner}px">${art.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div>
     </body></html>`,
  );
  await page.screenshot({ path: out(name), omitBackground: background === "transparent" });
}

await render("icon-192.png", 192);
await render("icon-512.png", 512);
await render("apple-touch-icon.png", 180, { background: "#f6f1e7" });
// Maskable icons need a safe zone: art inside the middle 80%.
await render("icon-maskable-512.png", 512, { padding: 56, background: "#f6f1e7" });
await render("badge-96.png", 96, { mono: true });
await browser.close();
console.log("icons written to public/");

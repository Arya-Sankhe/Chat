// Loads a site signed in against the mock and reports its API calls, failures
// and console errors, with a screenshot. Usage: node probe.mjs <url> <out.png> [width] [height]
import { chromium } from "playwright";

const [url, out, width = "1440", height = "900"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 });
// KLUI_SESSION: a session JSON (devtools/local-backend/session.mjs); the mock's session otherwise.
const session = process.env.KLUI_SESSION ? JSON.parse(process.env.KLUI_SESSION)
  : { access_token: "mock-access-0", refresh_token: "mock-refresh-0", expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer" };
await page.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), JSON.stringify(session));
const calls = [];
page.on("response", (response) => {
  const u = new URL(response.url());
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/auth/")) calls.push(`${response.status()} ${response.request().method()} ${u.pathname}${u.search}`);
});
page.on("console", (message) => { if (message.type() === "error") calls.push(`console: ${message.text().slice(0, 160)}`); });
page.on("pageerror", (error) => calls.push(`pageerror: ${error.message.slice(0, 160)}`));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
console.log(calls.join("\n"));
await browser.close();

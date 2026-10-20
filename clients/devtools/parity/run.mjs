// Screenshots the old site and the new web client in the same named states and
// diffs them. Needs the local backend (devtools/local-backend) and both sites:
//   old: node devtools/parity/reference-server.mjs 5181 http://localhost:55600
//   new: KLUI_API_TARGET=http://localhost:55600 npm run web:dev
// Usage: node devtools/parity/run.mjs [name-filter] [--only=old|new]
// Writes devtools/parity/out/<scenario>/{old,new,diff}.png and out/report.html.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { NOW, reset, session } from "../local-backend/fixtures.mjs";
import { domDiff } from "./domdiff.mjs";
import { scenarios } from "./scenarios.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out");
const args = process.argv.slice(2);
const filter = args.find((arg) => !arg.startsWith("--")) || "";
const only = (args.find((arg) => arg.startsWith("--only=")) || "").slice(7);

const SITES = {
  old: { origin: "http://localhost:5181", user: "old" },
  new: { origin: "http://localhost:5180", user: "new" }
};
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 412, height: 915 } };
// Both sites load Orbitron from Google Fonts at runtime.
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"]);

// Runs before any page script: a constant Math.random, and no motion. A
// constant (not a seeded sequence) makes every random pick independent of how
// many draws happened before it, so the two sites needn't draw in the same order.
function determinism() {
  Math.random = () => 0.42;
  // Scripts that have finished loading or failed: the apps render either way.
  const settled = (globalThis.__paritySettledScripts = new Set());
  const mark = (event) => { if (event.target?.tagName === "SCRIPT" && event.target.src) settled.add(event.target.src); };
  document.addEventListener("load", mark, true);
  document.addEventListener("error", mark, true);
  const style = "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}";
  document.addEventListener("DOMContentLoaded", () => {
    const tag = document.createElement("style");
    tag.dataset.parity = "";
    tag.textContent = style;
    document.head.append(tag);
  });
}

async function settle(page, scenario) {
  // The old site's launch screen removes itself 500 ms after load.
  await page.waitForSelector("#mobileLaunchScreen", { state: "detached" });
  // Timers are faked: jump past timed UI (the home greeting types and deletes
  // lines for several seconds) so every capture lands on its settled frame.
  // Scenarios capturing transient UI (a toast) pass a shorter settleMs.
  await page.clock.runFor(scenario.settleMs ?? 30_000);
  // A conversation loads math and code highlighting from the CDN, then re-renders
  // (loadRichTextAssets, which goes on if a script fails). Wait for the scripts
  // to load or fail, then let the queued render run.
  const richText = await page.evaluate(() => Boolean(document.querySelector('script[src*="highlight.min.js"]')));
  if (richText) {
    await page.waitForFunction(() => [...document.querySelectorAll('script[src*="cdn.jsdelivr.net"]')]
      .every((script) => globalThis.__paritySettledScripts.has(script.src)));
    await page.clock.runFor(1000);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter((img) => !img.complete).map((img) => new Promise((resolve) => { img.onload = img.onerror = resolve; })));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.mouse.move(0, 0);
}

async function capture(browser, site, scenario, viewport, theme, sessions) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: theme,
    reducedMotion: "reduce"
  });
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return ALLOWED_HOSTS.has(host) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(NOW) });
  await page.addInitScript(determinism);
  await page.addInitScript((value) => {
    if (value) localStorage.setItem("klui.auth.v1", value);
  }, scenario.signedOut ? "" : JSON.stringify(sessions[site.user]));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ctx = { site: site.user, page, viewport, theme };
  await page.goto(site.origin + (typeof scenario.path === "function" ? scenario.path(ctx) : scenario.path), { waitUntil: "load" });
  await scenario.ready(page, ctx);
  if (scenario.steps) await scenario.steps(page, ctx);
  await settle(page, scenario);
  // The two fixture users differ only in their email's domain; show one address
  // on both sites so it isn't counted as a visual difference.
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.data.includes("@new.klui.test")) node.data = node.data.replaceAll("@new.klui.test", "@klui.test");
    }
  });
  const shot = await page.screenshot();
  // The settled DOM is the spec the new client's markup is checked against.
  const dom = await page.content();
  await context.close();
  return { shot, dom, errors };
}

function diff(oldPng, newPng) {
  const a = PNG.sync.read(oldPng);
  const b = PNG.sync.read(newPng);
  if (a.width !== b.width || a.height !== b.height) return { changed: Infinity, image: null };
  const out = new PNG({ width: a.width, height: a.height });
  const changed = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });
  return { changed, image: PNG.sync.write(out) };
}

await reset();
const sessions = { old: await session("old"), new: await session("new") };
const browser = await chromium.launch();
const results = [];
fs.rmSync(outDir, { recursive: true, force: true });

for (const scenario of scenarios.filter((s) => s.name.includes(filter))) {
  for (const viewport of scenario.viewports || ["desktop", "phone"]) {
    for (const theme of scenario.themes || ["light", "dark"]) {
      const name = `${scenario.name}.${viewport}.${theme}`;
      const dir = path.join(outDir, name);
      fs.mkdirSync(dir, { recursive: true });
      const shots = {};
      const doms = {};
      for (const key of only ? [only] : ["old", "new"]) {
        try {
          const { shot, dom, errors } = await capture(browser, SITES[key], scenario, viewport, theme, sessions);
          fs.writeFileSync(path.join(dir, `${key}.png`), shot);
          fs.writeFileSync(path.join(dir, `${key}.html`), dom);
          // A page error fails the state even when the pixels match.
          if (errors.length) fs.writeFileSync(path.join(dir, `${key}.errors.txt`), errors.join("\n"));
          else {
            shots[key] = shot;
            doms[key] = dom;
          }
        } catch (error) {
          fs.writeFileSync(path.join(dir, `${key}.failure.txt`), String(error?.stack || error));
        }
      }
      let changed = null;
      let domChanges = null;
      if (shots.old && shots.new) {
        const result = diff(shots.old, shots.new);
        changed = result.changed;
        if (result.image) fs.writeFileSync(path.join(dir, "diff.png"), result.image);
        // Pixels only cover what is on screen; the DOM diff also catches
        // hidden-state and attribute differences that later states depend on.
        const lines = await domDiff(browser, doms.old, doms.new);
        domChanges = lines.length;
        fs.writeFileSync(path.join(dir, "dom-diff.txt"), lines.join("\n") || "identical\n");
      }
      const limit = scenario.maxChangedPixels ?? 0;
      const status = changed == null ? (only && shots[only] ? "captured" : "failed") : changed <= limit && domChanges === 0 ? "match" : "differs";
      results.push({ name, status, changed, domChanges });
      console.log(`${status.padEnd(8)} ${name}${changed != null ? ` (${changed} px, ${domChanges} dom)` : ""}`);
    }
  }
}
await browser.close();

const rows = results.map((r) => `<tr><td>${r.name}<br><b>${r.status}</b>${r.changed != null ? ` ${r.changed} px, ${r.domChanges} dom` : ""}</td>${["old", "new", "diff"].map((k) => `<td><img src="${r.name}/${k}.png" loading="lazy"></td>`).join("")}</tr>`).join("");
fs.writeFileSync(path.join(outDir, "report.html"), `<!doctype html><meta charset="utf-8"><title>Parity report</title><style>body{font:13px system-ui;margin:16px}td{vertical-align:top;padding:4px}img{width:420px;border:1px solid #ccc}</style><table><tr><th></th><th>old</th><th>new</th><th>diff</th></tr>${rows}</table>`);
process.exitCode = results.some((r) => r.status === "differs" || r.status === "failed") ? 1 : 0;

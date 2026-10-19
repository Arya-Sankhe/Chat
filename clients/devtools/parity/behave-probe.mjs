// Drives the same composer interactions on the old site and the new client and
// compares the resulting state (classes, attributes, heights). Signed out, so
// it needs only the two sites, not fixtures:
//   node devtools/parity/behave-probe.mjs
import { chromium } from "playwright";
const results = [];
const browser = await chromium.launch();
for (const origin of ["http://localhost:5181", "http://localhost:5180"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/");
  await page.waitForSelector("body.guest-mode #guestLoginButton", { state: "attached" });
  await page.waitForTimeout(800);
  const out = {};
  // Compare toggles on, then off
  await page.click("#compareButton"); out.compareOn = await page.$eval("#compareButton", (b) => b.className + "|" + b.getAttribute("aria-pressed"));
  out.explainer = await page.$eval("#homeModes", (r) => r.querySelector(".home-modes-panel")?.hidden + "|" + (r.querySelector(".home-mode-explainer")?.dataset.explainer || ""));
  await page.click("#compareButton"); out.compareOff = await page.$eval("#compareButton", (b) => b.className);
  await page.click("#councilButton"); out.council = await page.$eval("#modeSwitch", (b) => b.dataset.active);
  // Spectrum pro via button? open spectrum and click right end
  await page.click("#councilButton");
  await page.click("#modelButton"); await page.waitForTimeout(300);
  const box = await page.$eval("#spectrumTrack", (t) => { const r = t.getBoundingClientRect(); return [r.right - 2, r.top + r.height / 2]; });
  await page.mouse.click(box[0], box[1]); await page.waitForTimeout(300);
  out.pro = await page.$eval("#modelButton", (b) => b.getAttribute("aria-label") + "|" + b.title + "|" + b.className);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  out.popHidden = await page.$eval("#spectrumPop", (p) => p.hidden);
  // type multiline text then resize to phone
  await page.click("#promptInput"); await page.keyboard.type("line one that is fairly long ".repeat(8));
  await page.setViewportSize({ width: 412, height: 915 }); await page.waitForTimeout(500);
  out.phoneHeight = await page.$eval("#promptInput", (p) => p.style.height + "|" + p.className + "|" + getComputedStyle(p).lineHeight);
  out.errors = errors;
  results.push(out);
  await page.close();
}
await browser.close();
const [oldOut, newOut] = results;
let failed = 0;
for (const key of Object.keys(oldOut)) {
  const a = JSON.stringify(oldOut[key]), b = JSON.stringify(newOut[key]);
  if (a !== b) failed++;
  console.log(`${a === b ? "same   " : "DIFFERS"} ${key}  old=${a}${a === b ? "" : `  new=${b}`}`);
}
process.exit(failed ? 1 : 0);

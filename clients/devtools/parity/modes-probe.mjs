// Mode changes the other probes miss, on the old site and the new client:
// the + menu (idle, while a reply streams, after crossing the phone
// breakpoint in the same page), web search on and off, and Deep Research or
// Council with an attachment pending. Web search and Deep Research need a
// search provider, which the local backend leaves unset (it would call the real
// provider), so those steps run only where the toggles are shown. Resets the fixtures first; needs the
// local backend running:
//   node devtools/parity/modes-probe.mjs
import { chromium } from "playwright";
import { reset, session } from "../local-backend/fixtures.mjs";

const SITES = [
  { origin: "http://localhost:5181", user: "old" },
  { origin: "http://localhost:5180", user: "new" }
];
// A 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const results = [];
const browser = await chromium.launch();
for (const site of SITES) {
  await reset();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const auth = JSON.stringify(await session(site.user));
  await context.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), auth);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const menu = () => page.evaluate(() => [...document.querySelectorAll("#imageToggle, #deepResearchToggle, #webSearchToggle, #cameraAction")]
    .map((b) => `${b.id}:${[...b.classList].sort().join(".")}:${b.disabled}:${b.getAttribute("aria-pressed")}:${b.getAttribute("aria-label")}:${b.getAttribute("title")}`));
  const composer = () => page.evaluate(() => ({
    mode: document.getElementById("modeSwitch")?.dataset.active,
    chip: document.getElementById("researchModeChip")?.className,
    research: document.body.classList.contains("research-mode"),
    previews: document.querySelectorAll("#imagePreviews [data-remove-index]").length,
    clarification: document.getElementById("clarificationCard")?.className,
    toast: document.querySelector("#toast.visible")?.textContent || ""
  }));
  const openMenu = async () => {
    await page.click("#actionMenuButton");
    await page.waitForTimeout(300);
  };
  const closeMenu = async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  };
  const out = {};
  await page.goto(site.origin + "/");
  await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
  await page.waitForTimeout(500);

  await openMenu();
  out.idleMenu = await menu();
  const toggleWebSearch = async () => {
    await page.click("#actionMenuMore");
    await page.waitForTimeout(300);
    if (await page.isVisible("#webSearchToggle")) {
      await page.click("#webSearchToggle");
      await page.waitForTimeout(300);
    }
    return menu();
  };
  out.webSearchOff = await toggleWebSearch();
  await closeMenu();

  // Cross the breakpoint and back in the same page: the toggle must still work.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await openMenu();
  out.phoneMenu = await menu();
  await closeMenu();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(800);
  await openMenu();
  out.webSearchOnAgain = await toggleWebSearch();
  await closeMenu();

  // An attachment blocks Deep Research and Council.
  await page.setInputFiles("#imageFileInput", { name: "dot.png", mimeType: "image/png", buffer: PNG });
  await page.waitForTimeout(1500);
  await openMenu();
  if (await page.isVisible("#deepResearchToggle")) {
    await page.click("#deepResearchToggle");
    await page.waitForTimeout(500);
  }
  out.researchWithImage = await composer();
  await closeMenu();
  await page.click("#councilButton");
  await page.waitForTimeout(500);
  out.councilWithImage = await composer();
  await page.click("#councilButton");
  await page.waitForTimeout(500);
  out.councilOff = await composer();
  // The remove button sits under the thumbnail until hovered; click it directly.
  await page.$eval("#imagePreviews [data-remove-index]", (b) => b.click());
  await page.waitForTimeout(800);
  out.removed = await composer();

  // While a reply streams.
  await page.click("#promptInput");
  await page.keyboard.type("slow streaming check");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#stopButton:not(.hidden)", { timeout: 10000 });
  await page.waitForTimeout(500);
  await openMenu();
  out.streamingMenu = await menu();
  await closeMenu();
  await page.click("#stopButton");
  await page.waitForSelector("#stopButton.hidden", { state: "attached", timeout: 10000 });
  await page.waitForTimeout(1000);
  await openMenu();
  out.stoppedMenu = await menu();
  await closeMenu();
  out.errors = errors;
  results.push(out);
  await context.close();
}
await browser.close();
await reset();

const [oldOut, newOut] = results;
let failed = 0;
for (const key of Object.keys(oldOut)) {
  const a = JSON.stringify(oldOut[key]), b = JSON.stringify(newOut[key]);
  if (a !== b) failed++;
  console.log(`${a === b ? "same   " : "DIFFERS"} ${key}  old=${a}${a === b ? "" : `\n                 new=${b}`}`);
}
process.exit(failed ? 1 : 0);

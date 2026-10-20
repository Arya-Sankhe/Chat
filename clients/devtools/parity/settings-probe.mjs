// Opens Settings on the old site and the new client and walks every tab:
// general, voice (the picker), memory (turn on, edit, save, clear), storage
// (the file list) and account (name, email, export). Compares the drawer's
// structure, text and form state after each step. Resets the fixtures first;
// needs the local backend running:
//   node devtools/parity/settings-probe.mjs
import { chromium } from "playwright";
import { reset, session } from "../local-backend/fixtures.mjs";

const SITES = [
  { origin: "http://localhost:5181", user: "old" },
  { origin: "http://localhost:5180", user: "new" }
];
const normalize = (value) => JSON.parse(JSON.stringify(value)
  .replace(/(00000000-0000-4000-[0-9a-f]{4}-)[ab]/g, "$1X")
  .replace(/student@(new\.)?klui\.test/g, "student@klui.test"));

const results = [];
const browser = await chromium.launch();
for (const site of SITES) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await reset();
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500, acceptDownloads: true });
    const auth = JSON.stringify(await session(site.user));
    await context.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), auth);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const drawer = () => page.evaluate(() => {
      const root = document.getElementById("settingsDrawer");
      const visible = (el) => !el.closest("[hidden], .hidden");
      return {
        open: root.classList.contains("open"),
        page: root.dataset.mobilePage || "",
        tabs: [...root.querySelectorAll("[data-settings-tab]")].map((b) => `${b.dataset.settingsTab}:${b.classList.contains("active")}`).join(" "),
        text: root.innerText.replace(/\s+/g, " ").trim(),
        inputs: [...root.querySelectorAll("input, textarea, button")].filter(visible)
          .map((el) => `${el.id || el.dataset.voice || el.className}=${el.type === "checkbox" ? el.checked : el.value ?? ""}${el.disabled ? ":disabled" : ""}`).join(" | "),
        hidden: [...root.querySelectorAll("[id]")].filter((el) => !visible(el)).map((el) => el.id).sort().join(" ")
      };
    });
    const tab = async (name) => {
      process.stderr.write(`${site.user} ${viewport.width} ${name}\n`);
      const selector = `#settingsDrawer [data-settings-tab="${name}"]`;
      // Phones show one page at a time: back to the tab list first.
      if (!(await page.isVisible(selector))) {
        await page.click("#settingsDrawer .mobile-settings-back");
        await page.waitForTimeout(400);
      }
      await page.click(selector);
      await page.waitForTimeout(1200);
    };
    const out = {};
    await page.goto(site.origin + "/");
    await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
    await page.waitForTimeout(500);
    if (viewport.width < 500) {
      await page.click("#nativeMobileMenu");
      await page.waitForTimeout(300);
      await page.click("#accountButton");
    } else {
      await page.click("#accountButton");
      await page.click("#profileMenuSettings");
    }
    await page.waitForTimeout(600);
    out.opened = await drawer();
    await tab("general");
    out.general = await drawer();
    await tab("voice");
    out.voice = await drawer();
    await tab("memory");
    out.memory = await drawer();
    await page.click("#memoryEnabledInput", { force: true });
    await page.waitForTimeout(1200);
    out.memoryOn = await drawer();
    if (await page.isVisible("#memoryContentInput")) {
      await page.fill("#memoryContentInput", "I study biology.");
      await page.click("#saveMemoryButton");
      await page.waitForTimeout(1200);
    }
    out.memorySaved = await drawer();
    await tab("storage");
    out.storage = await drawer();
    await tab("account");
    out.account = await drawer();
    const download = page.waitForEvent("download", { timeout: 5000 }).then((d) => d.suggestedFilename()).catch(() => "none");
    await page.click("#exportAccountButton");
    out.exported = (await download).replace(/\d{4}-\d{2}-\d{2}/, "<date>");
    await page.click("#deleteAccountButton");
    await page.waitForTimeout(400);
    out.deleteConfirm = await page.evaluate(() => document.getElementById("confirmDialog")?.innerText.replace(/\s+/g, " ").trim());
    out.errors = errors;
    results.push({ site: site.user, viewport: viewport.width, out: normalize(out) });
    await context.close();
  }
}
await browser.close();
await reset();

let failed = 0;
for (const width of [1440, 390]) {
  const [oldOut, newOut] = ["old", "new"].map((s) => results.find((r) => r.site === s && r.viewport === width).out);
  for (const key of Object.keys(oldOut)) {
    const a = JSON.stringify(oldOut[key]), b = JSON.stringify(newOut[key]);
    if (a !== b) failed++;
    console.log(`${a === b ? "same   " : "DIFFERS"} ${width} ${key}  old=${a}${a === b ? "" : `\n                      new=${b}`}`);
  }
}
process.exit(failed ? 1 : 0);

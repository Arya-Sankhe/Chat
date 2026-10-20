// The Dojo (study hub) on the old site and the new client: the course list,
// creating a course, a pasted-text source, a course chat turn (the fake
// OpenRouter answers), the flashcards source picker, renaming and deleting
// the course. Compares the Dojo's structure, text, where the composer and the
// messages sit, the URL and pixels after each step. Never adds a website
// source (that would fetch the page through a real reader). Resets the
// fixtures first; needs the local backend running:
//   node devtools/parity/study-probe.mjs
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { reset, session } from "../local-backend/fixtures.mjs";

const SITES = [
  { origin: "http://localhost:5181", user: "old" },
  { origin: "http://localhost:5180", user: "new" }
];
const normalize = (value) => JSON.parse(JSON.stringify(value)
  .replace(/(00000000-0000-4000-[0-9a-f]{4}-)[ab]/g, "$1X")
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
  .replace(/student@(new\.)?klui\.test/g, "student@klui.test"));

const results = [];
const browser = await chromium.launch();
for (const site of SITES) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await reset();
    const phone = viewport.width < 500;
    const context = await browser.newContext({ viewport, hasTouch: phone });
    const auth = JSON.stringify(await session(site.user));
    await context.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), auth);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com)/, (route) => {
      errors.push(`blocked ${new URL(route.request().url()).host}`);
      return route.abort();
    });
    const shots = {};
    const out = {};
    const snap = async (name) => {
      await page.waitForTimeout(700);
      shots[name] = await page.screenshot({ animations: "disabled" });
      out[name] = await page.evaluate(() => {
        const shape = (el, depth = 0) => depth > 7 ? "" : `${el.tagName.toLowerCase()}.${[...el.classList].sort().join(".")}[${[...el.children].map((c) => shape(c, depth + 1)).join(",")}]`;
        const study = document.getElementById("studyView");
        const open = [...document.querySelectorAll("dialog[open], .confirm-dialog.open, .rename-dialog.open, .dojo-source-dialog")].map((d) => `${d.id || d.className}:${d.innerText.replace(/\s+/g, " ").trim().slice(0, 200)}`);
        return {
          path: location.pathname,
          body: [...document.body.classList].filter((c) => !["mobile-ui", "capacitor-native"].includes(c)).sort().join(" "),
          study: study.className,
          shape: shape(study),
          text: study.innerText.replace(/\s+/g, " ").trim().slice(0, 900),
          composer: `${document.querySelector(".composer-area").className}@${document.querySelector(".composer-area").parentElement.className}`,
          messages: `${document.getElementById("messages").className}@${document.getElementById("messages").parentElement.className}`,
          crumb: `${document.getElementById("projectChatCrumb").className}|${document.getElementById("projectChatCrumb").getAttribute("aria-label")}|${document.getElementById("projectChatCrumb").innerText.trim()}`,
          dialogs: open,
          toast: document.querySelector("#toast.visible")?.textContent || ""
        };
      });
    };
    const step = async (name, action) => {
      const started = Date.now();
      try {
        await Promise.race([action(), new Promise((_, reject) => setTimeout(() => reject(new Error("step timed out")), 60000))]);
      } catch (error) {
        out[`${name}Error`] = error.message.split("\n")[0];
      }
      await snap(name);
      process.stderr.write(`${site.user} ${viewport.width} ${name} ${Date.now() - started}ms\n`);
    };
    const click = (selector) => page.locator(`${selector} >> visible=true`).first().click({ timeout: 8000 });
    // Phones show one course panel at a time behind tabs.
    const tab = async (name) => {
      const button = page.locator(`[data-study-tab=${name}] >> visible=true`);
      if (await button.count()) {
        await button.first().click();
        await page.waitForTimeout(500);
      }
    };

    await page.goto(site.origin + "/");
    await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
    await page.waitForTimeout(500);
    await step("dojo", async () => {
      if (phone) {
        await page.click("#nativeMobileMenu");
        await page.waitForTimeout(400);
      }
      await page.click("#studyHubButton");
      await page.waitForSelector("#studyView:not(.hidden)");
    });
    await step("newCourse", () => click("[data-create-course]"));
    await step("courseCreated", async () => {
      await page.fill("#courseNameInput", "Biology 101");
      await page.fill("#courseTermInput", "Fall 2026");
      await page.click("#courseCreateForm [type=submit]");
      await page.waitForURL(/\/study\/.+/);
      await page.waitForTimeout(1500);
    });
    await step("sourceDialog", async () => {
      await tab("materials");
      await click("[data-study-add-files]");
    });
    await step("sourceText", () => click("[data-source-kind=text]"));
    await step("sourceAdded", async () => {
      await page.fill("#dojo-source-name", "Photosynthesis notes");
      await page.fill("#dojo-source-content", "Photosynthesis turns light into chemical energy. The light reactions make ATP and NADPH; the Calvin cycle fixes carbon dioxide into sugar.");
      await click(".dojo-source-submit");
      await page.waitForTimeout(4000);
    });
    await step("promptFilled", async () => {
      await tab("chat");
      await click('[data-dojo-prompt="Give me an overview of this course"]');
    });
    await step("courseChat", async () => {
      await page.click("#sendButton");
      await page.getByText("Done.").first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(1500);
    });
    await step("flashcards", async () => {
      await tab("practice");
      await click("[data-practice-create=flashcards]");
    });
    await step("flashcardsClosed", async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    });
    // A course chat's own URL opens it inside its course.
    const chatPath = new URL(page.url()).pathname;
    await step("courseChatUrl", async () => {
      await page.goto(site.origin + chatPath);
      await page.getByText("Done.").first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1000);
    });
    await step("backToDojo", () => click("[data-study-back]"));
    await step("courseMenu", () => click("[data-toggle-course-menu]"));
    await step("renameDialog", () => click("[data-rename-course]"));
    await step("renamed", async () => {
      await page.fill("#courseRenameNameInput", "Biology 102");
      await page.click("#courseRenameForm [type=submit]");
      await page.waitForTimeout(1200);
    });
    await step("deleteConfirm", async () => {
      // The menu can still be open from the rename.
      if (!(await page.locator("[data-delete-course] >> visible=true").count())) {
        await click("[data-toggle-course-menu]");
        await page.waitForTimeout(300);
      }
      await click("[data-delete-course]");
    });
    await step("deleted", async () => {
      await page.click("#confirmDeleteButton", { timeout: 8000 });
      await page.waitForTimeout(1500);
    });
    out.errors = errors;
    results.push({ site: site.user, viewport: viewport.width, out: normalize(out), shots });
    await context.close();
  }
}
await browser.close();
await reset();

let failed = 0;
for (const width of [1440, 390]) {
  const [a, b] = ["old", "new"].map((s) => results.find((r) => r.site === s && r.viewport === width));
  for (const key of Object.keys(a.out)) {
    const x = JSON.stringify(a.out[key]), y = JSON.stringify(b.out[key]);
    // A hair above 0: the Dojo chat's rounded code blocks sit at fractional
    // offsets, and their corner antialiasing can differ by one colour level.
    let pixels = 0;
    if (a.shots[key] && b.shots[key]) {
      const p = PNG.sync.read(a.shots[key]), q = PNG.sync.read(b.shots[key]);
      pixels = p.width === q.width && p.height === q.height ? pixelmatch(p.data, q.data, null, p.width, p.height, { threshold: 0.01 }) : -1;
      if (pixels && process.env.PROBE_DUMP) {
        const fs = await import("node:fs");
        fs.writeFileSync(`devtools/parity/out/study-${width}-${key}-old.png`, a.shots[key]);
        fs.writeFileSync(`devtools/parity/out/study-${width}-${key}-new.png`, b.shots[key]);
      }
    }
    if (x !== y || pixels) failed++;
    console.log(`${x === y && !pixels ? "same   " : "DIFFERS"} ${width} ${key} px=${pixels}  old=${x.slice(0, process.env.PROBE_FULL ? 4000 : 300)}`);
    if (x !== y) {
      for (const k of Object.keys(a.out[key] || {})) {
        if (JSON.stringify(a.out[key][k]) !== JSON.stringify(b.out[key]?.[k])) console.log(`    ${k}: old=${JSON.stringify(a.out[key][k]).slice(0, 500)}\n    ${k}: new=${JSON.stringify(b.out[key]?.[k]).slice(0, 500)}`);
      }
      if (typeof a.out[key] !== "object") console.log(`    new=${y.slice(0, 500)}`);
    }
  }
}
process.exit(failed ? 1 : 0);

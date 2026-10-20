// Composer surfaces the other probes miss, on the old site and the new client:
// the home mode pills and their explainers, the Slides theme gallery (tabs,
// categories, the preset preview dialog and its slides, using a theme, the
// composer's theme card and clearing it), the in-chat theme picker on phones,
// and writing styles (the + menu's More page, picking one, its pill, clearing
// it). Nothing is sent. Compares the page's structure, text, URL and pixels
// after each step, and fails any step that throws or never reaches its end
// state. Resets the fixtures first; needs the local backend running:
//   node devtools/parity/composer-probe.mjs
import pixelmatch from "pixelmatch";
import { PNG as PNGReader } from "pngjs";
import { chromium } from "playwright";
import { reset, session } from "../local-backend/fixtures.mjs";

const SITES = [
  { origin: "http://localhost:5181", user: "old" },
  { origin: "http://localhost:5180", user: "new" }
];
const normalize = (value) => JSON.parse(JSON.stringify(value)
  .replace(/(00000000-0000-4000-[0-9a-f]{4}-)[ab]/g, "$1X")
  .replace(/caret\.is-(hidden|solid)/g, "caret")
  .replace(/hero-line\.is-long/g, "hero-line")
  .replace(/student@(new\.)?klui\.test/g, "student@klui.test"));

const results = [];
const stepErrors = [];
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
      await page.evaluate(async () => {
        await document.fonts.ready;
        // Theme covers load lazily; wait for the ones on screen.
        const images = [...document.images].filter((img) => img.loading !== "lazy" || img.getBoundingClientRect().top < innerHeight);
        await Promise.race([
          Promise.all(images.map((img) => img.complete ? null : new Promise((resolve) => { img.onload = img.onerror = resolve; }))),
          new Promise((resolve) => setTimeout(resolve, 5000))
        ]);
        document.querySelectorAll(".hero-line, .mobile-home-greeting").forEach((el) => { el.style.visibility = "hidden"; });
        // The composer mascot blinks and looks around on its own timers.
        if (!document.getElementById("probe-still-eyes")) {
          document.head.insertAdjacentHTML("beforeend", '<style id="probe-still-eyes">.composer-klui :is(.kp-eyes-open, .kp-eyes-shut) { visibility: hidden !important; }</style>');
        }
      });
      await page.waitForTimeout(300);
      shots[name] = await page.screenshot({ animations: "disabled" });
      out[name] = await page.evaluate(() => {
        const shape = (el, depth = 0) => !el || depth > 6 ? "" : `${el.tagName.toLowerCase()}.${[...el.classList].sort().join(".")}${el.hidden ? ":hidden" : ""}[${[...el.children].map((c) => shape(c, depth + 1)).join(",")}]`;
        const text = (el) => el?.innerText.replace(/\s+/g, " ").trim().slice(0, 400) || "";
        const dialog = document.getElementById("deckPresetDialog");
        const image = document.getElementById("deckPresetViewerImage");
        return {
          path: location.pathname,
          body: [...document.body.classList].filter((c) => !["mobile-ui", "capacitor-native"].includes(c)).sort().join(" "),
          homeModes: `${shape(document.getElementById("homeModes"))}|${text(document.getElementById("homeModes"))}`,
          deckThumb: `${shape(document.getElementById("composerDeckThumb"))}|${text(document.getElementById("composerDeckThumb"))}`,
          picker: `${shape(document.getElementById("deckPickerPop"))}|${text(document.getElementById("deckPickerPop")).slice(0, 200)}`,
          dialog: dialog?.open ? `${text(document.getElementById("deckPresetDialogTitle"))}|${text(document.getElementById("deckPresetCategory"))}|${image?.getAttribute("src")}|${image?.alt}|${shape(document.getElementById("deckPresetThumbs"))}|${text(document.getElementById("deckPresetUseBtn"))}` : "closed",
          actionMenu: `${document.getElementById("composerActionMenu")?.className}|${document.getElementById("composerActionMenu")?.dataset.page}`,
          styleMenu: `${document.getElementById("writingStyleMenu")?.className}|${[...document.querySelectorAll("[data-writing-style]")].map((b) => b.getAttribute("aria-checked")).join(",")}|${text(document.getElementById("writingStyleMenuValue"))}`,
          stylePill: `${document.getElementById("writingStylePill")?.className}|${text(document.getElementById("writingStylePill"))}`,
          placeholder: document.getElementById("promptInput")?.dataset.placeholder || document.getElementById("promptInput")?.getAttribute("placeholder") || "",
          prompt: document.getElementById("promptInput")?.innerText || document.getElementById("promptInput")?.value || "",
          toast: document.querySelector("#toast.visible")?.textContent || ""
        };
      });
    };
    // A step that throws, or whose expected end state never shows, fails on its
    // own: two sites failing the same way must not count as a match.
    const step = async (name, action, expected) => {
      try {
        await Promise.race([action(), new Promise((_, reject) => setTimeout(() => reject(new Error("step timed out")), 30000))]);
        if (expected) await page.waitForFunction(expected, null, { timeout: 8000 }).catch(() => { throw new Error(`end state not reached: ${expected}`); });
      } catch (error) {
        stepErrors.push(`${site.user} ${viewport.width} ${name}: ${error.message.split("\n")[0]}`);
      }
      await snap(name);
      process.stderr.write(`${site.user} ${viewport.width} ${name}\n`);
    };
    const click = (selector) => page.locator(`${selector} >> visible=true`).first().click({ timeout: 8000 });
    const dialogOpen = () => document.getElementById("deckPresetDialog")?.open === true;
    const dialogClosed = () => document.getElementById("deckPresetDialog")?.open === false;

    await page.goto(site.origin + "/");
    await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
    await page.waitForTimeout(800);
    await step("home", async () => {});

    if (!phone) {
      await step("compareExplainer", () => click("[data-pill-mode=compare]"), () => !!document.querySelector("#homeModes [data-explainer]"));
      await step("explainerClosed", () => click("[data-explainer-close]"), () => !document.querySelector("#homeModes [data-explainer]"));
      await step("slidesGallery", () => click("[data-pill-mode=slides]"), () => document.body.classList.contains("home-panel-open") && !!document.querySelector("#homeModes [data-deck-card]"));
      await step("deckTab", () => page.locator("#homeModes [data-deck-tab] >> visible=true").nth(1).click({ timeout: 8000 }), () => document.querySelectorAll("#homeModes [data-deck-tab]")[1]?.classList.contains("is-active"));
      await step("deckCategory", () => page.locator("#homeModes [data-deck-category] >> visible=true").nth(1).click({ timeout: 8000 }), () => document.querySelectorAll("#homeModes [data-deck-category]")[1]?.classList.contains("is-active"));
      await step("presetDialog", () => click("#homeModes [data-deck-card]:not(.home-deck-card-auto)"), dialogOpen);
      await step("presetNext", () => click("#deckPresetNext"), () => document.querySelector("#deckPresetThumbs [data-deck-slide='1']")?.classList.contains("is-active"));
      await step("presetThumb", () => click("#deckPresetThumbs [data-deck-slide='0']"), () => document.querySelector("#deckPresetThumbs [data-deck-slide='0']")?.classList.contains("is-active"));
      await step("presetUsed", () => click("#deckPresetUseBtn"), () => document.getElementById("deckPresetDialog")?.open === false && !!document.querySelector("#homeModes .home-deck-card.is-selected:not(.home-deck-card-auto)"));
      await step("deckCleared", () => click("[data-deck-clear]"), () => !document.querySelector("#composerDeckThumb [data-deck-clear]"));
    } else {
      // Phones pick Slides from the + menu, which opens the theme picker too.
      const pickerShown = () => document.getElementById("deckPickerPop")?.hidden === false && !!document.querySelector("#deckPickerPop [data-deck-card]");
      await step("slidesAction", async () => {
        await click("#actionMenuButton");
        await click("#mobileSlidesAction");
      }, () => !!document.querySelector("#composerDeckThumb [data-deck-open]") && document.getElementById("deckPickerPop")?.hidden === false);
      await step("presetDialog", () => click("#deckPickerPop [data-deck-card]:not(.home-deck-card-auto)"), dialogOpen);
      await step("presetNext", () => click("#deckPresetNext"), () => document.querySelector("#deckPresetThumbs [data-deck-slide='1']")?.classList.contains("is-active"));
      await step("presetEscaped", () => page.keyboard.press("Escape"), dialogClosed);
      await step("pickerClosed", () => click("[data-deck-picker-close]"), () => document.getElementById("deckPickerPop")?.hidden === true);
      await step("pickerReopened", () => click("[data-deck-open]"), pickerShown);
      await step("presetUsed", async () => {
        await click("#deckPickerPop [data-deck-card]:not(.home-deck-card-auto)");
        await page.waitForFunction(() => document.getElementById("deckPresetDialog")?.open === true);
        await click("#deckPresetUseBtn");
      }, () => document.getElementById("deckPresetDialog")?.open === false && !!document.querySelector("#composerDeckThumb img"));
      await step("deckCleared", async () => {
        if (await page.evaluate(() => document.getElementById("deckPickerPop")?.hidden === false)) await click("[data-deck-picker-close]");
        await click("[data-deck-clear]");
      }, () => !document.querySelector("#composerDeckThumb [data-deck-clear]"));
    }

    await step("moreMenu", async () => {
      await click("#actionMenuButton");
      await click("#actionMenuMore");
    }, () => document.getElementById("composerActionMenu")?.dataset.page === "more");
    await step("styleMenu", () => click("#writingStyleButton"), () => document.getElementById("writingStyleMenu")?.classList.contains("hidden") === false);
    await step("stylePicked", () => click("[data-writing-style=learning]"), () => document.getElementById("writingStylePill")?.classList.contains("hidden") === false);
    await step("styleMenuAgain", async () => {
      await click("#actionMenuButton");
      await click("#actionMenuMore");
    }, () => document.getElementById("composerActionMenu")?.dataset.page === "more");
    await step("styleMenuClosed", () => page.keyboard.press("Escape"), () => document.getElementById("composerActionMenu")?.classList.contains("hidden") !== false);
    // Phones don't show the pill; the style goes back to Normal from the menu.
    await step("styleCleared", async () => {
      if (!phone) return click("#writingStylePillClose");
      await click("#actionMenuButton");
      await click("#actionMenuMore");
      await click("#writingStyleButton");
      await click("[data-writing-style=normal]");
    }, () => document.getElementById("writingStylePill")?.classList.contains("hidden") === true);

    out.errors = errors;
    results.push({ site: site.user, viewport: viewport.width, out: normalize(out), shots });
    await context.close();
  }
}
await browser.close();
await reset();

let failed = stepErrors.length;
for (const line of stepErrors) console.log(`STEP FAILED ${line}`);
for (const r of results) if (r.out.errors.length) { failed++; console.log(`PAGE ERRORS ${r.site} ${r.viewport} ${JSON.stringify(r.out.errors)}`); }
for (const width of [1440, 390]) {
  const [a, b] = ["old", "new"].map((s) => results.find((r) => r.site === s && r.viewport === width));
  for (const key of new Set([...Object.keys(a.out), ...Object.keys(b.out)])) {
    const x = JSON.stringify(a.out[key]), y = JSON.stringify(b.out[key]);
    let pixels = 0;
    if (a.shots[key] && b.shots[key]) {
      const p = PNGReader.sync.read(a.shots[key]), q = PNGReader.sync.read(b.shots[key]);
      const diff = new PNGReader({ width: p.width, height: p.height });
      pixels = p.width === q.width && p.height === q.height ? pixelmatch(p.data, q.data, diff.data, p.width, p.height, { threshold: 0.01, diffMask: true }) : -1;
      // A handful of edge pixels a few colour levels apart is the compositor
      // antialiasing a rounded gradient differently, not a styling difference.
      if (pixels > 0 && pixels <= 8) {
        let worst = 0;
        for (let i = 0; i < diff.data.length; i += 4) {
          if (!diff.data[i + 3]) continue;
          for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(p.data[i + c] - q.data[i + c]));
        }
        if (worst <= 8) pixels = 0;
      }
      if (pixels && process.env.PROBE_DUMP) {
        const fs = await import("node:fs");
        fs.writeFileSync(`devtools/parity/out/composer-${width}-${key}-old.png`, a.shots[key]);
        fs.writeFileSync(`devtools/parity/out/composer-${width}-${key}-new.png`, b.shots[key]);
      }
    }
    if (x !== y || pixels) failed++;
    console.log(`${x === y && !pixels ? "same   " : "DIFFERS"} ${width} ${key} px=${pixels}  old=${x.slice(0, process.env.PROBE_FULL ? 4000 : 300)}`);
    if (x !== y) {
      for (const k of new Set([...Object.keys(a.out[key] || {}), ...Object.keys(b.out[key] || {})])) {
        if (JSON.stringify(a.out[key]?.[k]) !== JSON.stringify(b.out[key]?.[k])) console.log(`    ${k}: old=${JSON.stringify(a.out[key]?.[k]).slice(0, 600)}\n    ${k}: new=${JSON.stringify(b.out[key]?.[k]).slice(0, 600)}`);
      }
      if (typeof a.out[key] !== "object") console.log(`    new=${y.slice(0, 500)}`);
    }
  }
}
process.exit(failed ? 1 : 0);

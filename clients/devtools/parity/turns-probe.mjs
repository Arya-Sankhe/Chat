// Chat turns and chat tools the other probes miss, on the old site and the new
// client: the Compare dropdown and a compare turn, a Council turn, editing a
// sent message, regenerating a reply, a CSV and an image attached and sent
// (the image lightbox), the sidebar's pin, rename and search, and the unread
// mark a reply finished in the background leaves. The fake OpenRouter answers
// every model. Compares the page's structure, text, URL and pixels after each
// step, and fails any step that throws or never reaches its end state. Resets
// the fixtures first;
// needs the local backend running, plus the document worker (local Supabase and
// storage only) so attached files finish processing:
//   (cd worker && set -a && . ../clients/devtools/local-backend/parity.env && set +a &&
//     DOCUMENT_QUEUE=local python -u worker.py)
//   node devtools/parity/turns-probe.mjs
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
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
  .replace(/blob:[^"\\ ]+/g, "<blob>")
  // The home greeting types itself out; its caret blinks on its own clock.
  .replace(/caret\.is-(hidden|solid)/g, "caret")
  // ...and picks one of its greetings (long or short) at random.
  .replace(/hero-line\.is-long/g, "hero-line")
  .replace(/student@(new\.)?klui\.test/g, "student@klui.test"));
const CSV = Buffer.from("element,symbol\nhydrogen,H\nhelium,He\n");
// A 32x32 red PNG.
const IMAGE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAANUlEQVR4nO3NMQEAMAjEwKdq8K8HMZUQFracgKSmO5feaT0OFhwgB8gBcoAcIAfIAXKAHIR8xN0BbKPsVwsAAAAASUVORK5CYII=", "base64");

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
        const messages = document.getElementById("messages");
        // (Capped at five seconds: a chat that never settles is a finding of its own.)
        for (let last = -1, still = 0, tries = 0; still < 3 && tries < 33; tries++) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          still = messages.scrollTop === last ? still + 1 : 0;
          last = messages.scrollTop;
        }
        document.querySelectorAll(".hero-line, .mobile-home-greeting").forEach((el) => { el.style.visibility = "hidden"; });
        // The composer mascot blinks and looks around on its own timers.
        if (!document.getElementById("probe-still-eyes")) {
          document.head.insertAdjacentHTML("beforeend", '<style id="probe-still-eyes">.composer-klui :is(.kp-eyes-open, .kp-eyes-shut) { visibility: hidden !important; }</style>');
        }
      });
      shots[name] = await page.screenshot({ animations: "disabled" });
      out[name] = await page.evaluate(() => {
        const shape = (el, depth = 0) => depth > 6 ? "" : `${el.tagName.toLowerCase()}.${[...el.classList].sort().join(".")}${el.hidden ? ":hidden" : ""}[${[...el.children].map((c) => shape(c, depth + 1)).join(",")}]`;
        const text = (id) => document.getElementById(id)?.innerText.replace(/\s+/g, " ").trim().slice(0, 500) || "";
        const cls = (id) => document.getElementById(id)?.className ?? null;
        return {
          path: location.pathname,
          body: [...document.body.classList].filter((c) => !["mobile-ui", "capacitor-native"].includes(c)).sort().join(" "),
          messages: shape(document.getElementById("messages")),
          messagesText: text("messages"),
          composer: shape(document.querySelector(".composer")),
          previews: text("imagePreviews"),
          compare: `${cls("compareDropdown")}|${text("compareDropdown").slice(0, 300)}`,
          viewer: `${cls("documentViewer")}|${text("documentViewerTitle")}`,
          lightbox: cls("lightbox"),
          sidebar: text("conversationList").slice(0, 300),
          pinned: text("pinnedConversationList"),
          // The old site keeps the last results in the hidden dialog.
          search: `${cls("searchDialog")}|${document.getElementById("searchDialog")?.classList.contains("hidden") ? "" : text("searchChatResults").slice(0, 200)}`,
          rename: `${document.querySelector(".rename-dialog.open") ? "open" : "closed"}`,
          toast: document.querySelector("#toast.visible")?.textContent || ""
        };
      });
    };
    // A step that throws, or whose expected end state never shows, fails on its
    // own: two sites failing the same way must not count as a match.
    const step = async (name, action, expected) => {
      try {
        await Promise.race([action(), new Promise((_, reject) => setTimeout(() => reject(new Error("step timed out")), 45000))]);
        if (expected) await page.waitForFunction(expected, null, { timeout: 8000 }).catch(() => { throw new Error(`end state not reached: ${expected}`); });
      } catch (error) {
        stepErrors.push(`${site.user} ${viewport.width} ${name}: ${error.message.split("\n")[0]}`);
      }
      await snap(name);
      process.stderr.write(`${site.user} ${viewport.width} ${name}\n`);
    };
    const click = (selector) => page.locator(`${selector} >> visible=true`).first().click({ timeout: 8000 });
    const replies = (n) => page.waitForFunction((n) => (document.getElementById("messages")?.innerText.match(/Done\./g) || []).length >= n, n, { timeout: 30000 });
    const send = async (text) => {
      await page.click("#promptInput");
      await page.keyboard.type(text);
      await page.click("#sendButton");
    };
    const newChat = async () => {
      if (await page.evaluate(() => document.body.classList.contains("chat-empty"))) return;
      if (phone) await click("#compactNewChatButton");
      else await click("#newChatButton");
      await page.waitForTimeout(600);
    };

    await page.goto(site.origin + "/");
    await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
    await page.waitForTimeout(800);

    // Desktop only: phones pick Compare and Council from the home mode picker.
    if (!phone) {
      await step("compareOn", () => click("#compareButton"), () => Object.values(localStorage).some((v) => v.includes('"compareEnabled":true')));
      await step("compareTurn", async () => {
        await send("Compare these");
        await replies(2);
        await page.waitForTimeout(1500);
      });
      await step("councilTurn", async () => {
        await newChat();
        await click("#councilButton");
        await send("Council question");
        // (The judge's prompt says "long", so the fake model writes its long reply.)
        await page.waitForFunction(() => /Section 12/.test(document.getElementById("messages")?.innerText || ""), null, { timeout: 30000 });
        // The council's members answer, then one synthesis streams in.
        await page.waitForTimeout(1500);
      });
      await step("councilOff", async () => {
        await newChat();
        await click("#councilButton");
      }, () => !JSON.parse(localStorage.getItem("klui.chat.controls.v1") || "{}").compareEnabled);
    }
    await step("plainTurn", async () => {
      await send("Explain atoms");
      await replies(1);
      await page.waitForTimeout(1500);
    });
    await step("editing", async () => {
      await page.locator("#messages .message.user").first().hover();
      await click("[data-edit-msg]");
    }, () => !!document.querySelector("[data-edit-input]"));
    await step("edited", async () => {
      await page.fill("[data-edit-input]", "Explain molecules");
      await click("[data-edit-save]");
      await page.getByText("Here is a reply to Explain molecules").first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(1500);
    });
    await step("regenerated", async () => {
      await page.locator("#messages .message.assistant").last().hover();
      // A retry is its own request; wait for that turn, not the reply already there.
      const retried = page.waitForResponse((response) => response.request().method() === "POST" && (response.request().postData() || "").includes("retryAssistantMessageId"), { timeout: 15000 });
      await click("[data-retry-assistant-id]");
      // (The reply streams in that response's body.)
      await (await retried).finished();
      await page.waitForTimeout(1500);
    });
    await step("attached", async () => {
      await newChat();
      await page.setInputFiles("#imageFileInput", [
        { name: "elements.csv", mimeType: "text/csv", buffer: CSV },
        { name: "red.png", mimeType: "image/png", buffer: IMAGE }
      ]);
      // The document worker takes its time; wait until both files are ready.
      await page.waitForFunction(() => document.querySelectorAll("#imagePreviews > *").length >= 2 && !document.querySelector("#imagePreviews .preview-progress"), null, { timeout: 40000 });
      await page.waitForTimeout(500);
    });
    await step("attachedSent", async () => {
      await send("What is in these?");
      await replies(1);
      await page.waitForTimeout(2000);
    });
    await step("lightbox", () => click("#messages [data-preview-src]"), () => document.getElementById("lightbox")?.classList.contains("hidden") === false);
    await step("lightboxClosed", () => page.keyboard.press("Escape"), () => document.getElementById("lightbox")?.classList.contains("hidden") === true);
    if (!phone) {
      await step("sidebarOpen", async () => {
        if (!(await page.evaluate(() => document.body.classList.contains("sidebar-expanded")))) await click("#sidebarButton");
      });
      await step("chatMenu", async () => {
        await page.locator("#conversationList [data-open-chat-id]").first().hover();
        await click("#conversationList [data-toggle-menu-id]");
      });
      await step("pinned", () => click("[data-pin-chat-id]"), () => !!document.querySelector("#pinnedConversationList [data-open-chat-id]"));
      await step("renameOpen", async () => {
        await page.locator("#conversationList [data-open-chat-id]").first().hover();
        await click("#conversationList [data-toggle-menu-id]");
        await click("[data-rename-chat-id]");
      }, () => !!document.querySelector(".rename-dialog.open"));
      await step("renamed", async () => {
        await page.fill("#renameChatInput", "Atoms and molecules");
        await page.keyboard.press("Enter");
        await page.waitForTimeout(1200);
      }, () => /Atoms and molecules/.test(document.querySelector(".sidebar")?.innerText || document.body.innerText));
      await step("search", async () => {
        await click("#searchChatsButton");
        await page.fill("#searchChatInput", "atoms");
        await page.waitForTimeout(1500);
      }, () => /atom/i.test(document.getElementById("searchChatResults")?.innerText || ""));
      await step("searchClosed", () => page.keyboard.press("Escape"), () => document.getElementById("searchDialog")?.classList.contains("hidden") === true);
      // A reply that finishes in the background marks its chat; opening it clears the mark.
      await step("backgroundDone", async () => {
        await newChat();
        await send("Background slow");
        await page.waitForFunction(() => /\/c\//.test(location.pathname) && document.querySelector("#conversationList .is-running"), null, { timeout: 15000 });
        await page.locator("#conversationList .conversation-row:not(.active) [data-open-chat-id]").first().click();
        await page.waitForTimeout(15000);
      }, () => !!document.querySelector("#conversationList .is-done"));
      await step("unreadCleared", async () => {
        await page.locator("#conversationList .conversation-row:has(.is-done) [data-open-chat-id]").first().click();
        await page.waitForTimeout(1500);
      }, () => !document.querySelector("#conversationList .is-done"));
    }
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
        fs.writeFileSync(`devtools/parity/out/turns-${width}-${key}-old.png`, a.shots[key]);
        fs.writeFileSync(`devtools/parity/out/turns-${width}-${key}-new.png`, b.shots[key]);
      }
    }
    if (x !== y || pixels) failed++;
    console.log(`${x === y && !pixels ? "same   " : "DIFFERS"} ${width} ${key} px=${pixels}  old=${x.slice(0, process.env.PROBE_FULL ? 4000 : 300)}`);
    if (x !== y) {
      for (const k of new Set([...Object.keys(a.out[key] || {}), ...Object.keys(b.out[key] || {})])) {
        if (JSON.stringify(a.out[key][k]) !== JSON.stringify(b.out[key]?.[k])) console.log(`    ${k}: old=${JSON.stringify(a.out[key][k]).slice(0, 600)}\n    ${k}: new=${JSON.stringify(b.out[key]?.[k]).slice(0, 600)}`);
      }
      if (typeof a.out[key] !== "object") console.log(`    new=${y.slice(0, 500)}`);
    }
  }
}
process.exit(failed ? 1 : 0);

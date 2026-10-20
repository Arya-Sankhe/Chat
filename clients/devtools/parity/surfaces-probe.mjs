// Surfaces that sit over the chat, on the old site and the new client: text
// selection in a reply (Add to Chat, Ask in Side Chat, a side chat turn from
// the fake OpenRouter), Escape on the skill menu, a phone swipe closing
// Settings, and the once-per-account beta welcome. Resets the fixtures first;
// needs the local backend running:
//   node devtools/parity/surfaces-probe.mjs
import { chromium } from "playwright";
import { reset, session, setUserMetadata } from "../local-backend/fixtures.mjs";

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
  const out = {};
  const errors = [];
  const open = async (viewport, { hasTouch = false } = {}) => {
    const context = await browser.newContext({ viewport, hasTouch });
    const auth = JSON.stringify(await session(site.user));
    await context.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), auth);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    return { context, page };
  };
  const step = (name) => process.stderr.write(`${site.user} ${name}\n`);
  const surface = (page, id) => page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const shape = (node, depth = 0) => depth > 5 ? "" : `${node.tagName.toLowerCase()}.${[...node.classList].sort().join(".")}[${[...node.children].map((c) => shape(c, depth + 1)).join(",")}]`;
    return {
      className: el.className,
      hidden: el.hidden,
      aria: el.getAttribute("aria-hidden"),
      shape: shape(el),
      text: el.innerText.replace(/\s+/g, " ").trim().slice(0, 400),
      box: (({ left, top, width, height }) => [left, top, width, height].map(Math.round).join(","))(el.getBoundingClientRect())
    };
  }, id);
  const overlay = (page) => page.evaluate(() => `${document.getElementById("overlay").hidden}:${document.getElementById("overlay").dataset.mode || ""}`);
  const selectReply = (page) => page.evaluate(() => {
    const target = document.querySelector(".message.assistant .message-content p");
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  await reset();
  {
    step("selection");
    const { context, page } = await open({ width: 1440, height: 900 });
    await page.goto(site.origin + "/c/" + `00000000-0000-4000-8000-${site.user === "old" ? "a" : "b"}00000000001`);
    await page.waitForSelector(".message.assistant .message-content p");
    await page.waitForTimeout(1000);
    let point = await selectReply(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    await page.waitForTimeout(400);
    out.selection = await surface(page, "selectionActions");
    await page.click("#selectionAddToChat");
    await page.waitForTimeout(500);
    out.addedToChat = await page.evaluate(() => ({
      previews: document.getElementById("imagePreviews")?.innerText.replace(/\s+/g, " ").trim(),
      actions: document.getElementById("selectionActions").className,
      focused: document.activeElement?.id
    }));
    point = await selectReply(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.click("#selectionAskSideChat");
    await page.waitForTimeout(600);
    out.sideChat = await surface(page, "sideChatPanel");
    await page.fill("#sideChatInput", "What does this mean?");
    await page.press("#sideChatInput", "Enter");
    await page.waitForFunction(() => /Done\./.test(document.getElementById("sideChatMessages")?.innerText || ""), null, { timeout: 15000 });
    await page.waitForTimeout(800);
    out.sideChatReply = await surface(page, "sideChatPanel");
    await page.click("#sideChatClose");
    await page.waitForTimeout(500);
    out.sideChatClosed = await surface(page, "sideChatPanel");

    step("escape");
    await page.click("#promptInput");
    await page.keyboard.type("/");
    await page.waitForTimeout(400);
    out.skillMenu = await page.evaluate(() => document.getElementById("skillCommandMenu")?.className);
    await page.click("#messages", { position: { x: 20, y: 20 } });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    out.skillMenuEscaped = await page.evaluate(() => document.getElementById("skillCommandMenu")?.className);
    await context.close();
  }

  {
    step("swipe");
    const { context, page } = await open({ width: 390, height: 844 }, { hasTouch: true });
    await page.goto(site.origin + "/");
    await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
    await page.waitForTimeout(500);
    await page.click("#nativeMobileMenu");
    await page.waitForTimeout(300);
    await page.click("#accountButton");
    await page.waitForTimeout(600);
    out.settingsOpen = await page.evaluate(() => document.getElementById("settingsDrawer").classList.contains("open"));
    const swipe = async (x0, x1) => page.evaluate(([x0, x1]) => {
      const target = document.querySelector("#settingsDrawer h2, #settingsDrawer") || document.body;
      const touch = (x) => new Touch({ identifier: 1, target, clientX: x, clientY: 400 });
      target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch(x0)], changedTouches: [touch(x0)] }));
      target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [touch(x1)] }));
    }, [x0, x1]);
    await swipe(100, 140);
    await page.waitForTimeout(400);
    out.shortSwipe = await page.evaluate(() => document.getElementById("settingsDrawer").classList.contains("open"));
    await swipe(100, 260);
    await page.waitForTimeout(600);
    out.swiped = await page.evaluate(() => ({ settings: document.getElementById("settingsDrawer").classList.contains("open"), sidebar: document.body.classList.contains("sidebar-open") }));
    await swipe(100, 260);
    await page.waitForTimeout(600);
    out.swipedAgain = await page.evaluate(() => ({ settings: document.getElementById("settingsDrawer").classList.contains("open"), sidebar: document.body.classList.contains("sidebar-open") }));
    await context.close();
  }

  {
    step("temporary");
    const { context, page } = await open({ width: 1440, height: 900 });
    await page.goto(site.origin + "/");
    await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
    await page.waitForTimeout(800);
    const temp = () => page.evaluate(() => {
      const shown = (id) => {
        const el = document.getElementById(id);
        return el ? `${el.className}|${el.getAttribute("aria-pressed")}|${getComputedStyle(el).display !== "none" && el.offsetParent !== null}` : null;
      };
      return {
        path: location.pathname,
        temporary: document.body.classList.contains("temporary-chat"),
        toggle: shown("temporaryChatToggle"),
        label: shown("temporaryChatLabel"),
        chats: document.querySelectorAll("#conversationList [data-open-chat-id]").length,
        messages: document.querySelectorAll("#messages .message").length
      };
    });
    await page.click("#temporaryChatToggle");
    await page.waitForTimeout(500);
    out.temporaryOn = await temp();
    await page.click("#promptInput");
    await page.keyboard.type("hello");
    await page.keyboard.press("Enter");
    await page.getByText("Done.").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(1200);
    out.temporarySent = await temp();
    await page.click("#temporaryChatToggle");
    await page.waitForTimeout(600);
    out.temporaryOff = await temp();

    // A long paste becomes a card; Escape closes its dialog.
    await page.click("#promptInput");
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", Array.from({ length: 40 }, (_, i) => `Line ${i + 1}: the quick brown fox jumps over the lazy dog.`).join("\n"));
      document.getElementById("promptInput").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(500);
    await page.click("[data-open-composer-paste]");
    await page.waitForTimeout(400);
    out.pasteDialog = await surface(page, "pastedTextDialog");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    out.pasteEscaped = (await surface(page, "pastedTextDialog"))?.className;

    // The Dojo hides the temporary chat controls.
    await page.click("[data-remove-paste]");
    await page.click("#temporaryChatToggle");
    await page.waitForTimeout(400);
    await page.click("#studyHubButton");
    await page.waitForSelector("#studyView:not(.hidden)");
    await page.waitForTimeout(800);
    out.temporaryDojo = await temp();
    await context.close();
  }

  {
    step("welcome");
    await setUserMetadata(site.user, { beta_welcome_seen: false });
    const { context, page } = await open({ width: 1440, height: 900 });
    await page.goto(site.origin + "/");
    await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
    await page.waitForTimeout(1500);
    out.welcome = await surface(page, "betaWelcome");
    out.welcomeOverlay = await overlay(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    out.welcomeEscaped = [await surface(page, "betaWelcome"), await overlay(page)];
    await page.reload();
    await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
    await page.waitForTimeout(1500);
    out.welcomeOnce = [(await surface(page, "betaWelcome"))?.className, await overlay(page)];
    await context.close();
  }
  out.errors = errors;
  results.push(normalize(out));
}
await browser.close();
await reset();

const [oldOut, newOut] = results;
let failed = 0;
for (const key of Object.keys(oldOut)) {
  const a = JSON.stringify(oldOut[key]), b = JSON.stringify(newOut[key]);
  if (a !== b) failed++;
  console.log(`${a === b ? "same   " : "DIFFERS"} ${key}  old=${a.slice(0, 600)}${a === b ? "" : `\n                 new=${b.slice(0, 600)}`}`);
}
process.exit(failed ? 1 : 0);

// Drives the same signed-in chat interactions on the old site and the new client
// and compares what each leaves behind (URL, body classes, rendered messages,
// menus). Resets the fixtures first; needs the local backend running:
//   node devtools/parity/chat-probe.mjs
import { chromium } from "playwright";
import { reset, session } from "../local-backend/fixtures.mjs";

await reset();
const SITES = [
  { origin: "http://localhost:5181", user: "old" },
  { origin: "http://localhost:5180", user: "new" }
];
// The two fixture users' ids differ only in one hex digit (a/b).
const normalize = (value) => JSON.parse(JSON.stringify(value).replace(/(00000000-0000-4000-[0-9a-f]{4}-)[ab]/g, "$1X"));

const results = [];
const browser = await chromium.launch();
for (const site of SITES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const auth = JSON.stringify(await session(site.user));
  await context.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), auth);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const snapshot = () => page.evaluate(() => ({
    path: location.pathname,
    body: [...document.body.classList].filter((c) => !["mobile-ui", "capacitor-native"].includes(c)).sort().join(" "),
    articles: [...document.querySelectorAll("#messages > article")].map((a) => a.className).join(","),
    greeting: Boolean(document.querySelector("#messages .empty-state")),
    activeRow: document.querySelector(".conversation-row.active")?.dataset.chatId || "",
    rows: document.querySelectorAll("#conversationList .conversation-row").length
  }));
  const out = {};
  await page.goto(site.origin + "/");
  await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
  await page.waitForTimeout(500);
  out.home = await snapshot();

  await page.click("#sidebarButton");
  await page.click("#conversationList [data-open-chat-id]");
  await page.getByText("The Calvin cycle").first().waitFor();
  await page.waitForTimeout(300);
  out.opened = await snapshot();

  await page.click("#messages .message-more-menu summary");
  out.moreOpen = await page.$eval("#messages .message-more-menu", (d) => d.open);
  await page.mouse.click(700, 300);
  out.moreClosed = await page.$eval("#messages .message-more-menu", (d) => d.open);

  await page.click("#messages article.assistant [data-copy-msg]");
  await page.waitForTimeout(100);
  out.copied = await page.$eval("#messages article.assistant [data-copy-msg]", (b) => b.className);
  out.clipboard = (await page.evaluate(() => navigator.clipboard.readText())).slice(0, 40);

  await page.click("#newChatButton");
  await page.waitForTimeout(300);
  out.newChat = await snapshot();

  await page.goBack();
  await page.waitForTimeout(800);
  out.back = await snapshot();

  await page.click("#conversationList [data-open-chat-id]");
  await page.getByText("The Calvin cycle").first().waitFor();
  await page.locator(".conversation-row.active").hover();
  await page.click(".conversation-row.active .conversation-menu-btn");
  await page.click(".conversation-row.active [data-delete-chat-id]");
  await page.click("#confirmDeleteButton");
  await page.waitForTimeout(800);
  out.deleted = await snapshot();
  out.errors = errors;
  results.push(normalize(out));
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

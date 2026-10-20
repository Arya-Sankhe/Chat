// Sends messages through the composer on the old site and the new client (the
// fake OpenRouter answers) and compares what each leaves behind: the composer's
// controls while typing, streaming and done, the rendered turn, the URL and the
// sidebar. Resets the fixtures first; needs the local backend running:
//   node devtools/parity/send-probe.mjs
import { chromium } from "playwright";
import { reset, session } from "../local-backend/fixtures.mjs";

await reset();
const SITES = [
  { origin: "http://localhost:5181", user: "old" },
  { origin: "http://localhost:5180", user: "new" }
];
// Fixture user ids differ in one hex digit; new chats get fresh ids.
const normalize = (value) => JSON.parse(JSON.stringify(value)
  .replace(/(00000000-0000-4000-[0-9a-f]{4}-)[ab]/g, "$1X")
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>"));

const results = [];
const browser = await chromium.launch();
for (const site of SITES) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await reset();
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500 });
    const auth = JSON.stringify(await session(site.user));
    await context.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), auth);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const composer = () => page.evaluate(() => {
      const attrs = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        return [...el.attributes].filter((a) => a.name !== "style" || id === "promptInput").map((a) => `${a.name}=${a.value}`).sort().join(" ");
      };
      return {
        prompt: attrs("promptInput"),
        text: document.getElementById("promptInput").textContent,
        send: attrs("sendButton"),
        stop: attrs("stopButton"),
        voice: attrs("voiceButton"),
        voiceMode: attrs("voiceModeButton"),
        composer: document.querySelector(".composer").className,
        beam: document.querySelector(".composer-beam")?.className
      };
    });
    const turn = () => page.evaluate(() => ({
      path: location.pathname.replace(/[0-9a-f-]{36}/, "<id>"),
      body: [...document.body.classList].filter((c) => !["mobile-ui", "capacitor-native"].includes(c)).sort().join(" "),
      articles: [...document.querySelectorAll("#messages > article")].map((a) => a.className).join(","),
      texts: [...document.querySelectorAll("#messages > article")].map((a) => a.innerText.replace(/\s+/g, " ").trim().slice(0, 160)),
      rows: document.querySelectorAll("#conversationList .conversation-row").length,
      activeTitle: (document.querySelector(".conversation-row.active")?.innerText || "").replace(/\s+/g, " ").trim()
    }));
    const out = {};
    await page.goto(site.origin + "/");
    await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
    await page.waitForTimeout(500);
    out.idle = await composer();

    await page.click("#promptInput");
    await page.keyboard.type("Explain photosynthesis");
    await page.waitForTimeout(400);
    out.typed = await composer();

    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("in two lines");
    await page.waitForTimeout(200);
    out.multiline = await composer();

    await page.keyboard.press("Enter");
    await page.getByText("Done.").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    out.sent = await turn();
    out.afterSend = await composer();

    // A slow reply: Stop takes Send's place, and stopping keeps the partial answer.
    await page.click("#promptInput");
    await page.keyboard.type("slow follow up");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#stopButton:not(.hidden)", { timeout: 10000 });
    await page.waitForTimeout(600);
    out.streaming = await composer();
    await page.click("#stopButton");
    await page.waitForSelector("#stopButton.hidden", { state: "attached", timeout: 10000 });
    await page.waitForTimeout(1500);
    out.stopped = await turn();
    out.afterStop = await composer();
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

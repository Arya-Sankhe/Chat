// Opens voice mode on the old site and the new client with a fake microphone
// and compares what each shows: the first-run voice picker, then the live
// voice session overlay, then the composer once it closes. Resets the fixtures
// first; needs the local backend running:
//   node devtools/parity/voice-probe.mjs
import { chromium } from "playwright";
import { reset, session } from "../local-backend/fixtures.mjs";

const SITES = [
  { origin: "http://localhost:5181", user: "old" },
  { origin: "http://localhost:5180", user: "new" }
];
const normalize = (value) => JSON.parse(JSON.stringify(value).replace(/(00000000-0000-4000-[0-9a-f]{4}-)[ab]/g, "$1X"));

const results = [];
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
for (const site of SITES) {
  await reset();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
  const auth = JSON.stringify(await session(site.user));
  await context.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), auth);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The voice surfaces are appended to <body>; compare their structure and text.
  const overlays = () => page.evaluate(() => {
    const shape = (el, depth = 0) => depth > 4 ? "" : `${el.tagName.toLowerCase()}.${[...el.classList].sort().join(".")}[${[...el.children].map((c) => shape(c, depth + 1)).join(",")}]`;
    return {
      body: [...document.body.classList].filter((c) => !["mobile-ui", "capacitor-native"].includes(c)).sort().join(" "),
      surfaces: [...document.body.children]
        .filter((el) => /voice/.test(el.className))
        .map((el) => ({ shape: shape(el), text: el.innerText.replace(/\s+/g, " ").trim().slice(0, 200) }))
    };
  });
  const out = {};
  const step = (name) => process.stderr.write(`${site.user} ${name}\n`);
  await page.goto(site.origin + "/");
  await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
  await page.waitForTimeout(500);
  out.button = await page.$eval("#voiceModeButton", (b) => `${b.className}|${b.disabled}`);
  step("home");
  await page.click("#voiceModeButton");
  await page.waitForSelector(".voice-picker-dialog", { timeout: 5000 });
  await page.waitForTimeout(500);
  out.picker = await overlays();
  step("picker");
  await page.click("[data-voice-save]");
  await page.waitForTimeout(1500);
  out.live = await overlays();
  out.voiceSetting = await page.evaluate(() => JSON.parse(localStorage.getItem("klui.chat.controls.v1") || "{}").voiceChosen ?? null);
  step("live");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  out.closed = await overlays();
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

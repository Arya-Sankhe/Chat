// The packaged Android app, old (Capacitor, tech.klui.app.ref) against new
// (Expo hosting the web client, tech.klui.app.dev), on one emulator: launch,
// sign-in state, Back through sheets, chats and out of the app, the left-edge
// swipe, a klui.ai/c/<id> link, the keyboard and the temporary chat composer,
// dark mode and the system bars, text zoom, resume and the update dialog.
// Each step drives real touches and keys through adb, waits for its end state,
// then compares the page's state and the device's pixels (status bar masked;
// its icon colour is compared from the window's appearance flags).
//
// Needs: an emulator with 4 GB of RAM (at 2 GB System UI and the keyboard
// stall), the local backend, both apps installed as parity builds pointing at
// http://localhost:55600, `adb reverse` for 55600/55421/55900, and the
// emulator's proxy refusing klui.ai (the update check's real URL):
//   node /tmp/sliceb/native/block-proxy.mjs &  # or any proxy that blocks klui.ai
//   adb shell settings put global http_proxy 10.0.2.2:55990
//   node devtools/parity/native-probe.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { reset, session } from "../local-backend/fixtures.mjs";

const APPS = [
  { name: "old", pkg: "tech.klui.app.ref", activity: "tech.klui.app.MainActivity", port: 9334, user: "old" },
  { name: "new", pkg: "tech.klui.app.dev", activity: "tech.klui.app.dev.MainActivity", port: 9333, user: "new" }
];
const OUT = new URL("./out/native/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const adb = (...args) => execFileSync("adb", args, { maxBuffer: 64 * 1024 * 1024 });
const sh = (command) => adb("shell", command).toString();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalize = (value) => JSON.parse(JSON.stringify(value)
  .replace(/(00000000-0000-4000-[0-9a-f]{4}-)[ab]/g, "$1X")
  .replace(/student@(new\.)?klui\.test/g, "student@klui.test")
  .replace(/caret\.is-(hidden|solid)/g, "caret")
  .replace(/hero-line\.is-long/g, "hero-line"));

/* ─── DevTools over adb ─── */

class Page {
  constructor(app) { this.app = app; this.id = 0; this.pending = new Map(); this.handlers = []; }
  async connect() {
    const { pkg, port } = this.app;
    let pid = "";
    for (let i = 0; i < 60 && !pid; i++) {
      try { pid = sh(`pidof ${pkg}`).trim(); } catch { pid = ""; } // pidof exits 1 until the process starts
      if (pid && !sh("cat /proc/net/unix").includes(`webview_devtools_remote_${pid}`)) pid = "";
      if (!pid) await wait(250);
    }
    if (!pid) throw new Error(`${pkg} has no WebView`);
    try { adb("forward", "--remove", `tcp:${port}`); } catch { /* not forwarded yet */ }
    adb("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
    let target;
    for (let i = 0; i < 40 && !target; i++) {
      try {
        const list = await (await fetch(`http://localhost:${port}/json`)).json();
        target = list.find((t) => t.type === "page" && t.url.startsWith("https://localhost"));
      } catch { /* the first connection to a new socket is dropped */ }
      if (!target) await wait(250);
    }
    if (!target) throw new Error(`${pkg}: no https://localhost page`);
    this.ws?.close();
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      } else if (message.method) for (const handler of this.handlers) handler(message);
    };
    this.pid = pid;
  }
  send(method, params = {}, timeout = 20000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out`)); }, timeout);
    });
  }
  async eval(fn, arg, timeout = 20000) {
    const expression = `(${fn})(${arg === undefined ? "" : JSON.stringify(arg)})`;
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeout);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  /** Polls a predicate in the page until it holds. */
  async until(fn, arg, label = String(fn), timeout = 30000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      // An evaluation sent while the page loads can go unanswered: poll with short ones.
      try { if (await this.eval(fn, arg, 2000)) return; } catch { /* page navigating */ }
      await wait(150);
    }
    throw new Error(`never reached: ${label}`);
  }
}

/* ─── Device input ─── */

async function rectOf(page, selector) {
  const rect = await page.eval((sel) => {
    const el = typeof sel === "string" ? document.querySelector(sel) : null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: devicePixelRatio, w: r.width, h: r.height };
  }, selector);
  if (!rect || !rect.w || !rect.h) throw new Error(`no visible ${selector}`);
  return rect;
}
async function tap(page, selector) {
  const r = await rectOf(page, selector);
  sh(`input tap ${Math.round(r.x * r.dpr)} ${Math.round(r.y * r.dpr)}`);
}
const key = (code) => sh(`input keyevent ${code}`);
const BACK = 4;
const GBOARD = "com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME";
// Back while the IME is up only closes it.
async function dropKeyboard() {
  if (sh("dumpsys input_method").includes("mInputShown=true")) key(BACK);
  await wait(300);
}

// Closes a Gboard screen (setup or stylus intro) that took the foreground.
async function dismissGboard() {
  for (let i = 0; i < 3 && foreground().includes("com.google.android.inputmethod.latin/"); i++) {
    key(BACK);
    await wait(500);
  }
}

function foreground() {
  const line = sh("dumpsys activity activities").split("\n").find((l) => l.includes("topResumedActivity")) || "";
  return line;
}
// Waits for the app to reach (or leave) the foreground: a relaunch sent while
// Home is still animating lands first, and Home then covers it.
async function inFront(app, wanted) {
  for (let i = 0; i < 40; i++) {
    if (foreground().includes(`${app.pkg}/`) === wanted) return;
    await wait(250);
  }
  throw new Error(`${app.pkg} never ${wanted ? "came to" : "left"} the foreground`);
}
function barAppearance(pkg) {
  // Each window is a "Window #N Window{...}" block; prefer the live activity
  // window over one that is still exiting.
  const blocks = sh("dumpsys window windows").split(/\n(?=  Window #\d+ )/)
    .filter((block) => block.split("\n")[0].includes(`${pkg}/`));
  const block = blocks.find((b) => !b.split("\n")[0].includes("EXITING")) || blocks[0];
  if (!block) return "?";
  return (block.match(/apr=([A-Z_ ]*)/)?.[1] || "none").trim();
}

/* ─── Snapshots ─── */

async function settle(page) {
  await wait(700);
  await page.eval(async () => {
    await document.fonts.ready;
    const messages = document.getElementById("messages");
    for (let last = -1, still = 0, tries = 0; messages && still < 3 && tries < 33; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      still = messages.scrollTop === last ? still + 1 : 0;
      last = messages.scrollTop;
    }
    // Random greetings, the mascot's own blink and gaze timers, and the caret.
    if (!document.getElementById("probe-still")) {
      document.head.insertAdjacentHTML("beforeend", `<style id="probe-still">
        .hero-line, .mobile-home-greeting { visibility: hidden !important; }
        .composer-klui :is(.kp-eyes-open, .kp-eyes-shut) { visibility: hidden !important; }
        * { caret-color: transparent !important; }
      </style>`);
    }
  });
  await wait(400);
}

function state(page) {
  return page.eval(() => {
    const root = getComputedStyle(document.documentElement);
    const overlay = document.getElementById("overlay");
    const update = document.getElementById("appUpdateDialog");
    const text = (id) => document.getElementById(id)?.innerText.replace(/\s+/g, " ").trim().slice(0, 300) || "";
    return {
      path: location.pathname,
      body: [...document.body.classList].filter((c) => !["mobile-ui", "capacitor-native"].includes(c)).sort().join(" "),
      mode: document.body.dataset.mode || "",
      overlay: overlay && !overlay.hidden ? overlay.dataset.mode || "on" : "",
      active: document.activeElement?.id || document.activeElement?.tagName || "",
      keyboard: parseFloat(root.getPropertyValue("--native-keyboard-height")) > 0,
      insets: [root.getPropertyValue("--safe-area-inset-top"), root.getPropertyValue("--safe-area-inset-bottom")].map((v) => Math.round(parseFloat(v) || 0)),
      composer: [...(document.querySelector(".composer")?.classList || [])].filter((c) => c !== "is-morphing").sort().join(" "),
      update: update && !update.classList.contains("hidden") ? { body: text("appUpdateBody"), later: !document.getElementById("appUpdateLater")?.classList.contains("hidden") } : null,
      chats: [...document.querySelectorAll("#conversationList .conversation-item, .conversation-list .conversation-item")].length,
      messages: document.querySelectorAll("#messages .message").length,
      title: document.title,
      notice: text("authNotice"),
      // The WebView's text zoom as the page lays out text: a 20px line's height.
      textHeight: (() => {
        const probe = document.createElement("span");
        probe.textContent = "Xg";
        probe.style.cssText = "position:fixed;left:0;top:0;font-size:20px;visibility:hidden";
        document.body.appendChild(probe);
        const height = probe.getBoundingClientRect().height;
        probe.remove();
        return Math.round(height * 10) / 10;
      })()
    };
  });
}

function screenshot() {
  return PNG.sync.read(adb("exec-out", "screencap", "-p"));
}

// System UI fades on its own schedule: take the frame once two in a row agree,
// ignoring the status bar's clock.
async function stableScreenshot() {
  let png = screenshot();
  for (let tries = 0; tries < 8; tries++) {
    await wait(250);
    const next = screenshot();
    const start = next.width * STATUS_BAR * 4;
    const same = Buffer.compare(png.data.subarray(start), next.data.subarray(start)) === 0;
    png = next;
    if (same) break;
  }
  return png;
}

/* ─── Steps ─── */

const FAKE_UPDATE = (required) => ({
  published: true, versionCode: 9999, versionName: "9.9.9", releaseNotes: ["Faster replies.", "Fixes."],
  minimumVersionCode: required ? 9999 : 0, apkUrl: "https://klui.ai/download/android"
});

async function seed(page, app, auth) {
  // The old app keeps the session in Capacitor SecureStorage; the new one in the host's secure store.
  await page.eval(async ({ old, value }) => {
    if (old) {
      await window.Capacitor.Plugins.SecureStorage.internalSetItem({ prefixedKey: "capacitor-storage_klui.auth.v1", data: JSON.stringify(value), sync: false });
      return;
    }
    await new Promise((resolve, reject) => {
      const id = 900001;
      const previous = window.__kluiNativeReply;
      window.__kluiNativeReply = (reply) => {
        if (reply.id !== id) return previous(reply);
        window.__kluiNativeReply = previous;
        reply.ok ? resolve() : reject(new Error(reply.error));
      };
      window.KluiNativeHost.postMessage(JSON.stringify({ id, method: "secure.set", args: { key: "klui.auth.v1", value } }));
    });
  }, { old: app.name === "old", value: auth });
  await flushed();
}

// Capacitor's storage plugins save with SharedPreferences.apply(), which
// reaches disk later; the relaunch's force-stop must not beat it.
const flushed = () => wait(1500);

async function nativeStore(page, app, method, key, value) {
  // secure.remove / prefs.set through each app's own native layer.
  return page.eval(async ({ old, method, key, value }) => {
    if (old) {
      const P = window.Capacitor.Plugins;
      if (method === "secure.remove") return P.SecureStorage.internalRemoveItem({ prefixedKey: `capacitor-storage_${key}`, sync: false });
      if (method === "prefs.set") return P.Preferences.set({ key, value });
      if (method === "prefs.remove") return P.Preferences.remove({ key });
    }
    return new Promise((resolve, reject) => {
      const id = 900000 + Math.floor(Math.random() * 1000);
      const previous = window.__kluiNativeReply;
      window.__kluiNativeReply = (reply) => {
        if (reply.id !== id) return previous(reply);
        window.__kluiNativeReply = previous;
        reply.ok ? resolve() : reject(new Error(reply.error));
      };
      window.KluiNativeHost.postMessage(JSON.stringify({ id, method, args: { key, value } }));
    });
  }, { old: app.name === "old", method, key, value }).finally(flushed);
}

async function launch(app, { clear = false } = {}) {
  for (const other of APPS) sh(`am force-stop ${other.pkg}`);
  if (clear) sh(`pm clear ${app.pkg}`);
  sh(`am start -n ${app.pkg}/${app.activity}`);
  const page = new Page(app);
  await page.connect();
  await page.until(() => document.readyState === "complete" && Boolean(document.body?.dataset.mode) && !document.getElementById("mobileLaunchScreen"), undefined, "boot");
  if (app.name === "old") {
    // The Capacitor app's first inset pass can land before its page listens
    // (README, "First launch insets"); its own resend gets it to the state a
    // user normally sees, so the steps compare against that.
    await page.eval(async () => {
      const top = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-top")) || 0;
      if (top()) return;
      await window.Capacitor.Plugins.TextZoom.syncSystemBarInsets();
      for (let i = 0; i < 20 && !top(); i++) await new Promise((r) => setTimeout(r, 100));
    });
  }
  return page;
}
// renderShell() has run: guests get body.guest-mode, accounts lose it.
const booted = (signed) => document.body.classList.contains("guest-mode") === !signed && Boolean(document.body.dataset.mode);

async function runApp(app) {
  const results = {};
  const errors = [];
  const shot = async (page, name) => {
    await settle(page);
    const value = normalize(await state(page));
    value.bars = barAppearance(app.pkg);
    // An "isn't responding" dialog anywhere in the run is a failure of its own.
    if (sh("dumpsys window windows").includes("Application Not Responding")) errors.push(`${name}: ANR dialog on screen`);
    results[name] = { state: value, png: await stableScreenshot() };
  };
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
      // What was on screen when the step gave up.
      try { writeFileSync(`${OUT}error-${name}.${app.name}.png`, PNG.sync.write(screenshot())); } catch { /* device gone */ }
    }
  };

  await reset();
  // Gboard can latch into its floating physical-keyboard toolbar (it then
  // never docks); a fresh Gboard starts each app's run docked. Showing the
  // on-screen keyboard beside the emulator's hardware one keeps it docked, and
  // with handwriting off a fresh Gboard skips its "Try out your stylus" intro.
  sh("settings put secure show_ime_with_hard_keyboard 1");
  sh("settings put secure stylus_handwriting_enabled 0");
  sh("pm clear com.google.android.inputmethod.latin");
  sh(`ime set ${GBOARD}`);
  await wait(2000);
  // Both apps store the session as its JSON text.
  const auth = JSON.stringify(await session(app.user));
  let page = await launch(app, { clear: true });
  await page.until(booted, false, "guest boot");
  await shot(page, "01-guest-home");

  await step("signed-in", async () => {
    await seed(page, app, auth);
    page = await launch(app);
    await page.until(booted, true, "signed-in boot");
    await page.until(() => document.querySelectorAll(".conversation-item").length >= 3, undefined, "chats listed");
    await dropKeyboard(); // The launch focus raised the keyboard, in both apps alike.
    await page.until(() => !document.body.classList.contains("keyboard-open"), undefined, "keyboard down");
    await shot(page, "02-signed-in-home");
  });

  await step("sidebar", async () => {
    await tap(page, "#nativeMobileMenu");
    await page.until(() => document.body.classList.contains("sidebar-open"), undefined, "sidebar open");
    await shot(page, "03-sidebar");
    key(BACK);
    await page.until(() => !document.body.classList.contains("sidebar-open"), undefined, "sidebar closed by Back");
    await shot(page, "04-sidebar-back");
  });

  await step("open-chat", async () => {
    await tap(page, "#nativeMobileMenu");
    await page.until(() => document.body.classList.contains("sidebar-open"), undefined, "sidebar open");
    await wait(400);
    const index = await page.eval(() => [...document.querySelectorAll(".conversation-item")].findIndex((el) => /Photosynthesis/.test(el.textContent)));
    await page.eval((i) => document.querySelectorAll(".conversation-item")[i].setAttribute("data-probe-target", ""), index);
    await tap(page, "[data-probe-target]");
    await page.until(() => location.pathname.startsWith("/c/") && document.querySelectorAll("#messages .message").length > 0, undefined, "chat open");
    await shot(page, "05-chat");
    key(BACK);
    await page.until(() => location.pathname === "/", undefined, "Back to a new chat");
    await shot(page, "06-chat-back");
  });

  await step("deep-link", async () => {
    const id = `00000000-0000-4000-8000-${app.user === "old" ? "a" : "b"}${"1".padStart(11, "0")}`;
    sh(`am start -a android.intent.action.VIEW -d https://klui.ai/c/${id} ${app.pkg}`);
    await page.until((cid) => location.pathname === `/c/${cid}` && document.querySelectorAll("#messages .message").length > 0, id, "deep link opened");
    await shot(page, "07-deep-link");
  });

  await step("edge-swipe", async () => {
    sh("input swipe 8 1300 700 1300 180");
    await page.until(() => location.pathname === "/", undefined, "edge swipe left the chat");
    await shot(page, "08-edge-swipe");
  });

  await step("keyboard", async () => {
    await tap(page, "#promptInput");
    await wait(1000);
    if (foreground().includes("com.google.android.inputmethod.latin/")) {
      await dismissGboard();
      await tap(page, "#promptInput");
    }
    await page.until(() => document.body.classList.contains("keyboard-open"), undefined, "keyboard open");
    await wait(800);
    await shot(page, "09-keyboard");
    key(BACK);
    await page.until(() => !document.body.classList.contains("keyboard-open"), undefined, "keyboard closed by Back");
    await shot(page, "10-keyboard-back");
  });

  await step("temporary-chat", async () => {
    await tap(page, "#temporaryChatToggle");
    await page.until(() => document.body.classList.contains("temporary-chat") && document.body.classList.contains("keyboard-open"), undefined, "temporary chat with keyboard");
    await wait(800);
    await shot(page, "11-temporary");
    key(BACK); // The IME takes this Back; the pinned composer reopens it.
    await wait(1500);
    await shot(page, "12-temporary-ime-back");
    await page.eval(() => document.getElementById("temporaryChatToggle").click());
    await page.until(() => !document.body.classList.contains("temporary-chat"), undefined, "temporary chat off");
    await dropKeyboard();
    await page.until(() => !document.body.classList.contains("keyboard-open"), undefined, "keyboard down");
  });

  await step("dark-mode", async () => {
    await page.eval(() => document.querySelector('[data-appearance="dark"]').click());
    await page.until(() => document.body.dataset.mode === "dark", undefined, "dark");
    await wait(3500); // Both apps restyle the system bars about 3 s later.
    await shot(page, "13-dark");
    await page.eval(() => document.querySelector('[data-appearance="light"]').click());
    await page.until(() => document.body.dataset.mode === "light", undefined, "light");
  });

  await step("text-zoom", async () => {
    const settings = await page.eval(() => {
      const value = JSON.parse(localStorage.getItem("klui.chat.controls.v1") || "{}");
      value.uiTextScale = 115;
      localStorage.setItem("klui.chat.controls.v1", JSON.stringify(value));
      return JSON.stringify(value);
    });
    await nativeStore(page, app, "prefs.set", "klui.chat.controls.v1", settings);
    page = await launch(app);
    await page.until(booted, true, "relaunch");
    await page.until(() => document.querySelectorAll(".conversation-item").length >= 3, undefined, "chats listed");
    await dropKeyboard();
    await page.until(() => !document.body.classList.contains("keyboard-open"), undefined, "keyboard down");
    await shot(page, "14-text-zoom");
    const plain = settings.replace('"uiTextScale":115', '"uiTextScale":100');
    await page.eval((value) => localStorage.setItem("klui.chat.controls.v1", value), plain);
    await nativeStore(page, app, "prefs.set", "klui.chat.controls.v1", plain);
  });

  await step("settings", async () => {
    await page.eval(() => document.getElementById("profileMenuSettings").click());
    await page.until(() => document.getElementById("settingsDrawer").classList.contains("open"), undefined, "settings open");
    await dropKeyboard();
    // The apps sign in as different test users; show one address in both.
    await page.eval(() => { document.querySelector('[data-settings-tab="account"] .mobile-settings-description').textContent = "student@klui.test"; });
    await wait(1200);
    await shot(page, "20-settings");
    key(BACK);
    await page.until(() => !document.getElementById("settingsDrawer").classList.contains("open"), undefined, "settings closed by Back");
  });

  for (const required of [false, true]) {
    await step(required ? "update-required" : "update", async () => {
      await page.send("Fetch.enable", { patterns: [{ urlPattern: "*downloads/android/latest.json*" }] });
      const handler = (message) => {
        if (message.method !== "Fetch.requestPaused") return;
        const body = Buffer.from(JSON.stringify(FAKE_UPDATE(required))).toString("base64");
        page.send("Fetch.fulfillRequest", { requestId: message.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "access-control-allow-origin", value: "*" }], body }).catch(() => {});
      };
      page.handlers.push(handler);
      await nativeStore(page, app, "secure.remove", "klui.mobile.last-update-check.v1");
      key(3); // Home, then back into the app: resume runs the update check.
      await inFront(app, false);
      sh(`am start -n ${app.pkg}/${app.activity}`);
      await inFront(app, true);
      await page.until(() => !document.getElementById("appUpdateDialog")?.classList.contains("hidden"), undefined, "update dialog");
      await dropKeyboard();
      await shot(page, required ? "17-update-required" : "15-update");
      key(BACK);
      await wait(800);
      await shot(page, required ? "18-update-required-back" : "16-update-back");
      page.handlers = page.handlers.filter((h) => h !== handler);
      await page.send("Fetch.disable");
    });
  }

  await step("back-exits", async () => {
    page = await launch(app);
    await page.until(booted, true, "relaunch");
    await page.until(() => document.querySelectorAll(".conversation-item").length >= 3, undefined, "chats listed");
    await dropKeyboard();
    await page.until(() => !document.body.classList.contains("keyboard-open"), undefined, "keyboard down");
    await wait(500);
    key(BACK);
    await wait(1500);
    const top = foreground();
    results["19-back-exits"] = { state: { appInFront: top.includes(app.pkg) }, png: null };
  });

  page.ws?.close();
  return { results, errors };
}

/* ─── Compare ─── */

const STATUS_BAR = 140;
function compare(a, b) {
  if (!a || !b) return null;
  const width = a.width, height = a.height;
  const mask = (png) => { for (let i = 0; i < width * STATUS_BAR * 4; i++) png.data[i] = 0; };
  mask(a); mask(b);
  const diff = new PNG({ width, height });
  const count = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1, diffMask: true });
  return { count, diff };
}

// Run the emulator with hw.gpu.enabled=yes / hw.gpu.mode=host: its software
// renderer leaves stale regions on screen (a ghost settings row, a closed
// dialog), in both apps alike.
// PROBE_APPS=new (or old) runs one app alone while chasing a failure.
const only = process.env.PROBE_APPS?.split(",");
const runs = {};
for (const app of APPS) runs[app.name] = only && !only.includes(app.name) ? { results: {}, errors: [] } : await runApp(app);
const names = [...new Set([...Object.keys(runs.old.results), ...Object.keys(runs.new.results)])].sort();
let same = 0;
const bad = [];
for (const name of names) {
  const a = runs.old.results[name];
  const b = runs.new.results[name];
  const stateSame = JSON.stringify(a?.state) === JSON.stringify(b?.state);
  const pixels = compare(a?.png, b?.png);
  const pixelSame = !a?.png || !b?.png ? a?.png === b?.png || (!a?.png && !b?.png) : pixels.count === 0;
  if (a?.png) writeFileSync(`${OUT}${name}.old.png`, PNG.sync.write(a.png));
  if (b?.png) writeFileSync(`${OUT}${name}.new.png`, PNG.sync.write(b.png));
  if (pixels?.count) writeFileSync(`${OUT}${name}.diff.png`, PNG.sync.write(pixels.diff));
  if (stateSame && pixelSame) same += 1;
  else bad.push({ name, state: stateSame ? "same" : { old: a?.state, new: b?.state }, pixels: pixels?.count ?? "missing" });
}
for (const entry of bad) console.log(JSON.stringify(entry, null, 1));
for (const [name, run] of Object.entries(runs)) for (const error of run.errors) console.log(`step error (${name}) ${error}`);
const stepErrors = runs.old.errors.length + runs.new.errors.length;
console.log(`native-probe same=${same} bad=${bad.length} stepErrors=${stepErrors}`);
process.exit(bad.length || stepErrors ? 1 : 0);

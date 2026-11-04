// End-to-end checks of the native shell + web surface on the emulator, behind the
// block proxy and a counting proxy in front of local Supabase. Needs local-backend/up.sh.
// Usage: run-slice.sh (sets the proxies up). Prints one line per check; exits 1 on any failure.
import { execFileSync } from "node:child_process";
import http from "node:http";
import { reset, session as fixtureSession } from "../../local-backend/fixtures.mjs";

const PKG = "tech.klui.app.dev";
const SCHEME = `${PKG}://`;
const DEVTOOLS_PORT = 9333;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8", timeout: 30000 }).trim();
const sh = (command) => adb("shell", command);

/* ─── Counting proxy: every Supabase call the app makes goes through here ─── */
const auth = { refreshes: 0, logouts: 0, delayMs: 0 };
http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    if (process.env.SLICE_DEBUG) console.log("supabase", req.method, req.url.slice(0, 60));
    const isRefresh = req.url.includes("grant_type=refresh_token");
    if (isRefresh) auth.refreshes += 1;
    if (req.url.includes("/auth/v1/logout")) auth.logouts += 1;
    if (isRefresh && auth.delayMs) await wait(auth.delayMs);
    const upstream = http.request({ host: "127.0.0.1", port: 55421, path: req.url, method: req.method, headers: req.headers }, (reply) => {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    });
    upstream.on("error", () => res.destroy());
    upstream.end(Buffer.concat(chunks));
  });
}).listen(55431);
adb("reverse", "tcp:55421", "tcp:55431");

/* ─── API gate: holds the account request while the test says the network is bad ─── */
const gate = { holdAccount: false };
http.createServer((req, res) => {
  if (gate.holdAccount && req.url.startsWith("/api/me")) return; // never answers
  const upstream = http.request({ host: "127.0.0.1", port: 55600, path: req.url, method: req.method, headers: req.headers }, (reply) => {
    res.writeHead(reply.statusCode, reply.headers);
    reply.pipe(res);
  });
  upstream.on("error", () => res.destroy());
  req.pipe(upstream);
}).listen(55432);
adb("reverse", "tcp:55600", "tcp:55432");

/* ─── Native UI: RN testIDs are Android resource ids ─── */
function nodes({ forScreenReader = false } = {}) {
  // --compressed leaves out what accessibility services don't get.
  const xml = adb("exec-out", "uiautomator", "dump", ...(forScreenReader ? ["--compressed"] : []), "/dev/stdout");
  return [...xml.matchAll(/<node [^>]*>/g)].map(([tag]) => ({
    id: /resource-id="([^"]*)"/.exec(tag)?.[1] || "",
    text: /text="([^"]*)"/.exec(tag)?.[1] || "",
    className: /class="([^"]*)"/.exec(tag)?.[1] || "",
    bounds: /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag)?.slice(1).map(Number)
  }));
}
const visible = (id) => nodes().find((node) => node.id.endsWith(id) && (node.id === id || node.id.endsWith(`/${id}`)));
async function waitFor(id, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const node = visible(id);
    if (node) return node;
    await wait(500);
  }
  return null;
}
async function tap(id) {
  const node = await waitFor(id);
  if (!node) throw new Error(`nothing to tap: ${id}`);
  const [x1, y1, x2, y2] = node.bounds;
  sh(`input tap ${(x1 + x2) >> 1} ${(y1 + y2) >> 1}`);
}
const openUrl = (url) => sh(`am start -a android.intent.action.VIEW -d '${url.replace(/'/g, "'\\''")}' ${PKG}`);
const launch = () => sh(`am start -n ${PKG}/${PKG}.MainActivity`);
const stop = () => sh(`am force-stop ${PKG}`);

/* ─── The web surface, over DevTools ─── */
class Page {
  async connect(ms = 40000) {
    const end = Date.now() + ms;
    for (;;) {
      try {
        const pid = sh(`pidof ${PKG}`);
        adb("forward", `tcp:${DEVTOOLS_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
        const targets = await (await fetch(`http://localhost:${DEVTOOLS_PORT}/json`)).json();
        const target = targets.find((item) => item.type === "page");
        if (target) {
          this.ws = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => {
            this.ws.addEventListener("open", resolve, { once: true });
            this.ws.addEventListener("error", reject, { once: true });
          });
          return this;
        }
      } catch {}
      if (Date.now() > end) throw new Error("no web surface to connect to");
      await wait(500);
    }
  }
  send(method, params = {}) {
    const id = Math.floor(Math.random() * 1e9);
    return new Promise((resolve) => {
      const onMessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        this.ws.removeEventListener("message", onMessage);
        clearTimeout(timer);
        resolve(message);
      };
      // Some calls never answer: Page.crash takes the page with it.
      const timer = setTimeout(() => {
        this.ws.removeEventListener("message", onMessage);
        resolve({ timedOut: true });
      }, method === "Page.crash" ? 1500 : 60000);
      this.ws.addEventListener("message", onMessage);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const { result, timedOut, error } = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (error) throw new Error(`${error.message}: ${expression.slice(0, 80)}`);
    if (timedOut) throw new Error(`no answer: ${expression.slice(0, 80)}`);
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result?.result?.value;
  }
  async until(expression, ms = 30000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await this.eval(expression)) return true; } catch {}
      await wait(300);
    }
    return false;
  }
  close() { this.ws?.close(); }
}
const hostCall = (method, args = {}) => `new Promise((resolve) => {
  if (!window.__sliceReplies) {
    window.__sliceReplies = new Map();
    const page = window.__kluiNativeReply;
    window.__kluiNativeReply = (reply) => {
      const waiting = window.__sliceReplies.get(reply.id);
      if (!waiting) return page(reply);
      window.__sliceReplies.delete(reply.id);
      waiting(reply);
    };
  }
  const id = 800000 + Math.floor(Math.random() * 99999);
  window.__sliceReplies.set(id, resolve);
  window.KluiNativeHost.postMessage(JSON.stringify({ id, method: ${JSON.stringify(method)}, args: ${JSON.stringify(args)} }));
})`;
const BOOTED = `document.readyState === "complete" && Boolean(document.body?.dataset.mode) && !document.getElementById("mobileLaunchScreen")`;

/* ─── Checks ─── */
let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}
const SEND_HELLO = `(async () => {
  const input = document.querySelector("#promptInput");
  input.focus();
  document.execCommand("insertText", false, "Say hello");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  document.querySelector("#sendButton").click();
  return true;
})()`;
const openChatList = () => waitFor("chatList", 30000);
const CHAT_ID = "00000000-0000-4000-8000-b00000000001";
const CHAT_LINK = `https://klui.ai/c/${CHAT_ID}`;
const signInWith = (value) => openUrl(`${SCHEME}test/session?data=${encodeURIComponent(JSON.stringify(value))}`);

await reset();
const fresh = await fixtureSession("new");
sh(`pm clear ${PKG}`);

launch();
check("cold start signed out shows sign-in", Boolean(await waitFor("signIn", 30000)));

openUrl(`${SCHEME}auth/callback?error=access_denied&error_description=Nope`);
const error = await waitFor("signInError");
check("a sign-in error from the callback is shown", error?.text === "Nope", error?.text);

openUrl(`${SCHEME}evil/callback?code=stolen`);
await wait(1500);
check("a callback on another path doesn't sign in", Boolean(visible("signIn")) && !visible("homeTitle"));

openUrl(`${SCHEME}auth/callback?code=no-verifier`);
await wait(1500);
const expired = await waitFor("signInError");
check("a code with no verifier asks to retry, one exchange", /expired/i.test(expired?.text || ""), expired?.text);

// A guest uses the page without an account, and leaves back to sign-in.
await tap("continueAsGuest");
let guest = await new Page().connect();
check("a guest gets the web surface", await guest.until(`${BOOTED} && document.body.classList.contains("guest-mode")`, 40000));
sh("input keyevent 4");
check("a guest's Back returns to sign-in", Boolean(await waitFor("signIn", 8000)));
await tap("continueAsGuest");
await wait(800);
await guest.eval("window.__kept = 1");
await guest.eval(SEND_HELLO);
await wait(1000);

// Signing in from there keeps the page and sends what the guest wrote.
signInWith(fresh);
check("signing in keeps a guest's page", await guest.until(`window.__kept === 1 && !document.body.classList.contains("guest-mode")`, 20000));
check("and sends what they wrote", await guest.until(`document.body.innerText.includes("Done.")`, 30000));
guest.close();

// The server has revoked this session (a fixture reset does that): the page finds out, and the app ends it.
await reset();
stop();
launch();
openUrl(`${SCHEME}test/open?target=chat`);
check("a revoked session ends at sign-in", Boolean(await waitFor("signIn", 30000)));

// A chat link waits through sign-in, and also through a cold start.
openUrl(CHAT_LINK);
await wait(1000);
signInWith(await fixtureSession("new"));
let linked = await new Page().connect();
check("a chat link waits through sign-in", await linked.until(`document.body.innerText.includes("Photosynthesis turns light")`, 40000));
linked.close();
stop();
openUrl(CHAT_LINK);
linked = await new Page().connect();
check("a chat link on a cold start opens the chat", await linked.until(`document.body.innerText.includes("Photosynthesis turns light")`, 40000));
linked.close();
stop();
launch();
check("the signed-in app starts on the native home", Boolean(await waitFor("homeTitle", 30000)));
stop();
launch();
check("the session survives a cold start", Boolean(await waitFor("homeTitle", 30000)));

openUrl(`${SCHEME}test/open?target=chat`);
let page = await new Page().connect();
check("web surface boots signed in on the bundled origin", await page.until(`${BOOTED} && !document.body.classList.contains("guest-mode")`, 40000) && (await page.eval("location.origin")) === "https://localhost");

const snapshot = await page.eval(hostCall("session.snapshot"));
check("the page's snapshot has no refresh token", snapshot.ok && snapshot.value?.session?.access_token && !JSON.stringify(snapshot).includes("refresh_token"));
const blocked = await page.eval(hostCall("secure.get", { key: "klui.auth.v1" }));
check("the page can't read the stored session", !blocked.ok, blocked.error);
const stores = await page.eval(`JSON.stringify({ ...localStorage })`);
check("no refresh token in page storage", !stores.includes(fresh.refresh_token) && !stores.includes("refresh_token"));

await page.eval("window.__kept = 1");
const webShown = () => nodes().some((node) => node.className === "android.webkit.WebView");
let covered = false;
for (let i = 0; i < 10 && !covered; i++) {
  covered = webShown() && !nodes({ forScreenReader: true }).some((node) => node.id === "homeTitle" || node.id === "openChat");
  if (!covered) await wait(500);
}
check("native screens are hidden from screen readers under the page", covered);
sh("input keyevent 4");
await wait(700);
if (webShown()) sh("input keyevent 4"); // the first Back only closed the keyboard
const home = await waitFor("homeTitle", 8000);
check("Back at the page's root returns to the native home", Boolean(home) && (await page.eval("window.__kept")) === 1);
check("the hidden page is hidden from screen readers", !webShown());
openUrl(`${SCHEME}test/open?target=chat`);
await waitFor("android.webkit.WebView", 500);
await page.until(`document.querySelector("#promptInput")`, 5000);
await page.eval(`document.querySelector("#promptInput").focus()`);
sh("input tap 500 2100");
await wait(1200);
const keyboardShown = () => /mInputShown=true/.test(sh("dumpsys input_method"));
const hadKeyboard = keyboardShown();
await page.eval(hostCall("app.exit"));
await wait(1200);
check("hiding the page closes its keyboard and focus", hadKeyboard && !keyboardShown() && (await page.eval("document.activeElement === document.body || document.activeElement === null")), `keyboard before ${hadKeyboard}`);
openUrl(`${SCHEME}test/open?target=chat`);
await wait(800);
check("reopening keeps the same page", (await page.eval("window.__kept")) === 1);

await page.eval("location.reload()");
await wait(500);
check("reload stays signed in", await page.until(`${BOOTED} && !document.body.classList.contains("guest-mode")`, 40000));
await page.eval(`location.href = "https://localhost/some/deep/path"`);
await wait(800);
check("cold load of a deep path gets the JS and CSS", await page.until(`${BOOTED} && document.styleSheets.length > 0 && location.pathname === "/some/deep/path"`, 40000));

const conversations = await page.eval(`(async () => {
  const { value: { session } } = await ${hostCall("session.snapshot")};
  const res = await fetch("http://localhost:55600/api/conversations?limit=5", { headers: { authorization: "Bearer " + session.access_token } });
  return res.status + " " + (await res.text()).slice(0, 120) + " " + JSON.stringify(session).slice(0, 40);
})()`);
check("authenticated fetch from the page", conversations.startsWith("200"), conversations);

// A slow account request leaves the page waiting, not a guest, and it recovers.
gate.holdAccount = true;
await page.eval("location.reload()");
await wait(11000);
check("a slow account load waits instead of turning the page into a guest", await page.eval(`!document.body.classList.contains("guest-mode") && Boolean(document.getElementById("mobileLaunchScreen"))`));
gate.holdAccount = false;
check("and the page recovers by itself", await page.until(`${BOOTED} && !document.body.classList.contains("guest-mode") && Boolean(document.querySelector("#promptInput"))`, 40000),
  await page.eval(`JSON.stringify({ state: document.readyState, launch: document.getElementById("mobileLaunchScreen")?.className, status: document.querySelector(".launch-status")?.textContent, body: document.body.className, input: Boolean(document.querySelector("#promptInput")) })`));

// Expired everywhere: many concurrent refreshes make one Supabase call.
signInWith({ ...(await fixtureSession("new")), expires_at: 1000 });
await wait(1500);
auth.refreshes = 0;
auth.delayMs = 1500;
const replies = await page.eval(`Promise.all([${[0, 1, 2, 3, 4].map((n) => hostCall("session.refresh", { force: n % 2 === 0 })).join(",")}])`);
check("concurrent refreshes make one call", auth.refreshes === 1 && replies.every((reply) => reply.ok && reply.value?.session?.access_token), `calls ${auth.refreshes}: ${replies.map((reply) => reply.ok ? "ok" : reply.error)}`);
auth.delayMs = 0;
if (process.env.SLICE_DEBUG) console.log(JSON.stringify(replies[0]).slice(0, 300));
check("the page's token follows the refresh", await page.until(`(async () => (await ${hostCall("session.snapshot")}).value.session.expires_at > 2000)()`, 5000));

// Sign out while a refresh is out: stays signed out, including after a restart.
signInWith({ ...(await fixtureSession("new")), expires_at: 1000 });
await wait(1500);
auth.delayMs = 2500;
await page.eval(`(${hostCall("session.refresh", { force: true })}, ${hostCall("session.signOut")}, 1)`);
await wait(4000);
auth.delayMs = 0;
check("sign-out during a refresh ends on sign-in", Boolean(await waitFor("signIn")) && !visible("homeTitle"));
page.close();
stop();
launch();
await wait(2500);
check("still signed out after a restart", Boolean(await waitFor("signIn", 30000)));

// A dead renderer comes back on its own, signed in.
signInWith(await fixtureSession("new"));
openUrl(`${SCHEME}test/open?target=chat`);
page = await new Page().connect();
await page.until(BOOTED, 40000);
await page.send("Page.crash");
await wait(3000);
page.close();
page = await new Page().connect();
check("after a renderer crash the surface comes back signed in", await page.until(`${BOOTED} && !document.body.classList.contains("guest-mode")`, 40000));
check("and fills the screen", (await page.eval("innerWidth * innerHeight")) > 100000, String(await page.eval("innerWidth + 'x' + innerHeight")));
const afterCrash = await page.eval(hostCall("session.snapshot"));
check("the bridge works after the crash", afterCrash.ok && afterCrash.value?.session?.access_token);

// Streaming, through the fake OpenRouter.
const typed = await page.eval(SEND_HELLO);
check("streams a reply over SSE in the page", typed && await page.until(`document.body.innerText.includes("Done.")`, 30000));
page.close();

// Dojo opens straight to the study hub.
sh("input keyevent 4");
sh("input keyevent 4");
stop();
launch();
await tap("openDojo");
page = await new Page().connect();
check("the Dojo target opens the study hub", await page.until(`${BOOTED} && document.body.classList.contains("study-open")`, 30000));
page.close();

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);

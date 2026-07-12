import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { readStylesheet } from "./helpers/styles.js";

import { loadConfig } from "../server/config.js";
import { applyApiCors, handleApiPreflight } from "../server/http/cors.js";
import { apiUrl, parseAuthCallbackUrl } from "../public/js/platform/index.js";
import { compareVersionCodes } from "../public/js/platform/updates.js";

function responseRecorder() {
  return {
    headers: {},
    status: null,
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(status, headers = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    },
    end(body = "") {
      this.body = body;
    }
  };
}

test("mobile config includes the packaged Capacitor origin and configured development origins", () => {
  const config = loadConfig({ MOBILE_ALLOWED_ORIGINS: "http://localhost:5173, https://preview.example" });
  assert.deepEqual(config.mobile.allowedOrigins, [
    "https://klui.tech",
    "https://www.klui.tech",
    "https://localhost",
    "http://localhost:5173",
    "https://preview.example"
  ]);
});

test("API CORS accepts the packaged app origin without credentials", () => {
  const response = responseRecorder();
  const result = applyApiCors(
    { headers: { origin: "https://localhost" } },
    response,
    ["https://localhost"]
  );
  assert.equal(result.allowed, true);
  assert.equal(response.headers["access-control-allow-origin"], "https://localhost");
  assert.equal(response.headers["access-control-allow-credentials"], undefined);
  assert.equal(response.headers.vary, "Origin");
});

test("API CORS does not reflect an arbitrary origin", () => {
  const response = responseRecorder();
  const result = applyApiCors(
    { headers: { origin: "https://malicious.example" } },
    response,
    ["https://localhost"]
  );
  assert.equal(result.allowed, false);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});

test("API preflight rejects arbitrary origins and accepts the packaged app", () => {
  const denied = responseRecorder();
  assert.equal(handleApiPreflight(
    { method: "OPTIONS", headers: { origin: "https://malicious.example" } },
    denied,
    ["https://localhost"]
  ), true);
  assert.equal(denied.status, 403);

  const accepted = responseRecorder();
  assert.equal(handleApiPreflight(
    { method: "OPTIONS", headers: { origin: "https://localhost" } },
    accepted,
    ["https://localhost"]
  ), true);
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers["access-control-allow-origin"], "https://localhost");
});

test("API URL resolver remains relative outside Capacitor", () => {
  assert.equal(apiUrl("/api/me"), "/api/me");
  assert.equal(apiUrl("api/plans"), "/api/plans");
  assert.equal(apiUrl("https://example.com/value"), "https://example.com/value");
});

test("API URL resolver uses the production API origin inside Capacitor", () => {
  const previous = globalThis.Capacitor;
  globalThis.Capacitor = { isNativePlatform: () => true };
  try {
    assert.equal(apiUrl("/api/me"), "https://klui.tech/api/me");
  } finally {
    if (previous === undefined) delete globalThis.Capacitor;
    else globalThis.Capacitor = previous;
  }
});

test("mobile build supports an API origin override without changing source", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/platform/index.js", import.meta.url), "utf8")
  );
  assert.match(source, /VITE_KLUI_API_ORIGIN/);
  assert.match(source, /https:\/\/klui\.tech/);
});

test("chat shell is visible before JavaScript finishes booting", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/index.html", import.meta.url), "utf8")
  );
  assert.match(source, /class="app-shell" id="chatView"/);
  assert.doesNotMatch(source, /class="app-shell hidden" id="chatView"/);
});

test("chat navigation stays on the active conversation while a response is running", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  assert.match(source, /function blockChatNavigationWhileRunning\(\)/);
  assert.match(source, /async function openConversation\(conversationId\)[\s\S]*?blockChatNavigationWhileRunning\(\)/);
  assert.match(source, /function openNewChat\([^)]*\)[\s\S]*?blockChatNavigationWhileRunning\(\)/);
  assert.match(source, /window\.addEventListener\("popstate"[\s\S]*?blockChatNavigationWhileRunning\(\)/);
});

test("mobile bundle includes the shared Deep Research controls", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/index.html", import.meta.url), "utf8")
  );
  const buildScript = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../scripts/mobile/copy-static.mjs", import.meta.url), "utf8")
  );
  assert.match(source, /id="deepResearchToggle"/);
  assert.match(source, /id="researchReportView"/);
  assert.match(buildScript, /Mobile build is missing the Deep Research control/);
});

test("native auth callback parser returns only the PKCE code", () => {
  const parsed = parseAuthCallbackUrl(
    "tech.klui.app://auth/callback?code=pkce-code&access_token=must-not-leak&refresh_token=must-not-leak"
  );
  assert.deepEqual(parsed, { code: "pkce-code", error: "" });
  assert.equal("access_token" in parsed, false);
  assert.equal("refresh_token" in parsed, false);
});

test("native auth reports redirect configuration failures clearly", () => {
  const parsed = parseAuthCallbackUrl(
    "tech.klui.app://auth/callback?error=bad_oauth_state&error_description=redirect+URL+not+allowed"
  );
  assert.match(parsed.error, /tech\.klui\.app:\/\/auth\/callback/);
});

test("native OAuth asks Google to show account selection", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/platform/index.js", import.meta.url), "utf8")
  );
  assert.match(source, /prompt:\s*"select_account"/);
});

test("native OAuth keeps only the PKCE verifier in secure storage", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/platform/index.js", import.meta.url), "utf8")
  );
  assert.match(source, /key\.endsWith\("-code-verifier"\) \? storage\.get\(key\) : null/);
  assert.match(source, /storage:\s*pkceStorage/);
  assert.doesNotMatch(source, /storage:\s*\{\s*getItem:\s*\(key\) => preferences\.get/);
});

test("native OAuth ignores duplicate single-use callback URLs", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/platform/index.js", import.meta.url), "utf8")
  );
  assert.match(source, /const handledUrls = new Set\(\)/);
  assert.match(source, /if \(handledUrls\.has\(value\)\) return/);
});

test("native login renders the authenticated shell before loading account data", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  const handler = source.slice(
    source.indexOf("async function handleAuthenticatedSession"),
    source.indexOf("async function loadModels")
  );
  assert.ok(handler.indexOf("renderShell();") < handler.indexOf("await withTimeout(loadMe()"));
});

test("native startup focuses early only after an accessible chat is visible", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  const bootstrap = source.slice(
    source.indexOf("async function bootstrap()"),
    source.indexOf("/* ─── Event binding ─── */")
  );
  const focusPrompt = source.slice(
    source.indexOf("function focusPromptInput()"),
    source.indexOf("function focusPromptInputSoon()")
  );
  assert.equal((bootstrap.match(/focusPromptInputSoon\(\)/g) || []).length, 2);
  assert.ok(
    bootstrap.indexOf("if (!researchIdFromLocation()) focusPromptInputSoon();")
      < bootstrap.indexOf("await loadChatApp();")
  );
  assert.match(focusPrompt, /!state\.session \|\| !hasChatAccess\(\)/);
  assert.match(focusPrompt, /researchReportView\?\.classList\.contains\("hidden"\)/);
});

test("Capacitor mobile styling stays isolated from the website", async () => {
  const source = readStylesheet();
  assert.match(source, /body\.capacitor-native \.native-mobile-bar/);
  assert.match(source, /body\.capacitor-native \.composer/);
  assert.match(source, /\.native-mobile-bar,\s*\n\.native-nav-backdrop,\s*\n\.compact-new-chat \{\s*\n\s*display: none;/);
});

test("temporary chat label remains visible after messages exist", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  assert.match(source, /showTempToggle\s*=\s*onEmptyChat\s*\|\|\s*state\.temporaryChat/);
  assert.match(source, /temporaryChatToggle\?\.classList\.toggle\(\s*"hidden",\s*!showTempToggle\s*\)/);
  assert.match(source, /temporaryChatLabel\?\.classList\.toggle\("hidden", !state\.temporaryChat\)/);
});

test("completed streaming preserves the current message scroll position", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  const retryPath = source.slice(
    source.indexOf("async function retryFailedAssistant"),
    source.indexOf("async function executeSend")
  );
  const sendPath = source.slice(
    source.indexOf("async function executeSend"),
    source.indexOf("async function signOutAndReset")
  );
  for (const path of [retryPath, sendPath]) {
    assert.match(path, /const completedScrollTop = els\.messages\.scrollTop/);
    assert.match(path, /setAutoScroll\(false\)/);
    assert.match(path, /renderShell\(\);\s*setMessagesScrollTop\(completedScrollTop\)/);
  }
});

test("adding uploads preserves an existing composer draft", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  assert.match(source, /const draft = els\.promptInput\.value/);
  assert.match(source, /renderImages\(\);\s*els\.promptInput\.value = draft;\s*applyComposerHeight\(\)/);
});

test("document enrichment cannot reactivate the composer progress ring", async () => {
  const appJs = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );

  assert.match(appJs, /status: doc\.usable \? "ready" : "processing"/);
  assert.match(appJs, /progress: doc\.usable \? 100/);
  assert.match(appJs, /if \(doc\.usable\) \{[\s\S]*?forgetPendingDocument\(attachmentId\);[\s\S]*?return;/);
  assert.doesNotMatch(appJs, /img\.status !== "ready" \|\| img\.enriching/);
});

test("sent images can open in the existing lightbox", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/render.js", import.meta.url), "utf8")
  );
  assert.match(source, /class="message-image"[^>]+data-preview-src=/);
});

test("narrow browser layout uses a drawer header and unclipped model menu", async () => {
  const source = readStylesheet();
  assert.match(source, /@media \(max-width: 860px\)/);
  assert.match(source, /body\.sidebar-open \.native-nav-backdrop/);
  assert.match(source, /body\.sidebar-open \.sidebar-nav-label/);
  assert.match(source, /body\.sidebar-open \.conversation-row/);
  assert.match(source, /\.composer-model-dropdown \{\s*\n\s*width: min\(280px, calc\(100vw - 24px\)\)/);
});

test("narrow browser temporary chat controls avoid the mobile header controls", async () => {
  const source = readStylesheet();
  assert.match(source, /\.temporary-chat-bar \{\s*\n\s*top: 64px;\s*\n\s*right: 14px;\s*\n\s*left: 64px;/);
  assert.match(source, /\.temporary-chat-label \{[\s\S]*max-width: min\(220px, calc\(100vw - 152px\)\)/);
});

test("desktop browser shows the temporary chat icon without mobile controls", async () => {
  const source = readStylesheet();
  assert.match(source, /body:not\(\.capacitor-native\) \.native-mobile-bar \{[\s\S]*display: block;[\s\S]*height: 0;/);
  assert.match(source, /body:not\(\.capacitor-native\) \.native-mobile-mode-wrap,[\s\S]*body:not\(\.capacitor-native\) \.compact-new-chat \{[\s\S]*display: none !important;/);
  assert.match(source, /body:not\(\.capacitor-native\) \.temporary-chat-toggle \{[\s\S]*display: inline-flex;[\s\S]*pointer-events: auto;/);
});

test("Doodle composer chrome stays transparent around the input", async () => {
  const source = readStylesheet();
  assert.match(source, /body\[data-chat-theme="doodle"\] \.composer-area \{[\s\S]*background: transparent !important;[\s\S]*backdrop-filter: none;[\s\S]*box-shadow: none;/);
  assert.match(source, /body\[data-chat-theme="doodle"\] \.composer-wrap \{[\s\S]*background: transparent !important;[\s\S]*box-shadow: none;/);
});

test("secure storage wrapper is not thenable", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/platform/index.js", import.meta.url), "utf8")
  );
  // Must wrap the raw plugin to avoid Promise.then assimilation on Android.
  assert.match(source, /secureStorageInstance\s*=\s*\{/);
  assert.match(source, /SecureStorage\.get\.bind\(SecureStorage\)/);
  // Must not return the raw plugin object which is thenable.
  assert.doesNotMatch(source, /async function secureStorage\(\)[\s\S]*?^return SecureStorage;/m);
  // Storage methods must resolve the wrapper before accessing plugin methods.
  assert.doesNotMatch(source, /await \(await secureStorage\(\)\)\./);
  assert.match(source, /const store = await secureStorage\(\);/);
});

test("secure storage wrapper avoids thenable Promise assimilation behavior", async () => {
  // Simulate the Capacitor SecureStorage plugin: has a `then` property,
  // making it a thenable that breaks Promise resolution on Android.
  const mockPlugin = {
    get: async (k) => `value-${k}`,
    set: async (k, v) => undefined,
    remove: async (k) => undefined,
    then: "not-implemented-on-android"
  };

  // Duplicate the wrapper pattern from platform/index.js.
  let instance = null;
  async function getStorage() {
    if (instance) return instance;
    instance = {
      get: mockPlugin.get.bind(mockPlugin),
      set: mockPlugin.set.bind(mockPlugin),
      remove: mockPlugin.remove.bind(mockPlugin)
    };
    return instance;
  }

  const store = await getStorage();
  assert.equal(typeof store.then, "undefined", "wrapper must not expose a then property");
  assert.equal(typeof store.get, "function");
  assert.equal(typeof store.set, "function");
  assert.equal(typeof store.remove, "function");
  assert.equal(await store.get("key"), "value-key");

  // Verify the cached instance is reused.
  const prev = instance;
  const again = await getStorage();
  assert.equal(again, prev);
});

test("APK updates compare integer version codes", () => {
  assert.equal(compareVersionCodes("1", 2), 1);
  assert.equal(compareVersionCodes("2", 2), 0);
  assert.equal(compareVersionCodes("3", 2), -1);
  assert.equal(compareVersionCodes("invalid", 2), 0);
});

test("APK publishing refuses unsigned release artifacts", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/mobile/publish-release.mjs", "app-release-unsigned.apk", "1.0.0", "1"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to publish an unsigned APK/);
});

test("service worker excludes APIs and only caches the public shell", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/service-worker.js", import.meta.url), "utf8")
  );
  assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(source, /request\.mode === "navigate"/);
  assert.doesNotMatch(source, /^\s*"\/",?$/m);
  assert.doesNotMatch(source, /cache\.put\(/);
});

test("capacitor composer has an opaque background using defined CSS variables", async () => {
  const source = readStylesheet();
  // The composer must use a defined variable (--bg, --bg-secondary, --surface etc.)
  // and must NOT use var(--surface) which is never defined in the stylesheet.
  const match = source.match(/body\.capacitor-native \.composer\s*\{[\s\S]*?background:\s*([^;}]+)/);
  assert.ok(match, "capacitor-native .composer must have a background declaration");
  const bgValue = match[1].trim();
  assert.doesNotMatch(bgValue, /var\(--surface\)/, "composer background must not use undefined var(--surface)");
  assert.ok(
    bgValue.startsWith("var(--bg)") || bgValue.startsWith("var(--bg-secondary)"),
    `composer background should reference a defined variable, got: ${bgValue}`
  );
});

test("capacitor empty-state has no logo icon above the heading", async () => {
  const source = readStylesheet();
  // The ::before pseudo-element that showed the Klui icon must be removed.
  assert.doesNotMatch(
    source,
    /body\.capacitor-native\.chat-empty \.empty-state h1::before/,
    "empty-state h1 must not have a ::before pseudo-element on capacitor"
  );
  // The heading should not use display: grid with gap (which held the icon + text).
  const h1Rule = source.match(/body\.capacitor-native\.chat-empty \.empty-state h1\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(h1Rule, "empty-state h1 capacitor rule should exist");
  assert.doesNotMatch(
    h1Rule,
    /display:\s*grid/,
    "empty-state h1 should not use display: grid"
  );
});

test("capacitor + action menu uses position fixed to avoid overflow clipping", async () => {
  const source = readStylesheet();
  // The action menu inside capacitor-native must use position: fixed
  // so it isn't clipped by .chat-panel's overflow: hidden.
  assert.match(
    source,
    /body\.capacitor-native \.composer-action-menu\s*\{[\s\S]*?position:\s*fixed/,
    "composer-action-menu should use position: fixed on capacitor"
  );
});

test("camera file input exists with capture=environment", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/index.html", import.meta.url), "utf8")
  );
  assert.match(source, /capture="environment"/, "camera input must have capture=environment");
  assert.match(source, /id="cameraFileInput"/, "camera file input must exist in HTML");
});

test("camera action button exists in the + menu", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/index.html", import.meta.url), "utf8")
  );
  assert.match(source, /class="composer-action-menu-item mobile-camera-action hidden"[^>]+id="cameraAction"/, "camera action button must be hidden by default");
  assert.match(source, /Take photo/, "camera action button must have label 'Take photo'");
});

test("camera action is only shown inside the Capacitor mobile app", async () => {
  const source = readStylesheet();
  assert.match(source, /body\.capacitor-native \.mobile-camera-action\.hidden\s*\{[\s\S]*?display:\s*flex\s*!important/);
});

test("camera button and input are wired in app.js", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  assert.match(source, /cameraAction/, "cameraAction must be referenced in app.js");
  assert.match(source, /cameraFileInput/, "cameraFileInput must be referenced in app.js");
  // The click handler on cameraAction must exist.
  assert.match(
    source,
    /els\.cameraAction\?\.addEventListener\("click"/,
    "cameraAction must have a click event listener"
  );
  // The change handler on cameraFileInput must exist.
  assert.match(
    source,
    /els\.cameraFileInput\?\.addEventListener\("change"/,
    "cameraFileInput must have a change event listener"
  );
});

test("capacitor messages have enough bottom padding to clear the composer", async () => {
  const source = readStylesheet();
  assert.match(
    source,
    /body\.capacitor-native \.messages\s*\{[\s\S]*?padding-bottom:\s*200px/,
    "capacitor messages bottom padding should be 200px to clear the composer"
  );
});

test("capacitor native backdrop z-index sits below the sidebar when sidebar is open", async () => {
  const source = readStylesheet();
  // Sidebar in capacitor-native is at z-index: 80.
  // The backdrop uses z-index: 79 so it stays behind the sidebar.
  assert.match(source, /body\.capacitor-native\.sidebar-open \.native-nav-backdrop\s*\{[\s\S]*z-index:\s*79/);
  assert.match(source, /body\.capacitor-native\.sidebar-open \.sidebar\s*\{[\s\S]*z-index:\s*80/);
});

test("profile menu handlers close the mobile sidebar before opening drawers", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  // openSettings, openAdminDrawer, and openUpgradePlans all close the
  // mobile sidebar so that settings / account / upgrade views appear
  // above the chat content instead of behind the open sidebar.
  assert.match(source, /function openSettings\(\) \{[^}]*document\.body\.classList\.remove\("sidebar-open"\)/);
  assert.match(source, /function openAdminDrawer\(\) \{[^}]*document\.body\.classList\.remove\("sidebar-open"\)/);
  assert.match(source, /function openUpgradePlans\(\) \{[^}]*document\.body\.classList\.remove\("sidebar-open"\)/);
});

test("capacitor native sidebar overflow does not clip conversation menus when open", async () => {
  const source = readStylesheet();
  // The closed sidebar keeps overflow: hidden to prevent content leak during
  // slide-out animation; the open sidebar must use overflow: visible so
  // absolutely-positioned conversation menus are not clipped.
  assert.match(source, /body\.capacitor-native\.sidebar-open \.sidebar\s*\{[\s\S]*?overflow:\s*visible/);
});

test("capacitor conversation menu z-index sits above the native nav backdrop", async () => {
  const source = readStylesheet();
  // The sidebar (z-index: 80) wraps the menu (z-index: 40 in its own stacking
  // context), so the menu renders above the backdrop (z-index: 79). Verify the
  // sidebar itself is always above the backdrop.
  assert.match(source, /body\.capacitor-native\.sidebar-open \.native-nav-backdrop\s*\{[\s\S]*?z-index:\s*79/);
  assert.match(source, /body\.capacitor-native\.sidebar-open \.sidebar\s*\{[\s\S]*?z-index:\s*80/);
});

test("openConversation closes the mobile sidebar", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  assert.match(source, /async function openConversation[\s\S]*?document\.body\.classList\.remove\("sidebar-open"\)/);
});

test("sidebar-mid button clicks do not aggressively close the sidebar before handlers run", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  // The old aggressive handler closed the sidebar on any button click inside
  // sidebar-mid, which ran before handleConversationListClick, causing the
  // three-dot menu to appear in an invisible sidebar. Verify it was removed.
  assert.doesNotMatch(source, /sidebarMid\?\.addEventListener\("click",\s*\(event\)\s*=>\s*\{[\s\S]*?event\.target\.closest\("button"\)[\s\S]*?classList\.remove\("sidebar-open"\)/);
});

test("native sidebar login starts Google OAuth instead of opening auth behind the sidebar", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  assert.match(source, /signInWithGoogle as nativeSignInWithGoogle/);
  assert.match(source, /function startSidebarLogin\(\) \{[\s\S]*?if \(!isNative\(\)\) \{[\s\S]*?openAuthDialog\(\);[\s\S]*?return;[\s\S]*?document\.body\.classList\.remove\("sidebar-open"\);[\s\S]*?nativeSignInWithGoogle\(state\.config\)/);
  assert.match(source, /els\.guestLoginButton\.addEventListener\("click", startSidebarLogin\)/);
  assert.doesNotMatch(source, /els\.guestLoginButton\.addEventListener\("click", openAuthDialog\)/);
});

test("capacitor doodle theme keeps temporary chat toggle aligned to native header", async () => {
  const source = readStylesheet();
  // The mobile website doodle breakpoint moves the temporary chat bar below
  // the topbar. Native rules appear later and must win so the icon stays in
  // the same header position as every other theme.
  assert.match(source, /body\.capacitor-native \.chat-panel > \.temporary-chat-bar\s*\{[\s\S]*?top:\s*calc\(var\(--safe-area-inset-top, env\(safe-area-inset-top\)\) \+ 8px\);[\s\S]*?right:\s*18px;[\s\S]*?left:\s*auto/);
});

test("capacitor pinned popup is clamped inside the open sidebar", async () => {
  const source = readStylesheet();
  assert.match(source, /body\.capacitor-native\.sidebar-open \.pinned-popup\s*\{[\s\S]*?left:\s*0;[\s\S]*?top:\s*calc\(100% \+ 6px\);[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%/);
});

test("capacitor native suppresses web tap highlight while preserving text entry selection", async () => {
  const source = readStylesheet();
  assert.match(source, /body\.capacitor-native\s*\{[\s\S]*?-webkit-tap-highlight-color:\s*transparent;[\s\S]*?-webkit-touch-callout:\s*none/);
  assert.match(source, /body\.capacitor-native \*,\s*body\.capacitor-native \*::before,\s*body\.capacitor-native \*::after\s*\{[\s\S]*?-webkit-tap-highlight-color:\s*transparent/);
  assert.match(source, /body\.capacitor-native button,[\s\S]*?body\.capacitor-native \[role="button"\],[\s\S]*?user-select:\s*none/);
  assert.match(source, /body\.capacitor-native textarea,[\s\S]*?body\.capacitor-native input,[\s\S]*?user-select:\s*text/);
});

test("native sidebar rename and delete actions close drawer before opening dialogs", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );

  assert.match(
    source,
    /function openConfirmDialog\(conversation\) \{[\s\S]*?closeConversationMenus\(\);[\s\S]*?closePinnedPopup\(\);[\s\S]*?closeProfileMenu\(\);[\s\S]*?if \(isNative\(\)\) document\.body\.classList\.remove\("sidebar-open"\);[\s\S]*?els\.confirmDialog\.classList\.add\("open"\);/,
    "delete confirmation should not open underneath the native sidebar"
  );
  assert.match(
    source,
    /function openRenameDialog\(conversation\) \{[\s\S]*?closeConversationMenus\(\);[\s\S]*?closePinnedPopup\(\);[\s\S]*?closeProfileMenu\(\);[\s\S]*?if \(isNative\(\)\) document\.body\.classList\.remove\("sidebar-open"\);[\s\S]*?els\.renameDialog\.classList\.add\("open"\);/,
    "rename dialog should not open underneath the native sidebar"
  );
});


test("native top bar blends with system bars and has no bottom border", async () => {
  const source = readStylesheet();
  assert.match(
    source,
    /body\.capacitor-native \.native-mobile-bar\s*\{[\s\S]*?background:\s*var\(--bg\);[\s\S]*?border-bottom:\s*0;[\s\S]*?box-shadow:\s*none;/
  );
});

test("native top bar inlines the temporary-chat toggle and hides the standalone wrapper", async () => {
  const html = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/index.html", import.meta.url), "utf8")
  );
  const css = readStylesheet();
  // The toggle button is now a child of .native-mobile-bar on native.
  assert.match(
    html,
    /<header[^>]*class="native-mobile-bar"[^>]*>[\s\S]*?id="temporaryChatToggle"[\s\S]*?<\/header>/
  );
  // Standalone .temporary-chat-bar wrapper must be hidden on native.
  assert.match(css, /body\.capacitor-native \.temporary-chat-bar\s*\{[\s\S]*?display:\s*none/);
});

test("native temporary-chat toggle clears its own pressed highlight on press", async () => {
  const js = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
  );
  // pointerdown adds .pressed; the click handler synchronously removes
  // it so the press feedback never lingers (the user noticed the ring
  // staying after toggling off).
  assert.match(js, /temporaryChatToggle\?\.addEventListener\("pointerdown"/);
  assert.match(js, /temporaryChatToggle\?\.addEventListener\("click"[\s\S]*?classList\.remove\("pressed"\)/);
  assert.match(js, /addEventListener\("pointercancel"[\s\S]*?classList\.remove\("pressed"\)/);
});

test("native composer hides model and compare chips so only plus and send remain", async () => {
  const css = readStylesheet();
  // The composer model + compare chips must be hidden on the APK so only
  // the + and send buttons remain. The rule uses a compound selector
  // (.composer-bottom .composer-actions > ...) and a combined form
  // (multiple selectors in one rule), but the behaviour is the same.
  const composerChipRule = /body\.capacitor-native[\s\S]*?\.composer-(?:model|compare)-wrap[\s\S]*?display:\s*none\s*!important/;
  assert.match(css, composerChipRule, "composer model/compare chips should be hidden on the APK");
});

test("settings has an APK-only text size slider that is hidden on the web", async () => {
  const readFile = (await import("node:fs/promises")).readFile;
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const css = readStylesheet();
  const js = await readFile(new URL("../public/js/app.js", import.meta.url), "utf8");
  const java = await readFile(
    new URL("../android/app/src/main/java/tech/klui/app/TextZoomPlugin.java", import.meta.url),
    "utf8"
  );

  // Markup: a range input, hidden by default like every other APK-only control.
  assert.match(
    html,
    /<section class="settings-section hidden" id="settingsTextScaleSection">[\s\S]*?<input type="range" id="textScaleInput"[^>]*min="85"[^>]*max="130"/,
    "text size slider should exist, hidden by default, with an 85-130 range"
  );

  // CSS: only revealed on the APK, same pattern as the camera action button.
  assert.match(
    css,
    /body\.capacitor-native #settingsTextScaleSection\.hidden\s*\{\s*display:\s*block\s*!important;/,
    "text size section should only be revealed on body.capacitor-native"
  );

  // JS: the value is clamped and applied through the native WebView text
  // zoom (font-size only, so it can't break fixed-height layout) rather
  // than a CSS-level page zoom.
  assert.match(js, /function clampTextScale\(value\)/);
  assert.match(js, /Math\.min\(130, Math\.max\(85, num\)\)/);
  assert.match(js, /function applyTextScale\(\)\s*\{\s*void setTextZoom\(clampTextScale\(state\.settings\.uiTextScale\)\)/);
  assert.match(js, /key === "uiTextScale"\) applyTextScale\(\)/);
  assert.match(java, /if \(percent < 85\) percent = 85;/);
  assert.match(java, /if \(percent > 130\) percent = 130;/);
});

test("native top-bar mode picker activates compare and council modes", async () => {
  const [appJs, compareJs, councilJs] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../public/js/compare.js", import.meta.url), "utf8")
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../public/js/council.js", import.meta.url), "utf8")
    )
  ]);
  assert.match(appJs, /function applyNativeTopBarMode\(mode\)/);
  assert.match(appJs, /mode === "compare"[\s\S]*?compareController\.activateCompareMode\(\)/);
  assert.match(appJs, /mode === "council"[\s\S]*?councilController\.activateCouncilMode\(\)/);
  assert.match(compareJs, /function activateCompareMode\(/);
  assert.match(councilJs, /function activateCouncilMode\(/);
  assert.match(appJs, /function currentNativeTopBarMode\(\)[\s\S]*?compareEnabled[\s\S]*?compareMode/);
  assert.match(appJs, /applyNativeTopBarMode\(mode\)/);
});

test("responsive web header hides APK-only controls that collide in narrow layouts", async () => {
  const css = readStylesheet();
  assert.match(
    css,
    /body:not\(\.capacitor-native\) \.native-mobile-mode-wrap[\s\S]*?display:\s*none\s*!important/
  );
  assert.match(
    css,
    /body:not\(\.capacitor-native\) \.compact-new-chat[\s\S]*?display:\s*none\s*!important/
  );
});

test("admin can switch between full reasoning and the simple thinking bar", async () => {
  const [html, js] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../public/index.html", import.meta.url), "utf8")
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
    )
  ]);
  assert.match(html, /id="settingsReasoningSection"[\s\S]*?id="showModelReasoningInput"/);
  assert.match(js, /showModelReasoning:\s*true/);
  assert.match(js, /isAdminUser\(\)\s*&&\s*state\.settings\.showModelReasoning[\s\S]*?renderReasoning/);
  assert.match(js, /showModelReasoningInput\?\.addEventListener\("change"[\s\S]*?renderMessages\(\)/);
});

test("desktop chat navigation stays out of mobile and tracks prompt position", async () => {
  const [html, js, css] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../public/index.html", import.meta.url), "utf8")
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../public/js/app.js", import.meta.url), "utf8")
    ),
    readStylesheet()
  ]);

  assert.match(html, /id="chatJumpBottom"[\s\S]*?id="chatPromptNav"|id="chatPromptNav"[\s\S]*?id="chatJumpBottom"/);
  assert.doesNotMatch(html, /chat-prompt-panel-title|Your prompts/);
  assert.match(js, /bottomDistance > 220/);
  assert.match(js, /requestAnimationFrame\([\s\S]*?updateChatScrollNavigation/);
  assert.match(js, /function scrollToChatPrompt\(messageId\)[\s\S]*?els\.messages\.scrollTo/);
  assert.match(css, /@media \(max-width: 900px\), \(hover: none\), \(pointer: coarse\)[\s\S]*?\.chat-prompt-nav \{ display: none !important; \}/);
  assert.match(css, /body\.capacitor-native \.chat-jump-bottom,[\s\S]*?body\.capacitor-native \.chat-prompt-nav \{ display: none !important; \}/);
  assert.match(css, /\.chat-prompt-nav \{[\s\S]*?right:\s*18px/);
  assert.match(css, /body\[data-chat-theme="cyber"\] \.chat-panel > \.chat-prompt-nav,[\s\S]*?body\[data-chat-theme="doodle"\] \.chat-panel > \.chat-prompt-nav \{[\s\S]*?position:\s*absolute;[\s\S]*?z-index:\s*12;/);
});

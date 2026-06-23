import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

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

test("Capacitor mobile styling stays isolated from the website", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/styles.css", import.meta.url), "utf8")
  );
  assert.match(source, /body\.capacitor-native \.native-mobile-bar/);
  assert.match(source, /body\.capacitor-native \.composer/);
  assert.match(source, /\.native-mobile-bar,\s*\n\.native-nav-backdrop \{\s*\n\s*display: none;/);
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

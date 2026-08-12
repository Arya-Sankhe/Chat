import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse as parseYaml } from "yaml";

import { requireDesktopUser } from "../server/auth/desktop.js";
import { loadConfig, validateRuntimeConfig } from "../server/config.js";
import { handleDesktopOAuthFacade } from "../server/routes/desktopOAuth.js";
import { API_DEPENDENCIES, desktopAuthContext } from "../server/routes/context.js";
import { desktopBetaAllowed, desktopChatReservationCredits, validatedChatBody } from "../server/routes/desktop.js";
import { createCrofaiUsageMeter } from "../server/saas/usageMeter.js";
import { validatedAudioDuration } from "../server/speech/audio.js";

function jwt(payload) {
  return `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.x`;
}

function responseRecorder() {
  return {
    status: 0, headers: {}, body: "",
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(value = "") { this.body += value; }
  };
}

function request(method, body = "") {
  return {
    method,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: new AbortController().signal,
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); }
  };
}

function desktopConfig() {
  return loadConfig({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    DESKTOP_OAUTH_ENABLED: "true",
    SUPABASE_OAUTH_DESKTOP_WINDOWS_CLIENT_ID: "provider-client"
  });
}

test("desktop tokens are accepted only for the configured hosted OAuth client", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "00000000-0000-4000-8000-000000000001", email: "user@klui.tech" }), { status: 200 });
  try {
    const config = desktopConfig();
    const user = await requireDesktopUser({
      headers: { authorization: `Bearer ${jwt({ client_id: "provider-client" })}` },
      signal: new AbortController().signal
    }, config);
    assert.equal(user.oauthClientId, "klui-desktop-windows");
    await assert.rejects(requireDesktopUser({
      headers: { authorization: `Bearer ${jwt({ client_id: "ordinary-web-client" })}` },
      signal: new AbortController().signal
    }, config), /desktop session/);
  } finally { globalThis.fetch = originalFetch; }
});

test("desktop authentication fails closed without an explicit identity mapping", async () => {
  const db = {
    async getAccountIdentity() { return null; },
    async getProfile() { throw new Error("profile lookup must not run"); }
  };
  const config = {
    [API_DEPENDENCIES]: {
      createDb: () => db,
      createR2: () => ({}),
      verifyDesktopUser: async () => ({
        id: "external-subject",
        email: "same-email-is-not-enough@klui.tech",
        identityProvider: "clerk",
        oauthClientId: "klui-desktop-windows"
      })
    }
  };
  await assert.rejects(desktopAuthContext({ signal: new AbortController().signal }, config), /not linked/);
});

test("OAuth facade validates PKCE and maps logical client ids without exposing provider fields", async () => {
  const config = desktopConfig();
  const authorize = new URL("https://klui.tech/oauth/desktop/authorize");
  authorize.search = new URLSearchParams({
    client_id: "klui-desktop-windows",
    redirect_uri: "tech.klui.anything.windows://oauth/callback",
    response_type: "code",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    state: "s".repeat(24)
  });
  const redirect = responseRecorder();
  await handleDesktopOAuthFacade(request("GET"), redirect, authorize, config);
  assert.equal(redirect.status, 302);
  const providerUrl = new URL(redirect.headers.location);
  assert.equal(providerUrl.searchParams.get("client_id"), "provider-client");
  assert.equal(providerUrl.searchParams.get("redirect_uri"), "tech.klui.anything.windows://oauth/callback");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const form = new URLSearchParams(options.body);
    assert.equal(form.get("client_id"), "provider-client");
    return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600, provider_extension: "hidden" }), { status: 201 });
  };
  try {
    const token = responseRecorder();
    const form = new URLSearchParams({
      grant_type: "authorization_code", client_id: "klui-desktop-windows",
      redirect_uri: "tech.klui.anything.windows://oauth/callback",
      code_verifier: "v".repeat(43), code: "code"
    }).toString();
    await handleDesktopOAuthFacade(request("POST", form), token, new URL("https://klui.tech/oauth/desktop/token"), config);
    assert.equal(token.status, 200);
    assert.deepEqual(JSON.parse(token.body), { access_token: "access", refresh_token: "refresh", expires_in: 3600, token_type: "Bearer" });
  } finally { globalThis.fetch = originalFetch; }
});

test("OAuth facade normalizes rotated refresh-token reuse to invalid_grant", async () => {
  const config = desktopConfig();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "provider_refresh_reused" }), { status: 400 });
  try {
    const token = responseRecorder();
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: "klui-desktop-windows",
      refresh_token: "rotated-refresh-token"
    }).toString();
    await handleDesktopOAuthFacade(request("POST", form), token, new URL("https://klui.tech/oauth/desktop/token"), config);
    assert.equal(token.status, 400);
    assert.equal(JSON.parse(token.body).error, "invalid_grant");
  } finally { globalThis.fetch = originalFetch; }
});

test("enforced metering fails fast without a positive LLM reservation ceiling", () => {
  assert.throws(
    () => validateRuntimeConfig(loadConfig({ API_USAGE_METERING_MODE: "enforce" })),
    /DESKTOP_CHAT_RESERVATION_CREDITS/
  );
  assert.doesNotThrow(() => validateRuntimeConfig(loadConfig({
    API_USAGE_METERING_MODE: "enforce",
    DESKTOP_CHAT_RESERVATION_CREDITS: "0.25"
  })));
  assert.throws(() => validateRuntimeConfig(loadConfig({
    API_USAGE_METERING_MODE: "enforce",
    DESKTOP_CHAT_RESERVATION_CREDITS: "0.20"
  })), /must be at least/);
  assert.throws(
    () => validateRuntimeConfig(loadConfig({ DESKTOP_CHAT_ENABLED: "true" })),
    /API_USAGE_METERING_MODE/
  );
  assert.throws(
    () => validateRuntimeConfig(loadConfig({
      DESKTOP_CHAT_ENABLED: "true",
      API_USAGE_METERING_MODE: "enforce",
      DESKTOP_CHAT_RESERVATION_CREDITS: "0.25"
    })),
    /DESKTOP_OAUTH_ENABLED/
  );
});

test("funded desktop features fail closed without a canonical account allowlist", () => {
  const accountId = "00000000-0000-4000-8000-000000000001";
  const base = {
    DESKTOP_OAUTH_ENABLED: "true",
    DESKTOP_CHAT_ENABLED: "true",
    API_USAGE_METERING_MODE: "enforce",
    DESKTOP_CHAT_RESERVATION_CREDITS: "0.25",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    SUPABASE_OAUTH_DESKTOP_WINDOWS_CLIENT_ID: "provider-client",
    OPENROUTER_API_KEY: "provider-key"
  };
  assert.throws(() => validateRuntimeConfig(loadConfig(base)), /DESKTOP_BETA_ACCOUNT_IDS/);
  assert.throws(() => validateRuntimeConfig(loadConfig({ ...base, DESKTOP_BETA_ACCOUNT_IDS: "user@example.com" })), /canonical account UUIDs/);
  assert.doesNotThrow(() => validateRuntimeConfig(loadConfig({ ...base, DESKTOP_BETA_ACCOUNT_IDS: accountId })));
  assert.equal(desktopBetaAllowed(loadConfig({ DESKTOP_BETA_ACCOUNT_IDS: accountId }), accountId), true);
  assert.equal(desktopBetaAllowed(loadConfig({ DESKTOP_BETA_ACCOUNT_IDS: accountId }), "00000000-0000-4000-8000-000000000002"), false);
  assert.equal(desktopBetaAllowed(loadConfig({ DESKTOP_BETA_ACCOUNT_IDS: "*" }), "any-account"), true);
});

test("desktop chat pins OpenRouter price ceilings and rejects oversized screenshots", () => {
  const config = loadConfig({ DESKTOP_CHAT_RESERVATION_CREDITS: "0.25" });
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(1, 16);
  png.writeUInt32BE(1, 20);
  const body = validatedChatBody({
    model: "klui-desktop-agent",
    stream: true,
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] }]
  }, config);
  assert.deepEqual(body.provider.max_price, { prompt: 0.2, completion: 1.2 });
  const developerBody = validatedChatBody({
    model: "klui-desktop-agent",
    stream: true,
    messages: [{ role: "developer", content: "Be helpful." }, { role: "user", content: "Hi" }]
  }, config);
  const reservation = desktopChatReservationCredits(developerBody, config);
  assert.ok(reservation > 0.009 && reservation < 0.02);

  png.writeUInt32BE(2561, 16);
  assert.throws(() => validatedChatBody({
    model: "klui-desktop-agent",
    stream: true,
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] }]
  }, config), /2560 pixels/);
});

test("enforced chat metering reserves, submits, and settles one idempotent request", async () => {
  const events = [];
  const db = {
    async reserveApiUsage(params) { events.push(["reserve", params]); return { allowed: true }; },
    async markApiUsageSubmitted(params) { events.push(["submitted", params]); },
    async settleApiUsage(params) { events.push(["settled", params]); },
    async releaseApiUsage(params) { events.push(["released", params]); }
  };
  const encoder = new TextEncoder();
  const meter = createCrofaiUsageMeter({
    db, userId: "user", subscription: { id: "sub", current_period_end: "2026-09-01T00:00:00Z" },
    plan: { id: "pro", monthlyApiCreditLimit: 25 }, meteringMode: "enforce",
    surface: "desktop_windows", oauthClientId: "klui-desktop-windows", reservationCredits: 0.25,
    streamChatCompletionFn: async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('data: {"id":"gen","choices":[],"usage":{"cost":0.01}}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
    }}))
  });
  const response = await meter.streamChatCompletion({ requestId: "00000000-0000-4000-8000-000000000001", providerId: "openrouter", body: { model: "fixed" } });
  await response.text();
  assert.deepEqual(events.map(([name]) => name), ["reserve", "submitted", "settled"]);
  assert.equal(events[0][1].surface, "desktop_windows");
  assert.equal(events[2][1].costCredits, 0.01);
});

test("a reservation ceiling violation trips the database-backed global kill switch", async () => {
  const originalError = console.error;
  console.error = () => {};
  const settings = [];
  const db = {
    async reserveApiUsage() { return { allowed: true }; },
    async markApiUsageSubmitted() {},
    async settleApiUsage() {},
    async releaseApiUsage() {},
    async upsertAppSetting(...args) { settings.push(args); }
  };
  const meter = createCrofaiUsageMeter({
    db, userId: "user", subscription: { id: "sub", current_period_end: "2026-09-01T00:00:00Z" },
    plan: { id: "pro", monthlyApiCreditLimit: 25 }, meteringMode: "enforce", reservationCredits: 0.25,
    chatCompletionFn: async ({ onResponsePayload }) => {
      onResponsePayload({ id: "generation", usage: { cost: 0.5 } });
      return { ok: true };
    }
  });
  try {
    await assert.rejects(meter.chatCompletion({ providerId: "openrouter", body: { model: "fixed" } }), /metering/);
    assert.equal(settings[0][0], "funded_inference_disabled");
    assert.equal(settings[0][1].disabled, true);
  } finally {
    console.error = originalError;
  }
});

test("missing provider usage settles the reservation ceiling conservatively", async () => {
  const settled = [];
  const db = {
    async reserveApiUsage() { return { allowed: true }; },
    async markApiUsageSubmitted() {},
    async settleApiUsage(params) { settled.push(params); },
    async releaseApiUsage() {}
  };
  const meter = createCrofaiUsageMeter({
    db, userId: "user", subscription: { id: "sub", current_period_end: "2026-09-01T00:00:00Z" },
    plan: { id: "pro", monthlyApiCreditLimit: 25 }, meteringMode: "enforce", reservationCredits: 0.25,
    streamChatCompletionFn: async () => new Response("data: [DONE]\n\n")
  });
  const response = await meter.streamChatCompletion({ requestId: "00000000-0000-4000-8000-000000000002", providerId: "openrouter", body: { model: "fixed" } });
  await response.text();
  assert.equal(settled[0].costCredits, 0.25);
  assert.equal(settled[0].estimated, true);
  assert.equal(settled[0].costSource, "reservation_ceiling");
});

test("an accepted stream is estimated instead of released when submission-state persistence fails", async () => {
  const events = [];
  const db = {
    async reserveApiUsage() { events.push("reserve"); return { allowed: true }; },
    async markApiUsageSubmitted() { events.push("submit-failed"); throw new Error("database unavailable"); },
    async settleApiUsage(params) { events.push(["settled", params]); },
    async releaseApiUsage() { events.push("released"); }
  };
  const meter = createCrofaiUsageMeter({
    db, userId: "user", subscription: { id: "sub", current_period_end: "2026-09-01T00:00:00Z" },
    plan: { id: "pro", monthlyApiCreditLimit: 25 }, meteringMode: "enforce", reservationCredits: 0.25,
    streamChatCompletionFn: async () => new Response("data: [DONE]\n\n")
  });
  await assert.rejects(meter.streamChatCompletion({ requestId: "00000000-0000-4000-8000-000000000003", providerId: "openrouter", body: { model: "fixed" } }), /database unavailable/);
  assert.deepEqual(events.map((event) => Array.isArray(event) ? event[0] : event), ["reserve", "submit-failed", "settled"]);
  assert.equal(events[2][1].costCredits, 0.25);
  assert.equal(events[2][1].estimated, true);
});

test("WAV duration is derived from the container and capped at thirty seconds", () => {
  const dataBytes = 16_000 * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  assert.equal(validatedAudioDuration(wav, "audio/wav"), 1);
});

test("the desktop repository pins the immutable website OpenAPI artifact", async () => {
  const yaml = await readFile(new URL("../docs/openapi/desktop-v1.2026-08-11.yaml", import.meta.url));
  const declaredHash = await readFile(new URL("../docs/openapi/desktop-v1.2026-08-11.sha256", import.meta.url), "utf8");
  const hash = createHash("sha256").update(yaml).digest("hex");
  assert.equal(hash, "976b40de9c5f664ff5badfa124893caefcc631bc764b8b175a0e4f1f27e73bb1");
  assert.equal(declaredHash.trim(), `${hash}  desktop-v1.2026-08-11.yaml`);
  const contract = parseYaml(yaml.toString("utf8"));
  assert.equal(contract.openapi, "3.1.0");
  assert.deepEqual(Object.keys(contract.paths).sort(), [
    "/api/desktop/v1/chat/completions",
    "/api/desktop/v1/logout",
    "/api/desktop/v1/me",
    "/api/desktop/v1/speech-to-text",
    "/oauth/desktop/authorize",
    "/oauth/desktop/token"
  ]);
});

test("every non-desktop LLM entry point passes enforce-mode settings to the shared meter", async () => {
  for (const path of ["../server/research/worker.js", "../server/routes/uploads.js"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /createCrofaiUsageMeter\(\{[\s\S]*?meteringMode: config\.desktop\.meteringMode,[\s\S]*?reservationCredits: config\.desktop\.chatReservationCredits[\s\S]*?\}\)/);
  }
});

test("the migration counts reservations and enforces the shared database kill switch", async () => {
  const source = await readFile(new URL("../supabase/migrations/20260811000000_desktop_auth_and_atomic_usage.sql", import.meta.url), "utf8");
  assert.match(source, /api_credit_used \+ v_row\.api_credit_reserved >= v_row\.api_credit_limit/);
  assert.match(source, /funded_inference_disabled/);
  assert.match(source, /usage_metering_disabled/);
  assert.match(source, /grant execute on function public\.klui_check_api_budget[\s\S]*?to service_role/);
  assert.match(source, /grant execute on function public\.klui_record_api_usage[\s\S]*?to service_role/);
});

test("the Windows beta explicitly disables the server-advertised computer-use capability", async () => {
  const source = await readFile(new URL("../server/routes/desktop.js", import.meta.url), "utf8");
  assert.match(source, /computerUse:\s*false/);
});

test("the Windows release publisher fails closed and keeps large installers outside Git", async () => {
  const publisher = await readFile(new URL("../scripts/desktop/publish-windows-release.ps1", import.meta.url), "utf8");
  const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(publisher, /SignatureStatus\]::Valid/);
  assert.match(publisher, /Version .* already published with different bytes/);
  assert.match(publisher, /Get-FileHash .* -Algorithm SHA256/);
  assert.match(publisher, /artifacts\\windows-release/);
  assert.match(compose, /WINDOWS_DOWNLOADS_DIR[^\n]+:\/app\/public\/downloads\/windows:ro/);
  assert.match(ignore, /^artifacts\/$/m);
});

test("the Windows download page keeps unsigned beta artifacts behind an unlisted token", async () => {
  const page = await readFile(new URL("../public/download/windows/index.html", import.meta.url), "utf8");
  assert.match(page, /\^\[a-f0-9\]\{32\}\$/);
  assert.match(page, /\/downloads\/windows\/private\/\$\{betaToken\}\/latest\.json/);
  assert.match(page, /release\.installerUrl\.startsWith\(privateInstallerPrefix\)/);
  assert.match(page, /This private beta is not code-signed yet/);
  assert.match(page, /'\/downloads\/windows\/latest\.json'/);
});

test("desktop consent stays friendly and leaves a reliable browser handoff fallback", async () => {
  const page = await readFile(new URL("../public/oauth/consent/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/oauth/consent/consent.js", import.meta.url), "utf8");
  assert.match(page, /home-valley\.webp/);
  assert.match(page, /Let’s get you into Klui/);
  assert.match(page, /<details>/);
  assert.doesNotMatch(page, /Authorize desktop|active plan and shared weekly allowance/);
  assert.match(script, /function handOffToDesktop/);
  assert.match(page, /id="openDesktop"/);
  assert.match(page, /Open Klui Anything/);
  assert.match(script, /openDesktop\.href = redirectUrl/);
  assert.match(script, /location\.assign\(redirectUrl\)/);
  assert.match(script, /Still here\? Use Open Klui Anything above\./);
  assert.doesNotMatch(page, /You’re all synced!/);
});

test("backend identity-sensitive RPCs are service-role only", async () => {
  const source = await readFile(new URL("../supabase/migrations/20260811185500_harden_backend_rpc_permissions.sql", import.meta.url), "utf8");
  for (const name of ["klui_search_document_chunks", "klui_search_document_pages", "smartyfy_consume_usage"]) {
    assert.match(source, new RegExp(`revoke execute on function public\\.${name}[^;]+from public, anon, authenticated`));
    assert.match(source, new RegExp(`grant execute on function public\\.${name}[^;]+to service_role`));
  }
});

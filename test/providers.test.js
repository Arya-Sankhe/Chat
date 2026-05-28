import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PROVIDER_ID,
  OPENROUTER_DEFAULT_MODEL,
  defaultModelForProvider,
  normalizeProviderId,
  providerAvailability,
  providerLabel,
  resolveProvider
} from "../server/providers.js";

test("normalizeProviderId accepts known aliases", () => {
  assert.equal(normalizeProviderId(undefined), DEFAULT_PROVIDER_ID);
  assert.equal(normalizeProviderId(""), DEFAULT_PROVIDER_ID);
  assert.equal(normalizeProviderId("klui"), "klui");
  assert.equal(normalizeProviderId("crof"), "klui");
  assert.equal(normalizeProviderId("CROFAI"), "klui");
  assert.equal(normalizeProviderId("openrouter"), "openrouter");
  assert.equal(normalizeProviderId("OpenRouter"), "openrouter");
  assert.equal(normalizeProviderId("open-router"), "openrouter");
});

test("normalizeProviderId rejects unknown providers", () => {
  assert.throws(() => normalizeProviderId("anthropic"), /Unknown model provider/);
});

test("defaultModelForProvider returns OpenRouter default when applicable", () => {
  assert.equal(defaultModelForProvider("openrouter"), OPENROUTER_DEFAULT_MODEL);
  assert.equal(defaultModelForProvider("klui"), "");
});

test("resolveProvider returns Klui credentials by default", () => {
  const config = {
    serverApiKey: "klui-key",
    defaultBaseUrl: "https://crof.ai/v1",
    providers: { openrouter: { apiKey: "" } }
  };
  const provider = resolveProvider(undefined, config);
  assert.equal(provider.id, "klui");
  assert.equal(provider.apiKey, "klui-key");
  assert.equal(provider.baseUrl, "https://crof.ai/v1");
  assert.equal(provider.label, "Klui");
});

test("resolveProvider returns OpenRouter credentials when requested and configured", () => {
  const config = {
    serverApiKey: "klui-key",
    defaultBaseUrl: "https://crof.ai/v1",
    providers: {
      openrouter: {
        apiKey: "or-key",
        baseUrl: "https://openrouter.ai/api/v1"
      }
    }
  };
  const provider = resolveProvider("openrouter", config);
  assert.equal(provider.id, "openrouter");
  assert.equal(provider.apiKey, "or-key");
  assert.equal(provider.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(provider.label, "OpenRouter");
});

test("resolveProvider falls back to default openrouter base url", () => {
  const config = {
    serverApiKey: "klui-key",
    defaultBaseUrl: "https://crof.ai/v1",
    providers: { openrouter: { apiKey: "or-key", baseUrl: "" } }
  };
  const provider = resolveProvider("openrouter", config);
  assert.equal(provider.baseUrl, "https://openrouter.ai/api/v1");
});

test("resolveProvider throws 503 when OpenRouter is requested but not configured", () => {
  const config = {
    serverApiKey: "klui-key",
    defaultBaseUrl: "https://crof.ai/v1",
    providers: { openrouter: { apiKey: "" } }
  };
  assert.throws(
    () => resolveProvider("openrouter", config),
    (error) => error.status === 503 && /OPENROUTER_API_KEY/.test(error.message)
  );
});

test("resolveProvider throws 503 when Klui is requested but not configured", () => {
  const config = {
    serverApiKey: "",
    defaultBaseUrl: "https://crof.ai/v1",
    providers: { openrouter: { apiKey: "or-key" } }
  };
  assert.throws(
    () => resolveProvider("klui", config),
    (error) => error.status === 503 && /Klui model API key/.test(error.message)
  );
});

test("resolveProvider rejects unknown providers with 400", () => {
  const config = {
    serverApiKey: "klui-key",
    defaultBaseUrl: "https://crof.ai/v1",
    providers: { openrouter: { apiKey: "or-key" } }
  };
  assert.throws(
    () => resolveProvider("anthropic", config),
    (error) => error.status === 400 && /Unknown model provider/.test(error.message)
  );
});

test("providerLabel handles known and unknown ids", () => {
  assert.equal(providerLabel("klui"), "Klui");
  assert.equal(providerLabel("openrouter"), "OpenRouter");
  assert.equal(providerLabel("custom"), "custom");
  assert.equal(providerLabel(""), "Klui");
});

test("providerAvailability reflects configured api keys", () => {
  assert.deepEqual(
    providerAvailability({
      serverApiKey: "klui-key",
      providers: { openrouter: { apiKey: "or-key" } }
    }),
    { klui: true, openrouter: true }
  );

  assert.deepEqual(
    providerAvailability({
      serverApiKey: "",
      providers: { openrouter: { apiKey: "" } }
    }),
    { klui: false, openrouter: false }
  );

  assert.deepEqual(
    providerAvailability({ serverApiKey: "klui-key" }),
    { klui: true, openrouter: false }
  );
});

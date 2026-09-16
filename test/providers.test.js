import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PROVIDER_ID, normalizeProviderId, resolveProvider } from "../server/providers.js";

test("OpenRouter is the only accepted model provider", () => {
  assert.equal(normalizeProviderId(undefined), DEFAULT_PROVIDER_ID);
  assert.equal(normalizeProviderId(""), DEFAULT_PROVIDER_ID);
  assert.equal(normalizeProviderId("OpenRouter"), "openrouter");
  assert.equal(normalizeProviderId("open-router"), "openrouter");
  assert.throws(() => normalizeProviderId("klui"), /Unknown model provider/);
  assert.throws(() => normalizeProviderId("legacy"), /Unknown model provider/);
});

test("resolveProvider returns configured OpenRouter credentials", () => {
  const provider = resolveProvider(undefined, {
    providers: { openrouter: { apiKey: "or-key", baseUrl: "https://openrouter.ai/api/v1" } }
  });
  assert.deepEqual(provider, {
    id: "openrouter",
    label: "OpenRouter",
    apiKey: "or-key",
    baseUrl: "https://openrouter.ai/api/v1"
  });
});

test("resolveProvider falls back to the standard OpenRouter URL", () => {
  const provider = resolveProvider("openrouter", {
    providers: { openrouter: { apiKey: "or-key", baseUrl: "" } }
  });
  assert.equal(provider.baseUrl, "https://openrouter.ai/api/v1");
});

test("resolveProvider fails cleanly when OpenRouter is not configured", () => {
  assert.throws(
    () => resolveProvider("openrouter", { providers: { openrouter: { apiKey: "" } } }),
    (error) => error.status === 503 && /OPENROUTER_API_KEY/.test(error.message)
  );
});

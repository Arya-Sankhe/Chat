import assert from "node:assert/strict";
import test from "node:test";

import { ALLOWED_CHAT_MODELS, DEFAULT_PROVIDER_ID, OPENROUTER_PRO_MODEL, OPENROUTER_TEXT_MODEL, OPENROUTER_VISION_MODEL, adaptChatRequestForProvider, normalizeProviderId, resolveProvider } from "../server/providers.js";
import { chatCompletion, imageGeneration, streamChatCompletion } from "../server/model-api/client.js";
import { loadConfig } from "../server/config.js";
import { resolveChatRole } from "../server/models.js";
import { transcribeAudio } from "../server/routes/speech.js";

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

test("only whitelisted product models and fallback IDs can reach paid model endpoints", async () => {
  assert.ok(ALLOWED_CHAT_MODELS.every((model) => !/sol/i.test(model)));
  for (const model of ALLOWED_CHAT_MODELS) assert.equal(adaptChatRequestForProvider({ model, messages: [] }, "openrouter").model, model);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Unexpected outbound request"); };
  try {
    await assert.rejects(chatCompletion({ body: { model: OPENROUTER_PRO_MODEL, models: "openai/gpt-6-sol" } }), /approved Klui model IDs/);
    for (const model of ["openai/gpt-6-sol", "openai/gpt-6.1-sol", "openai/gpt-5.5-sol", "vendor/new-model"]) {
      assert.throws(() => resolveChatRole({ model }), /not approved/);
      for (const body of [{ model }, { model: OPENROUTER_PRO_MODEL, models: [model] }]) {
        assert.throws(() => adaptChatRequestForProvider(body, "openrouter"), /not approved/);
        for (const call of [chatCompletion, streamChatCompletion]) await assert.rejects(call({ apiKey: "test", baseUrl: "https://example.test", providerId: "openrouter", body }), /not approved/);
      }
      await assert.rejects(imageGeneration({ apiKey: "test", baseUrl: "https://example.test", body: { model } }), /not approved/);
      await assert.rejects(transcribeAudio({}, Buffer.from("audio"), "audio/webm", undefined, model), /not approved/);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("environment settings cannot introduce custom models", () => {
  const env = Object.fromEntries(["DESKTOP_CHAT_MODEL", "VISION_DESCRIBE_MODEL", "CONTEXT_SUMMARY_MODEL", "DOCUMENT_DECK_MODEL", "DOCUMENT_DECK_AUDIT_MODEL", "DOCUMENT_VISUAL_EMBED_MODEL", "DOCUMENT_RERANK_MODEL", "RESEARCH_CHEAP_MODEL", "STUDY_VISION_MODEL"].map((key) => [key, "openai/gpt-6-sol"]));
  const config = loadConfig(env);
  assert.equal(config.desktop.model, OPENROUTER_PRO_MODEL);
  assert.equal(config.context.summaryModel, OPENROUTER_TEXT_MODEL);
  assert.equal(config.research.cheapModel, OPENROUTER_TEXT_MODEL);
  assert.equal(config.study.visionModel, OPENROUTER_VISION_MODEL);
  assert.equal(config.documents.visualEmbedModel, "jina-embeddings-v5-omni-nano");
  assert.equal(config.documents.rerankModel, "jina-reranker-v3");
  assert.equal(config.documents.deckModel, undefined);
  assert.equal(config.documents.deckAuditModel, undefined);
  assert.equal(config.visionDescribeModel, undefined);
});

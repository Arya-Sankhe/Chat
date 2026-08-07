import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBaseUrl } from "../server/crofai/constants.js";
import { normalizeChatRequest } from "../server/crofai/normalize.js";

test("normalizeBaseUrl accepts provider endpoints", () => {
  assert.equal(normalizeBaseUrl("https://crof.ai/v1/"), "https://crof.ai/v1");
  assert.equal(normalizeBaseUrl("https://crof.ai/v2"), "https://crof.ai/v2");
});

test("normalizeBaseUrl rejects non-provider endpoints", () => {
  assert.throws(() => normalizeBaseUrl("https://example.com/v1"), /Only Klui API/);
});

test("normalizeChatRequest keeps only supported chat fields", () => {
  const payload = normalizeChatRequest({
    model: "deepseek-v3.2",
    messages: [{ role: "user", content: "Hello" }],
    temperature: "0.4",
    top_p: "1",
    max_tokens: "512",
    seed: "10",
    stop: ["END"],
    tools: [{ type: "function", function: { name: "demo" } }],
    extra: "ignored"
  });

  assert.deepEqual(payload, {
    model: "deepseek-v3.2",
    messages: [{ role: "user", content: "Hello" }],
    stream: true,
    max_tokens: 512,
    temperature: 0.4,
    top_p: 1,
    seed: 10,
    stop: ["END"],
    tools: [{ type: "function", function: { name: "demo" } }]
  });
});

test("normalizeChatRequest upgrades the model used by older Android builds", () => {
  const payload = normalizeChatRequest({
    model: "deepseek/deepseek-v4-flash",
    messages: [{ role: "user", content: "Hello" }]
  });

  assert.equal(payload.model, "deepseek/deepseek-v4-flash-0731");
});

test("normalizeChatRequest upgrades the former Nitro model used by older Android builds", () => {
  const payload = normalizeChatRequest({
    model: "poolside/laguna-xs-2.1",
    messages: [{ role: "user", content: "Hello" }]
  });

  assert.equal(payload.model, "inclusionai/ling-3.0-flash");
});

test("normalizeChatRequest upgrades the former Council model used by older Android builds", () => {
  const payload = normalizeChatRequest({
    model: "deepseek/deepseek-v4-pro",
    messages: [{ role: "user", content: "Hello" }]
  });

  assert.equal(payload.model, "tencent/hy3");
});

test("normalizeChatRequest supports vision content", () => {
  const payload = normalizeChatRequest({
    model: "kimi-k2.5",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image_url", image_url: { url: "https://files.nahcrof.com/file/crofai-black.png", detail: "HIGH" } }
        ]
      }
    ]
  });

  assert.equal(payload.messages[0].content[1].image_url.url, "https://files.nahcrof.com/file/crofai-black.png");
  assert.equal(payload.messages[0].content[1].image_url.detail, "high");
});

test("normalizeChatRequest supports uploaded image data URLs", () => {
  const payload = normalizeChatRequest({
    model: "kimi-k2.5",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }
        ]
      }
    ]
  });

  assert.equal(payload.messages[0].content[1].image_url.url, "data:image/png;base64,iVBORw0KGgo=");
});

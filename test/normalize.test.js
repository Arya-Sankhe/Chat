import assert from "node:assert/strict";
import test from "node:test";
import { normalizeChatRequest } from "../server/model-api/normalize.js";

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

test("normalizeChatRequest supports vision content", () => {
  const payload = normalizeChatRequest({
    model: "kimi-k2.5",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image_url", image_url: { url: "https://files.example.test/image.png", detail: "HIGH" } }
        ]
      }
    ]
  });

  assert.equal(payload.messages[0].content[1].image_url.url, "https://files.example.test/image.png");
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

test("normalizeChatRequest maps reasoning effort max to xhigh", () => {
  const payload = normalizeChatRequest({
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "max"
  });
  assert.equal(payload.reasoning_effort, "xhigh");
});

test("normalizeChatRequest rejects empty messages", () => {
  assert.throws(
    () => normalizeChatRequest({ model: "m", messages: [] }),
    (error) => error.status === 400 && /non-empty array/.test(error.message)
  );
});

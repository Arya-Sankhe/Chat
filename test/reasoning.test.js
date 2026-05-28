import assert from "node:assert/strict";
import test from "node:test";

import { adaptChatRequestForProvider } from "../server/providers.js";
import { applyStreamEvent } from "../server/saas/messages.js";
import { extractReasoningDelta } from "../server/saas/reasoning.js";

test("extractReasoningDelta reads Klui reasoning_content", () => {
  assert.equal(extractReasoningDelta({ reasoning_content: "step one" }), "step one");
});

test("extractReasoningDelta reads OpenRouter reasoning string", () => {
  assert.equal(extractReasoningDelta({ reasoning: "thinking aloud" }), "thinking aloud");
});

test("extractReasoningDelta concatenates OpenRouter reasoning_details text chunks", () => {
  const delta = {
    reasoning_details: [
      { type: "reasoning.text", text: "First " },
      { type: "reasoning.text", text: "second" },
      { type: "reasoning.summary", summary: " (summary)" }
    ]
  };
  assert.equal(extractReasoningDelta(delta), "First second (summary)");
});

test("extractReasoningDelta ignores encrypted reasoning details", () => {
  const delta = {
    reasoning_details: [{ type: "reasoning.encrypted", data: "abc" }]
  };
  assert.equal(extractReasoningDelta(delta), "");
});

test("adaptChatRequestForProvider maps reasoning_effort to OpenRouter reasoning", () => {
  const adapted = adaptChatRequestForProvider({
    model: "xiaomi/mimo-v2.5",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "high",
    temperature: 0.7
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { effort: "high", exclude: false });
  assert.equal(adapted.reasoning_effort, undefined);
  assert.equal(adapted.temperature, 0.7);
});

test("adaptChatRequestForProvider leaves Klui requests unchanged", () => {
  const body = {
    model: "greg",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "medium"
  };
  assert.equal(adaptChatRequestForProvider(body, "klui"), body);
});

test("applyStreamEvent accumulates OpenRouter reasoning_details into message.reasoning", () => {
  const message = { content: "", reasoning: "", toolCalls: [], finishReason: "" };

  applyStreamEvent(message, {
    choices: [{
      delta: {
        reasoning_details: [{ type: "reasoning.text", text: "Let me think..." }]
      }
    }]
  });

  assert.equal(message.reasoning, "Let me think...");
});

test("applyStreamEvent still accumulates reasoning_content for Klui streams", () => {
  const message = { content: "", reasoning: "", toolCalls: [], finishReason: "" };

  applyStreamEvent(message, {
    choices: [{ delta: { reasoning_content: "legacy reasoning" } }]
  });

  assert.equal(message.reasoning, "legacy reasoning");
});

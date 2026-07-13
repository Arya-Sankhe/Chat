import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStreamEvent,
  normalizeUsage,
  pipeProviderStreamAndAccumulate
} from "../server/saas/messages.js";

test("normalizeUsage maps OpenAI/OpenRouter usage fields", () => {
  assert.deepEqual(
    normalizeUsage({
      prompt_tokens: 1200,
      completion_tokens: 800,
      total_tokens: 2000,
      cost: 0.00042,
      completion_tokens_details: { reasoning_tokens: 300 }
    }),
    { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, totalTokens: 2000, costCredits: 0.00042 }
  );
});

test("normalizeUsage derives total when only prompt/completion are present", () => {
  assert.deepEqual(
    normalizeUsage({ prompt_tokens: 100, completion_tokens: 50 }),
    { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
  );
});

test("normalizeUsage ignores empty or invalid payloads", () => {
  assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage({}), null);
  assert.equal(normalizeUsage({ prompt_tokens: -5 }), null);
});

test("applyStreamEvent captures the trailing usage chunk with empty choices", () => {
  const message = { content: "", reasoning: "", toolCalls: [], finishReason: "", usage: null };
  applyStreamEvent(message, { choices: [{ delta: { content: "Hi" } }] });
  applyStreamEvent(message, {
    choices: [],
    usage: { prompt_tokens: 4000, completion_tokens: 1000, total_tokens: 5000 }
  });

  assert.equal(message.content, "Hi");
  assert.deepEqual(message.usage, {
    promptTokens: 4000,
    completionTokens: 1000,
    totalTokens: 5000
  });
});

test("provider streaming finishes after the browser response disconnects", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Still "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"working"},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n'
  ];
  const upstream = {
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      }
    })
  };
  const disconnectedResponse = {
    destroyed: true,
    writableEnded: false,
    write() {
      assert.fail("a disconnected response must not be written to");
    }
  };

  const result = await pipeProviderStreamAndAccumulate(upstream, disconnectedResponse);

  assert.equal(result.content, "Still working");
  assert.equal(result.finishReason, "stop");
});

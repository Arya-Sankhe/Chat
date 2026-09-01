import assert from "node:assert/strict";
import test from "node:test";

import { ensureVisualizeResponse, findVisualizeError } from "../server/chat/single.js";

const fence = (html) => `\`\`\`visualize\n${html}\n\`\`\``;

test("visualize validation rejects extra fences and oversized documents", () => {
  const valid = fence("<!doctype html><html><body>Ready</body></html>");
  assert.equal(findVisualizeError(valid), "");
  assert.match(findVisualizeError(`${valid}\n${valid}`), /exactly one/);
  assert.match(findVisualizeError(fence(`<html><body>${"x".repeat(121 * 1024)}</body></html>`)), /120 KiB/);
});

test("visualize repair propagates a user abort without resetting or retrying", async () => {
  const controller = new AbortController();
  let resets = 0;
  const crofai = {
    async chatCompletion() {
      controller.abort();
      throw new DOMException("Stopped", "AbortError");
    },
    async streamChatCompletion() {
      assert.fail("full repair must not start after abort");
    }
  };
  await assert.rejects(ensureVisualizeResponse({
    required: true,
    result: { accumulated: { content: fence('<html><body><script src="https://cdn.example/widget.js"></script></body></html>') } },
    chatRequest: { messages: [] },
    crofai,
    config: { serverApiKey: "key", defaultBaseUrl: "https://example.test" },
    provider: null,
    signal: controller.signal,
    res: {},
    onReset: () => { resets += 1; }
  }), { name: "AbortError" });
  assert.equal(resets, 0);
});

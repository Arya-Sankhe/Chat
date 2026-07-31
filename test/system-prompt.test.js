import assert from "node:assert/strict";
import test from "node:test";
import { withModelSystemPrompt } from "../server/saas/systemPrompt.js";

test("Luna receives its conversation style in the same system prompt", () => {
  const prompt = withModelSystemPrompt("Base prompt", "openai/gpt-5.6-luna");

  assert.match(prompt, /^Base prompt\n\nConversation style for this model:/);
  assert.match(prompt, /prefer 2–5 natural sentences/);
  assert.equal(withModelSystemPrompt("Base prompt", "another-model"), "Base prompt");
});

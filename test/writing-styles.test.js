import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWritingStyle, withWritingStyleSystemPrompt } from "../server/saas/writingStyles.js";

test("writing styles use a fixed allowlist and Normal is a no-op", () => {
  assert.equal(normalizeWritingStyle("CONCISE"), "concise");
  assert.equal(normalizeWritingStyle("not-a-style"), "normal");
  assert.equal(withWritingStyleSystemPrompt("Base prompt", "normal"), "Base prompt");
  assert.equal(withWritingStyleSystemPrompt("Base prompt", "unknown"), "Base prompt");
});

test("each writing style adds a distinct server-side skill instruction", () => {
  const styles = ["learning", "concise", "explanatory", "formal", "literary-storyteller"];
  const prompts = styles.map((style) => withWritingStyleSystemPrompt("Base prompt", style));

  for (const [index, prompt] of prompts.entries()) {
    assert.match(prompt, /^Base prompt\n\nWriting style skill/);
    assert.match(prompt, new RegExp(`\\(${styles[index]}\\)`));
    assert.match(prompt, /Do not mention the preset/);
  }
  assert.equal(new Set(prompts).size, styles.length);
});

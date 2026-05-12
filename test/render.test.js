import assert from "node:assert/strict";
import test from "node:test";
import {
  compactModelDisplayName,
  formatModelMeta,
  inferModelBadges,
  normalizeModelList
} from "../public/js/render.js";

test("normalizeModelList accepts OpenAI-compatible model list payloads", () => {
  const models = normalizeModelList({
    object: "list",
    data: [
      {
        id: "deepseek-v3.2",
        context_length: 163840,
        max_completion_tokens: 163840,
        name: "DeepSeek: DeepSeek V3.2",
        pricing: { prompt: "0.00000028", completion: "0.00000038" },
        quantization: "Q4_0",
        speed: 50
      }
    ]
  });

  assert.equal(models[0].id, "deepseek-v3.2");
  assert.equal(models[0].name, "DeepSeek: DeepSeek V3.2");
});

test("compactModelDisplayName keeps text after first colon only", () => {
  assert.equal(compactModelDisplayName("DeepSeek: DeepSeek V4 Flash"), "DeepSeek V4 Flash");
  assert.equal(compactModelDisplayName("DeepSeek:DeepSeek V4 Flash"), "DeepSeek V4 Flash");
  assert.equal(compactModelDisplayName("DeepSeek: DeepSeek V3.2"), "DeepSeek V3.2");
  assert.equal(compactModelDisplayName("Google: Gemma 4 31B"), "Gemma 4 31B");
  assert.equal(compactModelDisplayName("MoonshotAI: Kimi K2.5"), "Kimi K2.5");
  assert.equal(compactModelDisplayName("deepseek-v3.2"), "deepseek-v3.2");
});

test("model metadata helpers expose useful CrofAI /models fields", () => {
  const model = {
    id: "kimi-k2-thinking-turbo",
    context_length: 262144,
    max_completion_tokens: 8192,
    quantization: "fp8",
    speed: 105
  };

  assert.deepEqual(formatModelMeta(model), ["262,144 ctx", "8,192 out", "fp8", "~105 tok/s"]);
  assert.deepEqual(inferModelBadges(model), ["reasoning", "turbo"]);
});

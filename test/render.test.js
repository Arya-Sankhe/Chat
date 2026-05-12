import assert from "node:assert/strict";
import test from "node:test";
import {
  compactModelDisplayName,
  formatModelMeta,
  inferModelBadges,
  modelBrandLogoUrl,
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
  assert.equal(models[0].rawName, "DeepSeek: DeepSeek V3.2");
  assert.equal(models[0].name, "DeepSeek V3.2");
});

test("compactModelDisplayName keeps text after first colon only", () => {
  assert.equal(compactModelDisplayName("DeepSeek: DeepSeek V4 Flash"), "DeepSeek V4 Flash");
  assert.equal(compactModelDisplayName("DeepSeek:DeepSeek V4 Flash"), "DeepSeek V4 Flash");
  assert.equal(compactModelDisplayName("DeepSeek: DeepSeek V3.2"), "DeepSeek V3.2");
  assert.equal(compactModelDisplayName("Google: Gemma 4 31B"), "Gemma 4 31B");
  assert.equal(compactModelDisplayName("MoonshotAI: Kimi K2.5"), "Kimi K2.5");
  assert.equal(compactModelDisplayName("deepseek-v3.2"), "deepseek-v3.2");
});

test("normalizeModelList drops gemma and greg models from the selector list", () => {
  const models = normalizeModelList({
    data: [
      { id: "deepseek-v3.2", name: "DeepSeek: DeepSeek V3.2" },
      { id: "google/gemma-2-9b", name: "Google: Gemma 2 9B" },
      { id: "some-greg-test", name: "Vendor: Greg Pro" }
    ]
  });
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "deepseek-v3.2");
});

test("modelBrandLogoUrl maps known vendors to bundled SVG paths", () => {
  assert.match(modelBrandLogoUrl({ id: "deepseek/deepseek-v3.2", rawName: "DeepSeek: V3.2", name: "V3.2" }), /deepseek%20logo\.svg$/);
  assert.match(modelBrandLogoUrl({ id: "qwen/qwen3", rawName: "Qwen 3", name: "Qwen 3" }), /qwen%20logo\.svg$/);
  assert.match(modelBrandLogoUrl({ id: "moonshot/kimi", rawName: "Moonshot: Kimi", name: "Kimi" }), /kimi%20logo\.svg$/);
  assert.match(modelBrandLogoUrl({ id: "zhipu/glm-4", rawName: "Zhipu GLM-4", name: "GLM-4" }), /zai%20logo\.svg$/);
  assert.match(modelBrandLogoUrl({ id: "minimax/m2", rawName: "MiniMax M2", name: "M2" }), /minimax%20logo\.svg$/);
  assert.match(modelBrandLogoUrl({ id: "xiaomi/mimo", rawName: "Xiaomi Mimo", name: "Mimo" }), /xiaomimimo%20logo\.svg$/);
  assert.equal(modelBrandLogoUrl({ id: "unknown-vendor/foo", rawName: "Foo", name: "Foo" }), "");
});

test("model metadata helpers expose useful /models fields", () => {
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

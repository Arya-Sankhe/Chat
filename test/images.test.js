import assert from "node:assert/strict";
import test from "node:test";
import {
  applyImageDescriptionsToContent,
  collectImageDescriptions,
  collectImageAttachmentIds,
  collectUndescribedImageAttachmentIds,
  describeConversationImages,
  messagesHaveImages,
  substituteImagesWithDescriptions
} from "../server/saas/images.js";
import { modelSupportsVision, resolveVisionDescribeModel } from "../server/saas/models.js";

test("modelSupportsVision detects kimi and generic vision models", () => {
  assert.equal(modelSupportsVision({ id: "moonshot/kimi-k2.6", name: "Kimi K2.6" }), true);
  assert.equal(modelSupportsVision({ id: "deepseek-v3.2", name: "DeepSeek V3.2" }), false);
  assert.equal(modelSupportsVision({ id: "gpt-4o-mini", name: "GPT-4o Mini" }), true);
  assert.equal(modelSupportsVision({ id: "openai/gpt-5-mini", name: "GPT-5 Mini" }), true);
  assert.equal(modelSupportsVision({ id: "x-ai/grok-4.1-fast", name: "Grok 4.1 Fast" }), true);
  assert.equal(modelSupportsVision({ id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" }), true);
  assert.equal(modelSupportsVision({ id: "qwen/qwen2.5-vl-72b", name: "Qwen2.5 VL 72B" }), true);
  // MiMo v2.5 is omnimodal (image input); the -pro variant is text-only.
  assert.equal(modelSupportsVision("xiaomi/mimo-v2.5"), true);
  assert.equal(modelSupportsVision("xiaomi/mimo-v2.5-pro"), false);
  assert.equal(modelSupportsVision("google/gemma-4-26b-a4b-it"), true);
  assert.equal(modelSupportsVision("google/gemma-4-31b-it"), true);
  assert.equal(modelSupportsVision("minimax/minimax-m3"), true);
  // Metadata (input modalities) still wins when available.
  assert.equal(modelSupportsVision({
    id: "xiaomi/mimo-v2.5",
    name: "Xiaomi: MiMo-V2.5",
    architecture: { input_modalities: ["text", "audio", "image", "video"], output_modalities: ["text"] }
  }), true);
  assert.equal(modelSupportsVision({
    id: "vendor/model-with-plain-name",
    name: "Plain Model",
    architecture: { input_modalities: ["text", "image"] }
  }), true);
});

test("modelSupportsVision does not flag image-generation-only models on output modalities", () => {
  assert.equal(modelSupportsVision({
    id: "vendor/text-to-image-only",
    name: "Painter",
    architecture: { input_modalities: ["text"], output_modalities: ["image"] }
  }), false);
  assert.equal(modelSupportsVision({
    id: "vendor/plain-text-model",
    name: "Plain Text",
    architecture: { input_modalities: ["text"] }
  }), false);
});

test("resolveVisionDescribeModel prefers configured and kimi models", () => {
  assert.equal(resolveVisionDescribeModel({ visionDescribeModel: "custom-vision" }, [], []), "custom-vision");
  assert.equal(resolveVisionDescribeModel({}, ["deepseek-v3.2", "moonshot/kimi-k2.6"], []), "moonshot/kimi-k2.6");
});

test("messagesHaveImages and collectImageAttachmentIds scan user history", () => {
  const messages = [
    { role: "user", content: "hello" },
    {
      role: "user",
      content: [
        { type: "text", text: "solve this" },
        { type: "image_url", image_url: { attachment_id: "att_1", file_name: "q.png" } }
      ]
    }
  ];

  assert.equal(messagesHaveImages(messages), true);
  assert.deepEqual(collectImageAttachmentIds(messages), ["att_1"]);
});

test("image description helpers cache and find only missing descriptions", () => {
  const content = [
    { type: "text", text: "compare these" },
    { type: "image_url", image_url: { attachment_id: "att_1", file_name: "a.png", description: "A chart." } },
    { type: "image_url", image_url: { attachment_id: "att_2", file_name: "b.png" } }
  ];
  const messages = [{ role: "user", content }];

  assert.deepEqual(collectImageDescriptions(messages), { att_1: "A chart." });
  assert.deepEqual(collectUndescribedImageAttachmentIds(messages), ["att_2"]);

  const next = applyImageDescriptionsToContent(content, { att_2: "A table." });
  assert.equal(next[1].image_url.description, "A chart.");
  assert.equal(next[2].image_url.description, "A table.");
});

test("substituteImagesWithDescriptions replaces image parts with text", () => {
  const content = [
    { type: "text", text: "solve this" },
    { type: "image_url", image_url: { attachment_id: "att_1", file_name: "q.png" } }
  ];

  const replaced = substituteImagesWithDescriptions(content, { att_1: "A table with prices 8, 9, and 6." });
  assert.equal(replaced[0].text, "solve this");
  assert.match(replaced[1].text, /A table with prices/);
});

test("describeConversationImages can describe only missing image ids in one call", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: "A receipt with a $12 total." } }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await describeConversationImages({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "what is the total?" },
          { type: "image_url", image_url: { attachment_id: "att_1", description: "Already described." } },
          { type: "image_url", image_url: { attachment_id: "att_2" } }
        ]
      }],
      db: {
        async getAttachment(_userId, attachmentId) {
          return { id: attachmentId, object_key: `${attachmentId}.png`, status: "uploaded" };
        }
      },
      userId: "user_1",
      r2: { readUrl: (key) => `https://files.example/${key}` },
      config: { serverApiKey: "key", defaultBaseUrl: "https://api.example.test" },
      attachmentIds: ["att_2"],
      describeModel: "kimi-k2.6"
    });

    const sentImages = requestBody.messages[0].content.filter((part) => part.type === "image_url");
    const instruction = requestBody.messages[0].content.find((part) => part.type === "text")?.text || "";
    assert.equal(sentImages.length, 1);
    assert.equal(sentImages[0].image_url.url, "https://files.example/att_2.png");
    assert.match(instruction, /ONLY to extract the information needed/i);
    assert.match(instruction, /do not solve/i);
    assert.match(instruction, /Do not compute/i);
    assert.deepEqual(result.descriptions, { att_2: "A receipt with a $12 total." });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("describeConversationImages uses streaming descriptions when provided", async () => {
  const result = await describeConversationImages({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "solve this" },
        { type: "image_url", image_url: { attachment_id: "att_1" } }
      ]
    }],
    db: {
      async getAttachment(_userId, attachmentId) {
        return { id: attachmentId, object_key: `${attachmentId}.png`, status: "uploaded" };
      }
    },
    userId: "user_1",
    r2: { readUrl: (key) => `https://files.example/${key}` },
    config: { serverApiKey: "key", defaultBaseUrl: "https://api.example.test" },
    attachmentIds: ["att_1"],
    describeModel: "xiaomi/mimo-v2.5",
    streamChatCompletionFn: async () => new Response([
      "data: {\"choices\":[{\"delta\":{\"content\":\"A decision tree image with tables.\"}}]}\n\n",
      "data: {\"choices\":[{\"finish_reason\":\"stop\",\"delta\":{}}]}\n\n",
      "data: [DONE]\n\n"
    ].join(""), { status: 200 })
  });

  assert.deepEqual(result.descriptions, { att_1: "A decision tree image with tables." });
});

test("describeConversationImages rejects empty visual descriptions", async () => {
  await assert.rejects(
    describeConversationImages({
      messages: [{
        role: "user",
        content: [{ type: "image_url", image_url: { attachment_id: "att_1" } }]
      }],
      db: {
        async getAttachment(_userId, attachmentId) {
          return { id: attachmentId, object_key: `${attachmentId}.png`, status: "uploaded" };
        }
      },
      userId: "user_1",
      r2: { readUrl: (key) => `https://files.example/${key}` },
      config: { serverApiKey: "key", defaultBaseUrl: "https://api.example.test" },
      attachmentIds: ["att_1"],
      describeModel: "xiaomi/mimo-v2.5",
      chatCompletionFn: async () => ""
    }),
    /empty response/
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  collectImageAttachmentIds,
  messagesHaveImages,
  substituteImagesWithDescriptions
} from "../server/saas/images.js";
import { modelSupportsVision, resolveVisionDescribeModel } from "../server/saas/models.js";

test("modelSupportsVision detects kimi and generic vision models", () => {
  assert.equal(modelSupportsVision({ id: "moonshot/kimi-k2.6", name: "Kimi K2.6" }), true);
  assert.equal(modelSupportsVision({ id: "deepseek-v3.2", name: "DeepSeek V3.2" }), false);
  assert.equal(modelSupportsVision({ id: "gpt-4o-mini", name: "GPT-4o Mini" }), true);
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

test("substituteImagesWithDescriptions replaces image parts with text", () => {
  const content = [
    { type: "text", text: "solve this" },
    { type: "image_url", image_url: { attachment_id: "att_1", file_name: "q.png" } }
  ];

  const replaced = substituteImagesWithDescriptions(content, { att_1: "A table with prices 8, 9, and 6." });
  assert.equal(replaced[0].text, "solve this");
  assert.match(replaced[1].text, /A table with prices/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { generateConversationTitle, isGenericConversationTitle } from "../server/saas/messages.js";

const config = {
  providers: {
    openrouter: {
      apiKey: "or-key",
      baseUrl: "https://openrouter.ai/api/v1"
    }
  }
};

test("conversation titles use Laguna for text and MiMo only when an image carries the intent", async () => {
  const requests = [];
  const crofai = {
    async chatCompletion(request) {
      requests.push(request);
      return requests.length === 1
        ? "Title: **Compare VPS Hosting Costs.**"
        : "Identify Unclogged Roads";
    }
  };
  const r2 = { readUrl: (key) => `https://signed.example/${key}` };

  const textTitle = await generateConversationTitle({
    content: "Hi, can you compare VPS hosting costs for our deployment?",
    crofai,
    config,
    r2
  });
  const imageTitle = await generateConversationTitle({
    content: [{
      type: "image_url",
      image_url: { object_key: "traffic.png", file_name: "traffic.png", url: "r2://traffic.png" }
    }],
    crofai,
    config,
    r2
  });

  assert.equal(textTitle, "Compare VPS Hosting Costs");
  assert.equal(imageTitle, "Identify Unclogged Roads");
  assert.equal(requests[0].body.model, "poolside/laguna-xs-2.1");
  assert.equal(requests[1].body.model, "xiaomi/mimo-v2.5");
  assert.equal(requests[1].body.messages[1].content[1].image_url.url, "https://signed.example/traffic.png");
  assert.equal(requests[1].body.messages[1].content[1].image_url.detail, "low");
  assert.deepEqual(requests[0].body.models, [
    "poolside/laguna-xs-2.1",
    "deepseek/deepseek-v4-flash-0731"
  ]);
  assert.deepEqual(requests[0].body.reasoning, { enabled: false });
  assert.equal(requests[0].body.max_tokens, 64);
  assert.equal(requests[1].body.max_tokens, 512);
});

test("specific image prompts stay text-only and title failures have a usable fallback", async () => {
  let request;
  let signed = false;
  const descriptiveTitle = await generateConversationTitle({
    content: [
      { type: "text", text: "Compare the pricing shown in this screenshot" },
      { type: "image_url", image_url: { object_key: "pricing.png" } }
    ],
    crofai: {
      async chatCompletion(value) {
        request = value;
        return "Compare Screenshot Pricing";
      }
    },
    config,
    r2: {
      readUrl() {
        signed = true;
        return "unused";
      }
    }
  });
  const fallback = await generateConversationTitle({
    content: [{ type: "image_url", image_url: { object_key: "broken.png" } }],
    crofai: { async chatCompletion() { throw new Error("offline"); } },
    config,
    r2: { readUrl: () => "https://signed.example/broken.png" }
  });

  assert.equal(descriptiveTitle, "Compare Screenshot Pricing");
  assert.equal(request.body.model, "poolside/laguna-xs-2.1");
  assert.equal(typeof request.body.messages[1].content, "string");
  assert.equal(signed, false);
  assert.equal(fallback, "Review uploaded image");
});

test("generic image prompts never persist the raw request as the chat title", async () => {
  const title = await generateConversationTitle({
    content: [
      { type: "text", text: "solve this" },
      { type: "image_url", image_url: { object_key: "question.png" } }
    ],
    crofai: { async chatCompletion() { return "solve this"; } },
    config,
    r2: { readUrl: () => "https://signed.example/question.png" }
  });

  assert.equal(title, "Review uploaded image");
  assert.equal(isGenericConversationTitle("solve this"), true);
  assert.equal(isGenericConversationTitle("Review uploaded image"), true);
  assert.equal(isGenericConversationTitle("Review 2 images"), true);
});

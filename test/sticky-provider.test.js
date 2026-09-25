import test from "node:test";
import assert from "node:assert/strict";
import { OPENROUTER_PRO_MODEL, OPENROUTER_TEXT_MODEL, adaptChatRequestForProvider, stickyProviderTags } from "../server/providers.js";
import { createModelUsageMeter } from "../server/saas/usageMeter.js";

const sse = (events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
  headers: { "content-type": "text/event-stream" }
});

test("a pinned DeepSeek host moves to the front of the ranked order", () => {
  const adapted = adaptChatRequestForProvider({ model: OPENROUTER_TEXT_MODEL, sticky_provider: "DeepInfra", messages: [] }, "openrouter");
  assert.equal(adapted.provider.order[0], "deepinfra/fp8");
  assert.equal(adapted.provider.order.filter((tag) => tag === "deepinfra/fp8").length, 1);
  assert.equal(adapted.provider.allow_fallbacks, true);
  assert.equal("sticky_provider" in adapted, false);
});

test("a host outside the price-ranked order is not pinned", () => {
  assert.deepEqual(stickyProviderTags(OPENROUTER_TEXT_MODEL, "Very Expensive Host"), []);
  const adapted = adaptChatRequestForProvider({ model: OPENROUTER_TEXT_MODEL, sticky_provider: "Very Expensive Host", messages: [] }, "openrouter");
  assert.notEqual(adapted.provider.order[0], "very-expensive-host");
});

test("other models pin by provider slug; the pro model keeps its fixed order", () => {
  const glm = adaptChatRequestForProvider({ model: "z-ai/glm-5.3-flash", sticky_provider: "Atlas Cloud", messages: [] }, "openrouter");
  assert.deepEqual(glm.provider.order, ["atlas-cloud"]);
  const pro = adaptChatRequestForProvider({ model: OPENROUTER_PRO_MODEL, sticky_provider: "OpenAI", messages: [] }, "openrouter");
  assert.deepEqual(pro.provider.order, ["openai/flex", "openai"]);
  assert.equal("sticky_provider" in pro, false);
});

test("the usage meter keeps later requests in a turn on the first request's host", async () => {
  const bodies = [];
  const meter = createModelUsageMeter({
    db: {
      async checkApiBudget() { return { allowed: true }; },
      async recordApiUsageCost() { return {}; }
    },
    userId: "user-1",
    subscription: null,
    plan: { id: "pro", monthlyApiCreditLimit: 10 },
    streamChatCompletionFn: async (params) => {
      bodies.push(params.body);
      return sse([
        { id: "gen-1", model: params.body.model, provider: "Relace", choices: [{ delta: { content: "hi" } }] },
        { id: "gen-1", model: params.body.model, provider: "Relace", choices: [], usage: { cost: 0.0001 } }
      ]);
    }
  });
  const call = async () => {
    const response = await meter.streamChatCompletion({ apiKey: "k", baseUrl: "https://or.test", providerId: "openrouter", body: { model: OPENROUTER_TEXT_MODEL, messages: [] } });
    await response.text();
  };
  await call();
  await call();
  assert.equal(bodies[0].sticky_provider, undefined);
  assert.equal(bodies[1].sticky_provider, "Relace");
  assert.deepEqual(meter.pinnedProviders(), { [OPENROUTER_TEXT_MODEL]: "Relace" });
});

test("a meter can start pinned, and a fallback model's host is not learned", async () => {
  const bodies = [];
  const meter = createModelUsageMeter({
    db: { async checkApiBudget() { return { allowed: true }; }, async recordApiUsageCost() { return {}; } },
    userId: "user-1",
    plan: { id: "pro", monthlyApiCreditLimit: 10 },
    stickyProviders: { "poolside/laguna-s-2.1": "Poolside" },
    streamChatCompletionFn: async (params) => {
      bodies.push(params.body);
      return sse([{ id: "gen-2", model: OPENROUTER_TEXT_MODEL, provider: "DeepInfra", choices: [{ delta: { content: "x" } }] }]);
    }
  });
  const response = await meter.streamChatCompletion({ apiKey: "k", baseUrl: "https://or.test", providerId: "openrouter", body: { model: "poolside/laguna-s-2.1", messages: [] } });
  await response.text();
  assert.equal(bodies[0].sticky_provider, "Poolside");
  assert.deepEqual(meter.pinnedProviders(), { "poolside/laguna-s-2.1": "Poolside" });
});

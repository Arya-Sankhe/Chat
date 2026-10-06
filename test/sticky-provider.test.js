import test from "node:test";
import assert from "node:assert/strict";
import { OPENROUTER_PRO_MODEL, OPENROUTER_TEXT_MODEL, OPENROUTER_VISION_MODEL, adaptChatRequestForProvider, stickyProviderTags } from "../server/providers.js";
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
  const vision = adaptChatRequestForProvider({ model: OPENROUTER_VISION_MODEL, sticky_provider: "Atlas Cloud", messages: [] }, "openrouter");
  assert.deepEqual(vision.provider.order, ["atlas-cloud"]);
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

const meterDb = (saved = []) => ({
  async checkApiBudget() { return { allowed: true }; },
  async recordApiUsageCost(record) { saved.push(record); return {}; }
});

test("a model answered by its backup sends the rest of the turn to the backup, on the backup's host", async () => {
  const bodies = [];
  const meter = createModelUsageMeter({
    db: meterDb(),
    userId: "user-1",
    plan: { id: "pro", monthlyApiCreditLimit: 10 },
    stickyProviders: { "upstage/solar-pro4": "Upstage" },
    streamChatCompletionFn: async (params) => {
      bodies.push(params.body);
      return sse([{ id: "gen-2", model: OPENROUTER_TEXT_MODEL, provider: "DeepInfra", choices: [{ delta: { content: "x" } }] }]);
    }
  });
  const call = async () => {
    const response = await meter.streamChatCompletion({ apiKey: "k", baseUrl: "https://or.test", providerId: "openrouter", body: { model: "upstage/solar-pro4", messages: [] } });
    await response.text();
  };
  await call();
  await call();
  assert.equal(bodies[0].model, "upstage/solar-pro4");
  assert.equal(bodies[0].sticky_provider, "Upstage");
  assert.equal(bodies[1].model, OPENROUTER_TEXT_MODEL);
  assert.equal(bodies[1].sticky_provider, "DeepInfra");
  assert.deepEqual(meter.pinnedProviders(), { "upstage/solar-pro4": "Upstage", [OPENROUTER_TEXT_MODEL]: "DeepInfra" });
});

test("a chat's next message within five minutes starts on the hosts its last message used", async (t) => {
  const bodies = [];
  const meterFor = (key) => createModelUsageMeter({
    db: meterDb(),
    userId: "user-1",
    plan: { id: "pro", monthlyApiCreditLimit: 10 },
    recentHostsKey: key,
    streamChatCompletionFn: async (params) => {
      bodies.push(params.body);
      return sse([{ id: "gen-3", model: params.body.model, provider: "StreamLake", choices: [{ delta: { content: "x" } }] }]);
    }
  });
  const call = async (meter) => {
    const response = await meter.streamChatCompletion({ apiKey: "k", baseUrl: "https://or.test", providerId: "openrouter", body: { model: OPENROUTER_TEXT_MODEL, messages: [] } });
    await response.text();
  };
  await call(meterFor("user-1:chat-a"));
  await call(meterFor("user-1:chat-a"));
  await call(meterFor("user-1:chat-b"));
  assert.equal(bodies[0].sticky_provider, undefined);
  assert.equal(bodies[1].sticky_provider, "StreamLake");
  assert.equal(bodies[2].sticky_provider, undefined, "another chat picks its own host");

  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 5 * 60_000 + 1 });
  await call(meterFor("user-1:chat-a"));
  assert.equal(bodies[3].sticky_provider, undefined, "after five minutes the best host is picked again");
});

test("the saved usage names the host next to its cached tokens", async () => {
  const saved = [];
  const meter = createModelUsageMeter({
    db: meterDb(saved),
    userId: "user-1",
    plan: { id: "pro", monthlyApiCreditLimit: 10 },
    streamChatCompletionFn: async () => sse([
      { id: "gen-4", model: OPENROUTER_TEXT_MODEL, provider: "DeepInfra", choices: [{ delta: { content: "x" } }] },
      { id: "gen-4", model: OPENROUTER_TEXT_MODEL, provider: "DeepInfra", choices: [], usage: { cost: 0.0001, prompt_tokens: 900, prompt_tokens_details: { cached_tokens: 800 } } }
    ])
  });
  const response = await meter.streamChatCompletion({ apiKey: "k", baseUrl: "https://or.test", providerId: "openrouter", body: { model: OPENROUTER_TEXT_MODEL, messages: [] } });
  await response.text();
  assert.equal(saved[0].usage.provider_host, "DeepInfra");
  assert.equal(saved[0].usage.prompt_tokens_details.cached_tokens, 800);
});

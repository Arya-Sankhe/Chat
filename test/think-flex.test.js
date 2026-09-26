import test from "node:test";
import assert from "node:assert/strict";

import {
  adaptChatRequestForProvider,
  lunaFlexBeatsMimo,
  resetThinkFlexCache,
  thinkUsesLunaFlex
} from "../server/providers.js";
import { normalizeChatRequest } from "../server/model-api/normalize.js";

const host = (tag, tps, latency, status = 0) => ({
  tag, status, throughput_last_30m: { p50: tps }, latency_last_30m: { p50: latency }
});

test("Luna flex beats MiMo on equally weighted speed and first-token latency", () => {
  const mimo = [host("deepinfra/fp8", 30, 2000), host("xiaomi/fp8", 25, 3500)];
  assert.equal(lunaFlexBeatsMimo([host("openai/flex", 120, 1800)], mimo), true, "faster on both");
  assert.equal(lunaFlexBeatsMimo([host("openai/flex", 20, 2500)], mimo), false, "slower on both");
  // Twice the speed makes up for twice the wait, so a bigger speed edge wins and a smaller loses.
  assert.equal(lunaFlexBeatsMimo([host("openai/flex", 90, 4000)], mimo), true);
  assert.equal(lunaFlexBeatsMimo([host("openai/flex", 50, 4000)], mimo), false);
  // Only the flex tier counts, and MiMo is its best healthy host.
  assert.equal(lunaFlexBeatsMimo([host("openai", 500, 500), host("openai/flex", 20, 2500)], mimo), false);
  assert.equal(lunaFlexBeatsMimo([host("openai/flex", 40, 2000)], [host("a", 200, 500, -5), host("b", 30, 2000)]), true);
  // Missing stats or an unhealthy flex host keep Think on MiMo.
  assert.equal(lunaFlexBeatsMimo([host("openai/flex", 120, 1800, -5)], mimo), false);
  assert.equal(lunaFlexBeatsMimo([host("openai/flex", 120, 1800)], []), false);
  assert.equal(lunaFlexBeatsMimo([], mimo), false);
});

test("thinkUsesLunaFlex reads both catalogs once and stays on MiMo when they fail", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; resetThinkFlexCache(); });
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const endpoints = String(url).includes("gpt-6-luna") ? [host("openai/flex", 120, 1800)] : [host("deepinfra/fp8", 30, 2000)];
    return new Response(JSON.stringify({ data: { endpoints } }), { status: 200 });
  };
  resetThinkFlexCache();
  assert.equal(await thinkUsesLunaFlex({ baseUrl: "https://openrouter.test" }), true);
  assert.equal(await thinkUsesLunaFlex({ baseUrl: "https://openrouter.test" }), true);
  assert.equal(urls.length, 2, "cached for five minutes");

  globalThis.fetch = async () => new Response("", { status: 500 });
  resetThinkFlexCache();
  assert.equal(await thinkUsesLunaFlex({ baseUrl: "https://openrouter.test" }), false);
});

test("flex-only Luna routes to OpenAI flex alone and falls back to MiMo", async (t) => {
  const request = normalizeChatRequest({ model: "openai/gpt-6-luna", messages: [{ role: "user", content: "hi" }], flex_only: true });
  assert.equal(request.flex_only, true);
  assert.equal(normalizeChatRequest({ model: "openai/gpt-6-luna", messages: [{ role: "user", content: "hi" }], flex_only: false }).flex_only, undefined);

  const adapted = adaptChatRequestForProvider(request, "openrouter");
  assert.deepEqual(adapted.provider, { order: ["openai/flex"], allow_fallbacks: false });
  assert.equal(adapted.flex_only, undefined);

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const bodies = [];
  globalThis.fetch = async (_url, options = {}) => {
    bodies.push(JSON.parse(options.body));
    return bodies.length === 1
      ? new Response(JSON.stringify({ error: { message: "flex busy" } }), { status: 429, headers: { "content-type": "application/json" } })
      : new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const { streamChatCompletion } = await import("../server/model-api/client.js");
  await streamChatCompletion({ apiKey: "test", baseUrl: "https://openrouter.test", providerId: "openrouter", body: request, maxAttempts: 1 });
  assert.equal(bodies[0].model, "openai/gpt-6-luna");
  assert.equal(bodies[1].model, "xiaomi/mimo-v2.6-flash");
  assert.equal(bodies[1].flex_only, undefined);
});

import assert from "node:assert/strict";
import test from "node:test";

import { streamChatCompletion } from "../server/model-api/client.js";

const realFetch = globalThis.fetch;
const encoder = new TextEncoder();
const MERCURY = "inception/mercury-2.5";
const DEEPSEEK = "deepseek/deepseek-v4-flash-0731";

// Mercury answers or hangs after OpenRouter's keep-alive comment; DeepSeek always answers.
function installFetch({ mercuryHangs }) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith("/models") || href.includes("/endpoints")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    const body = JSON.parse(options.body);
    const call = { model: body.model, models: body.models, aborted: false };
    calls.push(call);
    options.signal?.addEventListener("abort", () => { call.aborted = true; }, { once: true });
    const hang = body.model === MERCURY && mercuryHangs;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(": OPENROUTER PROCESSING\n\n"));
        options.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
        if (hang) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ model: body.model, choices: [{ delta: { content: `hi from ${body.model}` }, finish_reason: "stop" }] })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return calls;
}

async function read(response) {
  return new TextDecoder().decode(await new Response(response.body).arrayBuffer());
}

const params = { apiKey: "k", baseUrl: "https://openrouter.test/api/v1", providerId: "openrouter", body: { model: MERCURY, messages: [{ role: "user", content: "hi" }], reasoning: { enabled: false } } };

test("voice streams from Mercury alone when it starts quickly", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  const calls = installFetch({ mercuryHangs: false });
  const text = await read(await streamChatCompletion({ ...params, signal: new AbortController().signal }));
  assert.match(text, /OPENROUTER PROCESSING[\s\S]*hi from inception\/mercury-2\.5/, "keep-alive bytes are replayed in order");
  assert.deepEqual(calls.map((call) => call.model), [MERCURY]);
  assert.deepEqual(calls[0].models, [MERCURY, DEEPSEEK]);
});

test("a Mercury stream that never starts is raced by DeepSeek, and the loser is cancelled", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  const calls = installFetch({ mercuryHangs: true });
  const started = Date.now();
  const text = await read(await streamChatCompletion({ ...params, signal: new AbortController().signal }));
  const elapsed = Date.now() - started;
  assert.match(text, /hi from deepseek/);
  assert.ok(elapsed >= 2400 && elapsed < 4000, `answered after ${elapsed}ms`);
  assert.deepEqual(calls.map((call) => call.model), [MERCURY, DEEPSEEK]);
  assert.equal(calls[0].aborted, true, "the hung Mercury request is cancelled");
  assert.equal(calls[1].models, undefined, "DeepSeek is asked directly");
});

test("stopping a voice reply while Mercury hangs aborts without asking DeepSeek", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  const calls = installFetch({ mercuryHangs: true });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(streamChatCompletion({ ...params, signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(calls.map((call) => call.model), [MERCURY]);
  assert.equal(calls[0].aborted, true);
});

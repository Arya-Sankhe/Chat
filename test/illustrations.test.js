import assert from "node:assert/strict";
import test from "node:test";

import { createCrofaiUsageMeter } from "../server/saas/usageMeter.js";
import {
  HAN_RE,
  ILLUSTRATION_MAX_BYTES,
  ILLUSTRATION_MODEL,
  PLANNER_SYSTEM_PROMPT,
  TEXT_FREE_SUFFIX,
  buildKreaPrompt,
  decodeIllustrationBytes,
  detectRasterImage,
  formatIllustrationContent,
  hasHan,
  normalizeIllustrationPlan,
  parsePlannerJson,
  planIllustrations
} from "../server/saas/illustrations.js";
import { imageGeneration } from "../server/crofai/client.js";

const MINI_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

test("planner system prompt stays under 4 KiB and the image suffix stays short", () => {
  assert.ok(Buffer.byteLength(PLANNER_SYSTEM_PROMPT, "utf8") < 4 * 1024);
  assert.ok(Buffer.byteLength(TEXT_FREE_SUFFIX, "utf8") < 400);
  assert.match(PLANNER_SYSTEM_PROMPT, /ONE 16:9 scene/);
  assert.match(PLANNER_SYSTEM_PROMPT, /short English labels/);
  assert.doesNotMatch(PLANNER_SYSTEM_PROMPT, /2–4 ordered beats|Do not ask for words|no words, letters/);
  assert.match(TEXT_FREE_SUFFIX, /One scene, one metaphor/);
  assert.match(TEXT_FREE_SUFFIX, /No watermark/);
  assert.match(TEXT_FREE_SUFFIX, /Klui/);
  assert.doesNotMatch(TEXT_FREE_SUFFIX, /no visible text/i);
  assert.doesNotMatch(PLANNER_SYSTEM_PROMPT, /Xiaohei|Ian Xiaohei/);
  assert.doesNotMatch(TEXT_FREE_SUFFIX, /Xiaohei|Ian Xiaohei/);
});

test("normalizeIllustrationPlan accepts fenced JSON and default generate count", () => {
  const plan = normalizeIllustrationPlan(parsePlannerJson(`\`\`\`json
{"mode":"generate","reply":"One diagram of the earlier process.","images":[{"purpose":"Show the process","prompt":"A text-free Klui illustration of a pipeline."}]}
\`\`\``));
  assert.equal(plan.mode, "generate");
  assert.equal(plan.images.length, 1);

  const wrapped = parsePlannerJson('Here is the plan:\n{"mode":"generate","reply":"Wrapped.","images":[{"purpose":"One","prompt":"Klui waits"}]}');
  assert.equal(wrapped.mode, "generate");
});

test("normalizeIllustrationPlan clarify has no images and plan keeps proposed shots", () => {
  const clarify = normalizeIllustrationPlan({
    mode: "clarify",
    reply: "What should I illustrate?",
    images: [{ purpose: "x", prompt: "y".repeat(20) }]
  });
  assert.equal(clarify.mode, "clarify");
  assert.deepEqual(clarify.images, []);

  const planned = normalizeIllustrationPlan({
    mode: "plan",
    reply: "One possible shot.",
    images: [
      { purpose: "First", prompt: "First prompt" },
      { purpose: "Second", prompt: "Second prompt" }
    ]
  });
  assert.equal(planned.mode, "plan");
  assert.equal(planned.images.length, 1);
});

test("normalizeIllustrationPlan keeps one image and rejects prose, lengths, and Han", () => {
  assert.throws(() => parsePlannerJson("Here is a plan"), /not JSON/);
  assert.throws(() => normalizeIllustrationPlan({ mode: "generate", reply: "ok" }), /images/);
  const capped = normalizeIllustrationPlan({
    mode: "generate",
    reply: "ok",
    images: Array.from({ length: 5 }, (_, i) => ({ purpose: `p${i}`, prompt: `prompt ${i}` }))
  });
  assert.equal(capped.images.length, 1);
  assert.equal(capped.images[0].purpose, "p0");
  assert.throws(() => normalizeIllustrationPlan({
    mode: "generate",
    reply: "ok",
    images: [{ purpose: "p", prompt: "x".repeat(3501) }]
  }), /prompt/);
  assert.throws(() => normalizeIllustrationPlan({
    mode: "generate",
    reply: "ok",
    images: [{ purpose: "汉字", prompt: "plain prompt" }]
  }), /han/);
});

test("buildKreaPrompt always appends the no-watermark English-label constraint", () => {
  const prompt = buildKreaPrompt("Klui lifts a heavy process box");
  assert.match(prompt, /Klui lifts a heavy process box/);
  assert.match(prompt, /English labels/i);
  assert.match(prompt, /No watermark/i);
  assert.match(prompt, /No Chinese characters/i);
  assert.match(prompt, /16:9/);
  assert.doesNotMatch(prompt, HAN_RE);
  assert.ok(prompt.includes(TEXT_FREE_SUFFIX.trim()));
});

test("planIllustrations sends conversation history and skips the Image API for clarify or shot lists", async () => {
  const calls = [];
  const crofai = {
    async chatCompletion(params) {
      calls.push(params.body);
      const userTurns = params.body.messages.filter((message) => message.role !== "system");
      const userText = userTurns.map((message) => message.content).join("\n");
      if (/shot list|do not generate/i.test(userText)) {
        return JSON.stringify({
          mode: "plan",
          reply: "A short shot list.",
          images: [{ purpose: "The process", prompt: "Klui walks a path" }]
        });
      }
      if (!userTurns.length) {
        return JSON.stringify({ mode: "clarify", reply: "What should I illustrate?", images: [] });
      }
      return JSON.stringify({
        mode: "generate",
        reply: "One image of the earlier process.",
        images: [{ purpose: "The earlier process", prompt: "Klui explains the earlier process" }]
      });
    }
  };
  const provider = { id: "openrouter", apiKey: "k", baseUrl: "https://openrouter.ai/api/v1" };

  const generate = await planIllustrations({
    crofai,
    provider,
    model: "test-model",
    historyMessages: [
      { role: "user", content: "We should split the pipeline into three stages." },
      { role: "assistant", content: "Ingest, transform, and publish." },
      { role: "user", content: "Explain the above as one digestible image." }
    ]
  });
  assert.equal(generate.mode, "generate");
  assert.match(calls[0].messages.map((m) => m.content).join("\n"), /Ingest, transform, and publish/);
  assert.match(calls[0].messages.map((m) => m.content).join("\n"), /Explain the above/);
  assert.equal(calls[0].messages[0].content, PLANNER_SYSTEM_PROMPT);
  assert.equal(calls[0].max_tokens, 15_000);
  assert.equal("temperature" in calls[0], false);
  assert.equal("reasoning" in calls[0], false);

  const planned = await planIllustrations({
    crofai,
    provider,
    model: "test-model",
    historyMessages: [{ role: "user", content: "Give me a shot list only. Do not generate yet." }]
  });
  assert.equal(planned.mode, "plan");

  const clarify = await planIllustrations({
    crofai,
    provider,
    model: "test-model",
    historyMessages: [{ role: "user", content: "" }]
  });
  assert.equal(clarify.mode, "clarify");
});

test("Han characters trigger one repair and never pass through to Krea", async () => {
  let calls = 0;
  const crofai = {
    async chatCompletion() {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          mode: "generate",
          reply: "配图",
          images: [{ purpose: "图", prompt: "小黑走路" }]
        });
      }
      return JSON.stringify({
        mode: "generate",
        reply: "English repair",
        images: [{ purpose: "Walk", prompt: "Klui walks a white path" }]
      });
    }
  };
  const plan = await planIllustrations({
    crofai,
    provider: { id: "openrouter", apiKey: "k", baseUrl: "https://example" },
    model: "test-model",
    historyMessages: [{ role: "user", content: "Draw this." }]
  });
  assert.equal(calls, 2);
  assert.equal(plan.reply, "English repair");
  assert.equal(hasHan(plan.images[0].prompt), false);
  assert.doesNotMatch(buildKreaPrompt(plan.images[0].prompt), HAN_RE);
});

test("decodeIllustrationBytes accepts PNG/JPEG/WebP and rejects SVG and junk", () => {
  assert.equal(detectRasterImage(MINI_PNG).mime, "image/png");
  assert.equal(decodeIllustrationBytes(MINI_PNG.toString("base64"), 1024).mime, "image/png");
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(detectRasterImage(jpeg).mime, "image/jpeg");
  const webp = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([16, 0, 0, 0]),
    Buffer.from("WEBP")
  ]);
  assert.equal(detectRasterImage(webp).mime, "image/webp");
  assert.throws(() => decodeIllustrationBytes(Buffer.from("<svg></svg>").toString("base64"), 1024), /invalid/i);
  assert.throws(() => decodeIllustrationBytes("not-an-image", 1024), /invalid/i);
  const oversized = Buffer.concat([MINI_PNG, Buffer.alloc(ILLUSTRATION_MAX_BYTES)]);
  assert.throws(() => decodeIllustrationBytes(oversized.toString("base64"), ILLUSTRATION_MAX_BYTES), /invalid/i);
});

test("formatIllustrationContent shows the caption and image, not the purpose or attribution", () => {
  const generate = formatIllustrationContent({
    mode: "generate",
    reply: "Left to right: split, sort, merge.",
    stored: [{ purpose: "Show the process", attachmentId: "a1", objectKey: "k1", fileName: "illustration-01.png" }]
  });
  assert.deepEqual(generate.map((part) => part.type), ["text", "image_url"]);
  assert.equal(generate[0].text, "Left to right: split, sort, merge.");
  assert.doesNotMatch(JSON.stringify(generate), /Show the process|Ian Xiaohei/);

  const plan = formatIllustrationContent({
    mode: "plan",
    reply: "Shot list.",
    images: [{ purpose: "One", prompt: "secret prompt" }]
  });
  assert.match(plan[0].text, /No image was generated/);
  assert.match(plan[0].text, /1\. One/);
  assert.doesNotMatch(JSON.stringify(plan), /secret prompt|Ian Xiaohei/);
});

test("imageGeneration posts to /images once with no retry", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ error: { message: "nope" } }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    await assert.rejects(() => imageGeneration({
      apiKey: "or-key",
      baseUrl: "https://openrouter.ai/api/v1",
      body: { model: ILLUSTRATION_MODEL, prompt: "x", n: 1 }
    }), /nope/);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/images");
  assert.equal(calls[0].options.headers.authorization, "Bearer or-key");
  assert.equal(JSON.parse(calls[0].options.body).n, 1);
});

test("runReserved settles usage.cost and releases on pre-response failure", async () => {
  const calls = [];
  const db = {
    async checkApiBudget() { return { allowed: true }; },
    async recordApiUsageCost(payload) { calls.push({ op: "record", payload }); return {}; },
    async reserveApiUsage(payload) { calls.push({ op: "reserve", payload }); return { allowed: true }; },
    async markApiUsageSubmitted() { calls.push({ op: "submitted" }); },
    async settleApiUsage(payload) { calls.push({ op: "settle", payload }); },
    async releaseApiUsage() { calls.push({ op: "release" }); }
  };
  const plan = { id: "pro", monthlyApiCreditLimit: 10 };
  const subscription = { id: "sub-1", current_period_end: "2026-09-01T00:00:00.000Z" };
  const legacy = createCrofaiUsageMeter({
    db,
    userId: "user-1",
    plan,
    subscription,
    meteringMode: "legacy",
    modality: "llm",
    reservationCredits: 0.25
  });
  await legacy.runReserved({ body: { model: ILLUSTRATION_MODEL } }, async () => ({
    usage: { cost: 0.015 },
    generationId: "img-1",
    result: { ok: true }
  }));
  assert.equal(calls.at(-1).op, "record");
  assert.equal(calls.at(-1).payload.costCredits, 0.015);
  assert.equal(calls.at(-1).payload.model, ILLUSTRATION_MODEL);

  calls.length = 0;
  const enforced = createCrofaiUsageMeter({
    db,
    userId: "user-1",
    plan,
    subscription,
    meteringMode: "enforce",
    modality: "llm",
    reservationCredits: 0.25
  });
  await assert.rejects(() => enforced.runReserved({ body: { model: ILLUSTRATION_MODEL } }, async () => {
    throw new Error("transport failed");
  }), /transport failed/);
  assert.deepEqual(calls.map((call) => call.op), ["reserve", "release"]);
});

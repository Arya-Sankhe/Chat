import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../server/config.js";
import {
  buildProviderMessages,
  createConversationSummarizer,
  estimateContextTokens,
  trimProviderMessagesToBudget
} from "../server/saas/messages.js";

const r2 = { readUrl: (key) => `https://files.example/${key}` };

function smallContext(overrides = {}) {
  return {
    maxTokens: 220,
    compactAtTokens: 100,
    keepRecentTokens: 45,
    reserveTokens: 20,
    summaryModel: "deepseek/deepseek-v4-flash",
    summaryMaxTokens: 60,
    ...overrides
  };
}

test("context defaults compact around 140k while preserving hard-limit headroom", () => {
  const config = loadConfig({});
  assert.equal(config.context.maxTokens, 256_000);
  assert.equal(config.context.compactAtTokens, 140_000);
  assert.equal(config.context.keepRecentTokens, 80_000);
  assert.equal(config.context.reserveTokens, 32_000);
  assert.equal(config.context.summaryModel, "deepseek/deepseek-v4-flash");
});

test("buildProviderMessages summarizes older turns and keeps recent turns verbatim", async () => {
  const transcripts = [];
  const messages = [
    { role: "user", content: `old question ${"a".repeat(180)}` },
    { role: "assistant", content: `old answer ${"b".repeat(180)}` },
    { role: "user", content: "recent question" },
    { role: "assistant", content: "recent answer" },
    { role: "user", content: "newest request" }
  ];

  const built = await buildProviderMessages({
    messages,
    systemPrompt: "system",
    r2,
    contextConfig: smallContext(),
    summarizeHistory: async (transcript) => {
      transcripts.push(transcript);
      return "The user and assistant discussed the old topic.";
    }
  });

  assert.equal(transcripts.length, 1);
  assert.match(transcripts[0], /old question/);
  assert.equal(built[0].content, "system");
  assert.match(built[1].content, /Conversation summary of earlier turns/);
  assert.equal(built.at(-1).content, "newest request");
  assert.doesNotMatch(JSON.stringify(built), /old answer bbbbb/);
  assert.ok(estimateContextTokens(built) <= 200);
});

test("summary failure falls back to bounded recent history", async () => {
  const built = await buildProviderMessages({
    messages: [
      { role: "user", content: "x".repeat(300) },
      { role: "assistant", content: "y".repeat(300) },
      { role: "user", content: "keep this request" }
    ],
    systemPrompt: "system",
    r2,
    contextConfig: smallContext(),
    summarizeHistory: async () => { throw new Error("summary unavailable"); }
  });

  assert.equal(built.at(-1).content, "keep this request");
  assert.ok(estimateContextTokens(built) <= 200);
});

test("missing summarizer keeps older turns until the hard budget requires trimming", async () => {
  const built = await buildProviderMessages({
    messages: [
      { role: "user", content: `older ${"a".repeat(220)}` },
      { role: "assistant", content: `answer ${"b".repeat(220)}` },
      { role: "user", content: "latest request" }
    ],
    systemPrompt: "system",
    r2,
    contextConfig: smallContext(),
    summarizeHistory: null
  });

  assert.match(JSON.stringify(built), /older aaaa/);
  assert.equal(built.at(-1).content, "latest request");
  assert.ok(estimateContextTokens(built) <= 200);
});

test("hard trim drops excess image parts when an image-only turn exceeds the budget", () => {
  const images = Array.from({ length: 8 }, (_, index) => ({
    type: "image_url",
    image_url: { url: `https://images.example/${index}.png` }
  }));
  const trimmed = trimProviderMessagesToBudget([
    { role: "system", content: "system" },
    { role: "user", content: images }
  ], 4000);

  assert.ok(estimateContextTokens(trimmed) <= 4000);
  assert.ok(trimmed.at(-1).content.length < images.length);
});

test("AbortError from context summarization propagates", async () => {
  const error = new DOMException("Stopped", "AbortError");
  await assert.rejects(buildProviderMessages({
    messages: [
      { role: "user", content: "a".repeat(300) },
      { role: "assistant", content: "b".repeat(300) },
      { role: "user", content: "latest" }
    ],
    systemPrompt: "system",
    r2,
    contextConfig: smallContext(),
    summarizeHistory: async () => { throw error; }
  }), (caught) => caught === error);
});

test("council panelists removed by filterCouncilHistory never enter summary input", async () => {
  let transcript = "";
  const messages = [
    { role: "user", content: "u".repeat(240) },
    {
      role: "assistant",
      content: "panel secret".repeat(30),
      metadata: { council: { role: "panelist", sessionId: "c1" } }
    },
    {
      role: "assistant",
      content: "chairman synthesis".repeat(20),
      metadata: { council: { role: "chairman", sessionId: "c1" } }
    },
    { role: "user", content: "follow up" }
  ];

  await buildProviderMessages({
    messages,
    systemPrompt: "system",
    r2,
    contextConfig: smallContext(),
    summarizeHistory: async (value) => { transcript = value; return "summary"; }
  });

  assert.doesNotMatch(transcript, /panel secret/);
});

test("createConversationSummarizer makes one metered OpenRouter call for concurrent model builds", async () => {
  const calls = [];
  const config = loadConfig({ OPENROUTER_API_KEY: "or-key" });
  config.context = smallContext();
  const summarizeHistory = createConversationSummarizer({
    crofai: {
      async chatCompletion(request) {
        calls.push(request);
        return "shared summary";
      }
    },
    config,
    signal: new AbortController().signal
  });
  const args = {
    messages: [
      { role: "user", content: "a".repeat(300) },
      { role: "assistant", content: "b".repeat(300) },
      { role: "user", content: "latest" }
    ],
    systemPrompt: "system",
    r2,
    contextConfig: config.context,
    summarizeHistory
  };

  const [first, second] = await Promise.all([
    buildProviderMessages(args),
    buildProviderMessages(args)
  ]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].providerId, "openrouter");
  assert.equal(calls[0].body.model, "deepseek/deepseek-v4-flash");
  assert.equal(calls[0].body.reasoning_effort, "low");
  assert.match(first[1].content, /shared summary/);
  assert.deepEqual(first, second);
});

test("trimProviderMessagesToBudget keeps the system message and newest user request", () => {
  const trimmed = trimProviderMessagesToBudget([
    { role: "system", content: "system" },
    { role: "user", content: "old".repeat(100) },
    { role: "assistant", content: "answer".repeat(100) },
    { role: "user", content: "new request" }
  ], 40);

  assert.equal(trimmed[0].role, "system");
  assert.equal(trimmed.at(-1).content, "new request");
  assert.ok(estimateContextTokens(trimmed) <= 40);
});

import assert from "node:assert/strict";
import test from "node:test";
import { adaptChatRequestForProvider } from "../server/providers.js";
import {
  buildJudgePrompt,
  COUNCIL_JUDGE_MODEL,
  COUNCIL_STAGE1_SYSTEM_PROMPT,
  createJudgeStreamSplitter,
  generateNonce,
  judgeAnswerText,
  parseJudgeRanking,
  runCouncilJudge,
  withCouncilSystemPrompt
} from "../server/saas/council.js";
import { filterCouncilHistory } from "../server/saas/messages.js";

const PANEL = [
  { modelId: "alpha", responseText: "Answer alpha." },
  { modelId: "beta", responseText: "Answer beta." },
  { modelId: "gamma", responseText: "Answer gamma." },
  { modelId: "delta", responseText: "Answer delta." }
];

function streamOf(chunks) {
  return {
    body: new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          const delta = typeof chunk === "string" ? { content: chunk } : chunk;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`));
        }
        controller.close();
      }
    })
  };
}

function rankingFor(prompt, notes = ["clear and correct; a little long", "good example; misses a caveat", "partly wrong", "too vague"]) {
  const tags = [...prompt.matchAll(/<response-([a-f0-9]{8})>/g)].map((match) => match[1]);
  return `<ranking>\n${tags.map((tag, i) => `${i + 1}. response-${tag} — ${notes[i]}`).join("\n")}\n</ranking>\n\n`;
}

test("withCouncilSystemPrompt prepends the council system text", () => {
  assert.equal(withCouncilSystemPrompt(""), COUNCIL_STAGE1_SYSTEM_PROMPT);
  const combined = withCouncilSystemPrompt("You are helpful.");
  assert.ok(combined.startsWith(COUNCIL_STAGE1_SYSTEM_PROMPT));
  assert.ok(combined.endsWith("You are helpful."));
});

test("generateNonce returns short unique hex strings", () => {
  const a = generateNonce();
  const b = generateNonce();
  assert.match(a, /^[a-f0-9]{8}$/);
  assert.notEqual(a, b);
});

test("the judge is Luna, routed like Pro between flex and standard", () => {
  assert.equal(COUNCIL_JUDGE_MODEL, "openai/gpt-6-luna");
  const adapted = adaptChatRequestForProvider({ model: COUNCIL_JUDGE_MODEL, messages: [] }, "openrouter");
  assert.deepEqual(adapted.provider.order, ["openai/flex", "openai"]);
  assert.equal(adapted.provider.allow_fallbacks, true);
});

test("buildJudgePrompt tags every answer anonymously and asks for a ranking, then a combined answer", () => {
  const { prompt, tagToModelId } = buildJudgePrompt({ originalUserPrompt: "What is X?", panelists: PANEL });
  assert.match(prompt, /What is X\?/);
  assert.deepEqual(Object.values(tagToModelId).sort(), ["alpha", "beta", "delta", "gamma"]);
  for (const [tag, modelId] of Object.entries(tagToModelId)) {
    const answer = PANEL.find((panelist) => panelist.modelId === modelId).responseText;
    assert.ok(prompt.includes(`<response-${tag}>\n${answer}\n</response-${tag}>`));
  }
  assert.ok(!/alpha|beta|gamma|delta/.test(prompt.replace(/Answer (alpha|beta|gamma|delta)\./g, "")), "model ids stay hidden");
  assert.match(prompt, /<ranking>/);
  assert.match(prompt, /one or two short sentences/);
  assert.match(prompt, /best parts of all the answers, not just the top-ranked one/);
  assert.match(prompt, /one correct result/);
});

test("parseJudgeRanking reads ranks and notes, skipping unknown and repeated tags", () => {
  const map = { aaaa1111: "alpha", bbbb2222: "beta", cccc3333: "gamma" };
  const parsed = parseJudgeRanking([
    "1. response-bbbb2222 — Clear and correct.",
    "2) **response-aaaa1111**: Good example, misses a caveat.",
    "3. response-dddd4444 — unknown",
    "4. response-bbbb2222 — duplicate",
    "5. response-cccc3333"
  ].join("\n"), map);
  assert.deepEqual(parsed.ranking, ["beta", "alpha", "gamma"]);
  assert.deepEqual(parsed.notes, { beta: "Clear and correct.", alpha: "Good example, misses a caveat." });
  assert.equal(parseJudgeRanking("no ranking here", map), null);
});

test("judgeAnswerText keeps only what follows the ranking", () => {
  assert.equal(judgeAnswerText("<ranking>\n1. response-aaaa — ok\n</ranking>\n\nThe answer."), "The answer.");
  assert.equal(judgeAnswerText("Just an answer."), "Just an answer.");
  assert.equal(judgeAnswerText("<ranking>\n1. response-aaaa — cut off"), "");
  assert.equal(judgeAnswerText("<rank"), "");
});

test("the judge stream splitter streams a short answer that skips the ranking", () => {
  const rankings = [];
  const out = [];
  const splitter = createJudgeStreamSplitter({ onRanking: (text) => rankings.push(text), onEvent: (event) => out.push(event.choices[0].delta.content || "") });
  splitter.push({ choices: [{ delta: { content: "42." } }] });
  splitter.end();
  assert.deepEqual(rankings, [null]);
  assert.equal(out.join(""), "42.");
});

test("the judge stream splitter holds back the ranking and passes on the answer and reasoning", () => {
  const rankings = [];
  const out = [];
  const splitter = createJudgeStreamSplitter({ onRanking: (text) => rankings.push(text), onEvent: (event) => out.push(event.choices[0].delta) });
  const push = (delta) => splitter.push({ choices: [{ index: 0, delta }] });
  push({ reasoning: "thinking" });
  push({ content: "<rank" });
  push({ content: "ing>\n1. response-aaaa — good\n</ran" });
  push({ content: "king>\n\nFinal " });
  push({ content: "answer." });
  splitter.end();
  assert.deepEqual(rankings, ["\n1. response-aaaa — good\n"]);
  assert.equal(out.map((delta) => delta.content || "").join(""), "Final answer.");
  assert.equal(out[0].reasoning, "thinking");
});

test("the judge stream splitter streams an answer that skips the ranking", () => {
  const rankings = [];
  const out = [];
  const splitter = createJudgeStreamSplitter({ onRanking: (text) => rankings.push(text), onEvent: (event) => out.push(event.choices[0].delta.content || "") });
  splitter.push({ choices: [{ delta: { content: "Here is " } }] });
  splitter.push({ choices: [{ delta: { content: "the answer." } }] });
  splitter.end();
  assert.deepEqual(rankings, [null]);
  assert.equal(out.join(""), "Here is the answer.");
});

test("runCouncilJudge makes one Luna call, reports the ranking, and returns only the answer", async () => {
  const bodies = [];
  let ranked;
  const streamed = [];
  const result = await runCouncilJudge({
    originalUserPrompt: "Compare A and B.",
    panelists: PANEL,
    context: "Web sources here.",
    systemPrompt: "User style.",
    provider: { apiKey: "k", baseUrl: "https://or.test", id: "openrouter" },
    signal: new AbortController().signal,
    onRanking: (value) => { ranked = value; },
    onEvent: (event) => streamed.push(event.choices[0].delta.content || ""),
    streamChatCompletionFn: async ({ body }) => {
      bodies.push(body);
      const ranking = rankingFor(body.messages[1].content);
      return streamOf([ranking.slice(0, 20), ranking.slice(20), "The combined ", "answer."]);
    }
  });

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].model, "openai/gpt-6-luna");
  assert.deepEqual(bodies[0].reasoning, { effort: "high", exclude: false });
  assert.equal(bodies[0].messages[0].content, "User style.");
  assert.match(bodies[0].messages[1].content, /^Web sources here\.\n\nYou are the judge/);
  assert.equal(ranked.ranking.length, 4);
  assert.deepEqual(Object.values(ranked.notes), ["clear and correct; a little long", "good example; misses a caveat", "partly wrong", "too vague"]);
  assert.equal(streamed.join(""), "The combined answer.");
  assert.equal(result.content, "The combined answer.");
});

test("filterCouncilHistory drops Stage 1 panelist messages when chairman succeeded", () => {
  const messages = [
    { role: "user", content: "Original question" },
    { role: "assistant", content: "Panelist A reply", metadata: { council: { sessionId: "s1", role: "panelist" } } },
    { role: "assistant", content: "Panelist B reply", metadata: { council: { sessionId: "s1", role: "panelist" } } },
    { role: "assistant", content: "Final synthesis", metadata: { council: { sessionId: "s1", role: "chairman" } } },
    { role: "user", content: "Follow up" }
  ];

  const trimmed = filterCouncilHistory(messages);
  const roles = trimmed.map((m) => `${m.role}:${m?.metadata?.council?.role || ""}`);
  assert.deepEqual(roles, ["user:", "assistant:chairman", "user:"]);
});

test("filterCouncilHistory keeps panelist messages when chairman synthesis is missing or empty", () => {
  const messages = [
    { role: "user", content: "Original question" },
    { role: "assistant", content: "Panelist reply", metadata: { council: { sessionId: "s1", role: "panelist" } } },
    { role: "assistant", content: "", metadata: { council: { sessionId: "s1", role: "chairman" } } }
  ];

  const trimmed = filterCouncilHistory(messages);
  assert.equal(trimmed.length, 3, "no successful chairman → keep everything for context");
});

test("filterCouncilHistory is a no-op for normal compare messages", () => {
  const messages = [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hi back" }
  ];
  assert.deepEqual(filterCouncilHistory(messages), messages);
});

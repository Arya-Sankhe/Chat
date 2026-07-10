import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStreamReducer } from "../public/js/streaming.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "stream-reducer-fixtures.json");
const streamingJsPath = path.join(here, "..", "public", "js", "streaming.js");

const REDUCERS = [
  "applyStreamEvent",
  "applyToolEvent",
  "applyCompareStreamEvent",
  "applyCouncilStreamEvent",
  "ensureToolState"
];

function artifactKey(artifact) {
  return (
    artifact?.attachment_id
    || artifact?.document_file_id
    || artifact?.download_url
    || (artifact?.pending && artifact?.job_id ? `job:${artifact.job_id}` : "")
    || ""
  );
}

function mergeArtifacts(message, artifacts = []) {
  if (!Array.isArray(artifacts) || !artifacts.length) return;
  if (!message.artifacts) message.artifacts = [];
  const seen = new Set(message.artifacts.map(artifactKey).filter(Boolean));
  for (const artifact of artifacts) {
    const key = artifactKey(artifact);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    message.artifacts.push(artifact);
  }
}

function normalizeClientUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  const prompt = num(usage.promptTokens ?? usage.prompt_tokens);
  const completion = num(usage.completionTokens ?? usage.completion_tokens);
  const reasoning = num(
    usage.reasoningTokens
    ?? usage.reasoning_tokens
    ?? usage.completion_tokens_details?.reasoning_tokens
  );
  let total = num(usage.totalTokens ?? usage.total_tokens);
  if (total == null && (prompt != null || completion != null)) {
    total = (prompt || 0) + (completion || 0);
  }
  const result = {};
  if (prompt != null) result.promptTokens = prompt;
  if (completion != null) result.completionTokens = completion;
  if (reasoning != null) result.reasoningTokens = reasoning;
  if (total != null) result.totalTokens = total;
  return Object.keys(result).length ? result : null;
}

function stripLeakedToolMarkup(value) {
  const text = String(value ?? "");
  const dsmlTag = /<[^>]*\bDSML\b/i;
  if (!dsmlTag.test(text)) return text;
  return text
    .replace(/<\s*\|\s*\|?\s*DSML\s*\|[\s\S]*?<\s*\/\s*\|\s*\|?\s*DSML\s*\|\s*\|?\s*tool_calls\s*>/gi, "")
    .split(/\r?\n/)
    .filter((line) => !dsmlTag.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isFinalFinishReason(reason) {
  return Boolean(reason && reason !== "tool_calls");
}

function isPlaceholderPeerReason(value) {
  return /^<?\s*reason\s*>?$/i.test(String(value || "").trim());
}

function markActivityStarted(message) {
  if (!message.activityStartedAt) message.activityStartedAt = Date.now();
}

function markActivityEnded(message) {
  if (message.activityStartedAt && !message.activityEndedAt) {
    message.activityEndedAt = Date.now();
  }
}

function markReasoningStarted(message) {
  markActivityStarted(message);
  if (!message.reasoningStartedAt) message.reasoningStartedAt = Date.now();
}

function markReasoningEnded(message) {
  if (message.reasoningStartedAt && !message.reasoningEndedAt) {
    message.reasoningEndedAt = Date.now();
  }
}

const reducers = createStreamReducer({
  isAdminUser: () => false,
  mergeArtifacts,
  markActivityStarted,
  markActivityEnded,
  markReasoningStarted,
  markReasoningEnded,
  normalizeClientUsage,
  stripLeakedToolMarkup,
  isFinalFinishReason,
  isPlaceholderPeerReason
});

function stripIgnoredFields(value, ignoreFields) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => stripIgnoredFields(entry, ignoreFields));
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (ignoreFields.includes(key)) continue;
    out[key] = stripIgnoredFields(entry, ignoreFields);
  }
  return out;
}

test("reducer fixture file is well-formed and replayable", () => {
  const doc = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

  assert.equal(typeof doc.description, "string");
  assert.ok(Array.isArray(doc.ignoreFields) && doc.ignoreFields.length, "volatile fields are declared");
  assert.ok(Array.isArray(doc.fixtures) && doc.fixtures.length >= 8, "fixture set is non-trivial");

  const names = new Set();
  for (const fixture of doc.fixtures) {
    assert.equal(typeof fixture.name, "string", "fixture has a name");
    assert.ok(!names.has(fixture.name), `fixture name is unique: ${fixture.name}`);
    names.add(fixture.name);
    assert.ok(REDUCERS.includes(fixture.reducer), `${fixture.name}: reducer '${fixture.reducer}' is one of the five`);
    assert.equal(typeof fixture.initial, "object", `${fixture.name}: has an initial state`);
    assert.ok(Array.isArray(fixture.events) && fixture.events.length, `${fixture.name}: has input events`);
    assert.equal(typeof fixture.expected, "object", `${fixture.name}: has an expected state`);
    const serialized = JSON.stringify(fixture.expected);
    for (const field of doc.ignoreFields) {
      assert.ok(!serialized.includes(`"${field}"`), `${fixture.name}: expected state omits volatile '${field}'`);
    }
  }
});

test("the five stream reducers still exist in streaming.js under their fixture names", () => {
  const source = fs.readFileSync(streamingJsPath, "utf8");
  for (const reducer of REDUCERS) {
    assert.ok(
      source.includes(`function ${reducer}(`),
      `public/js/streaming.js defines ${reducer} — if it moved or was renamed, update test/fixtures/stream-reducer-fixtures.json`
    );
  }
});

const fixtureDoc = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
for (const fixture of fixtureDoc.fixtures) {
  test(`replay: ${fixture.name}`, () => {
    const reducer = reducers[fixture.reducer];
    assert.equal(typeof reducer, "function", `${fixture.reducer} is exported from createStreamReducer`);
    const state = structuredClone(fixture.initial);
    for (const event of fixture.events) {
      reducer(state, event);
    }
    const ignoreFields = fixture.ignoreFields || fixtureDoc.ignoreFields;
    assert.deepEqual(
      stripIgnoredFields(state, ignoreFields),
      stripIgnoredFields(fixture.expected, ignoreFields)
    );
  });
}

test("response:reset keeps every mini-reasoning chunk through tool work and clears them at final-answer start", () => {
  const message = {
    id: "local_assistant_1",
    role: "assistant",
    content: "",
    reasoning: "",
    toolCalls: []
  };

  reducers.applyStreamEvent(message, { choices: [{ delta: { content: "I will search first.\n" } }] });
  reducers.applyStreamEvent(message, { choices: [{ delta: { content: "I found one lead.\n" } }] });
  reducers.applyStreamEvent(message, {
    choices: [{
      delta: {
        content: "I will check one more source.",
        tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "web_search", arguments: '{"query":"latest"}' } }]
      },
      finish_reason: "tool_calls"
    }]
  });
  reducers.applyStreamEvent(message, { type: "response:reset" });
  reducers.applyStreamEvent(message, {
    type: "tool:start",
    toolCallId: "call_1",
    name: "web_search",
    arguments: '{"query":"latest"}'
  });

  assert.equal(message.content, "I will search first.\nI found one lead.\nI will check one more source.");
  assert.equal(message.resetContentOnNextTextDelta, true);

  reducers.applyStreamEvent(message, {
    choices: [{ delta: { content: "Here is what I found." } }]
  });

  assert.equal(message.content, "Here is what I found.");
  assert.equal(message.resetContentOnNextTextDelta, undefined);
});

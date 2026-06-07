import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateBordaCount,
  buildChairmanPrompt,
  buildPeerReviewPrompt,
  buildReviewerAssignments,
  COUNCIL_STAGE1_SYSTEM_PROMPT,
  generateNonce,
  parseRanking,
  selectChairman,
  withCouncilSystemPrompt
} from "../server/saas/council.js";
import { filterCouncilHistory } from "../server/saas/messages.js";

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

test("buildReviewerAssignments excludes self and produces unique nonces per reviewer", () => {
  const panelists = [
    { modelId: "alpha", responseText: "Answer alpha." },
    { modelId: "beta", responseText: "Answer beta." },
    { modelId: "gamma", responseText: "Answer gamma." }
  ];
  const assignments = buildReviewerAssignments(panelists);

  assert.equal(assignments.length, 3);
  for (const assignment of assignments) {
    assert.equal(assignment.labels.length, panelists.length - 1, "reviewer sees N-1 responses");
    const reviewedIds = assignment.labels.map((l) => l.modelId);
    assert.ok(!reviewedIds.includes(assignment.reviewerModelId), "reviewer never sees its own response");
    const nonces = Object.keys(assignment.nonceToModelId);
    assert.equal(nonces.length, new Set(nonces).size, "nonces unique within a ballot");
  }

  // Anti-bias: nonce sets differ between reviewers (extremely unlikely to collide otherwise)
  const reviewerANonces = new Set(Object.keys(assignments[0].nonceToModelId));
  const reviewerBNonces = new Set(Object.keys(assignments[1].nonceToModelId));
  assert.notDeepEqual([...reviewerANonces].sort(), [...reviewerBNonces].sort(), "nonces differ per reviewer");
});

test("buildPeerReviewPrompt wraps each response in its nonce tag", () => {
  const prompt = buildPeerReviewPrompt({
    originalUserPrompt: "What is 2+2?",
    labels: [
      { responseNonce: "deadbeef", responseText: "Four.", letter: "A", modelId: "x" },
      { responseNonce: "feedface", responseText: "Five.", letter: "B", modelId: "y" }
    ]
  });
  assert.match(prompt, /<response-deadbeef>\s*Four\.\s*<\/response-deadbeef>/);
  assert.match(prompt, /<response-feedface>\s*Five\.\s*<\/response-feedface>/);
  assert.match(prompt, /RANKING:/);
  assert.match(prompt, /What is 2\+2\?/);
});

test("parseRanking extracts ordered modelIds from a well-formed ballot", () => {
  const raw = `RANKING:
1. response-deadbeef — clearest reasoning and complete answer.
2. response-feedface — partially correct but glosses over the calculation.
3. response-abcdef01 — confidently wrong.`;
  const parsed = parseRanking(raw, {
    deadbeef: "alpha",
    feedface: "beta",
    abcdef01: "gamma"
  });

  assert.ok(parsed, "well-formed output parses");
  assert.deepEqual(parsed.ranking, ["alpha", "beta", "gamma"]);
  assert.equal(parsed.justifications.alpha, "clearest reasoning and complete answer.");
  assert.equal(parsed.justifications.beta, "partially correct but glosses over the calculation.");
});

test("parseRanking does not persist placeholder reason text", () => {
  const raw = `RANKING:
1. response-deadbeef — <reason>
2. response-feedface — actually useful note.`;
  const parsed = parseRanking(raw, {
    deadbeef: "alpha",
    feedface: "beta"
  });

  assert.ok(parsed);
  assert.deepEqual(parsed.ranking, ["alpha", "beta"]);
  assert.equal(parsed.justifications.alpha, undefined);
  assert.equal(parsed.justifications.beta, "actually useful note.");
});

test("parseRanking returns null when the output has no RANKING: header", () => {
  const raw = "I think response A is best. Response B is OK.";
  assert.equal(parseRanking(raw, { aaaa: "alpha" }), null);
});

test("parseRanking tolerates 1) numbering and stray text", () => {
  const raw = `Some preamble that should not break parsing.

RANKING:
1) response-aaaa - top response, very clear.
2) response-bbbb - decent attempt.

Trailing notes I want to ignore.`;
  const parsed = parseRanking(raw, { aaaa: "alpha", bbbb: "beta" });
  assert.ok(parsed);
  assert.deepEqual(parsed.ranking, ["alpha", "beta"]);
});

test("parseRanking skips unknown nonces and duplicates", () => {
  const raw = `RANKING:
1. response-aaaa — first place.
2. response-aaaa — accidental duplicate.
3. response-cccc — unknown nonce, ignored.
4. response-bbbb — runner up.`;
  const parsed = parseRanking(raw, { aaaa: "alpha", bbbb: "beta" });
  assert.ok(parsed);
  assert.deepEqual(parsed.ranking, ["alpha", "beta"]);
});

test("aggregateBordaCount computes mean Borda points per model", () => {
  // 3 models, 3 ballots
  // Each ballot gives top rank (n-1)=2 points, mid 1, last 0
  const ballots = [
    { ranking: ["a", "b", "c"] },
    { ranking: ["a", "c", "b"] },
    { ranking: ["b", "a", "c"] }
  ];
  const borda = aggregateBordaCount(ballots, ["a", "b", "c"]);

  const a = borda.find((row) => row.modelId === "a");
  const b = borda.find((row) => row.modelId === "b");
  const c = borda.find((row) => row.modelId === "c");

  // a: 2 + 2 + 1 = 5, mean 5/3 ≈ 1.67
  // b: 1 + 0 + 2 = 3, mean 1.0
  // c: 0 + 1 + 0 = 1, mean 1/3 ≈ 0.33
  assert.equal(borda[0].modelId, "a");
  assert.equal(borda[1].modelId, "b");
  assert.equal(borda[2].modelId, "c");
  assert.ok(Math.abs(a.bordaScore - 5 / 3) < 1e-6);
  assert.equal(b.bordaScore, 1);
  assert.ok(Math.abs(c.bordaScore - 1 / 3) < 1e-6);
  assert.equal(a.rank, 1);
  assert.equal(b.rank, 2);
  assert.equal(c.rank, 3);
});

test("aggregateBordaCount ignores invalid/empty ballots gracefully", () => {
  const borda = aggregateBordaCount([
    { ranking: ["a", "b"] },
    { ranking: [] },
    null,
    { ranking: ["b", "a"] }
  ], ["a", "b"]);

  // Two valid ballots; each ranks both models, so ballotCount is 2 for each.
  // a: 1 (rank 0) + 0 (rank 1) = 1 → mean 0.5
  // b: 0 (rank 1) + 1 (rank 0) = 1 → mean 0.5
  const a = borda.find((row) => row.modelId === "a");
  const b = borda.find((row) => row.modelId === "b");
  assert.equal(a.ballotCount, 2);
  assert.equal(b.ballotCount, 2);
  assert.equal(a.bordaScore, 0.5);
  assert.equal(b.bordaScore, 0.5);
});

test("aggregateBordaCount handles a model that received zero ballots", () => {
  const borda = aggregateBordaCount([{ ranking: ["a", "b"] }], ["a", "b", "c"]);
  const c = borda.find((row) => row.modelId === "c");
  assert.equal(c.ballotCount, 0);
  assert.equal(c.bordaScore, 0);
});

test("selectChairman prefers an explicit override that is on the panel", () => {
  const panelists = [{ modelId: "alpha" }, { modelId: "beta" }];
  const chairman = selectChairman({
    override: "beta",
    borda: [],
    panelists
  });
  assert.equal(chairman, "beta");
});

test("selectChairman falls back to the Borda winner when no override is given", () => {
  const panelists = [{ modelId: "alpha" }, { modelId: "beta" }];
  const chairman = selectChairman({
    borda: [
      { modelId: "beta", bordaScore: 1.5, ballotCount: 1 },
      { modelId: "alpha", bordaScore: 0.5, ballotCount: 1 }
    ],
    panelists
  });
  assert.equal(chairman, "beta");
});

test("selectChairman falls back to the user's preferred model when Borda is empty", () => {
  const panelists = [{ modelId: "alpha" }, { modelId: "beta" }];
  const chairman = selectChairman({
    borda: [
      { modelId: "alpha", bordaScore: 0, ballotCount: 0 },
      { modelId: "beta", bordaScore: 0, ballotCount: 0 }
    ],
    defaultModel: "alpha",
    panelists
  });
  assert.equal(chairman, "alpha");
});

test("selectChairman returns the first panelist when nothing else applies", () => {
  const panelists = [{ modelId: "alpha" }, { modelId: "beta" }];
  const chairman = selectChairman({ borda: [], panelists });
  assert.equal(chairman, "alpha");
});

test("buildChairmanPrompt embeds the original question, ranked responses, and synthesis rules", () => {
  const prompt = buildChairmanPrompt({
    originalUserPrompt: "Capital of France?",
    panelists: [
      { modelId: "alpha", responseText: "Paris." },
      { modelId: "beta", responseText: "Lyon." }
    ],
    borda: [
      { modelId: "alpha", bordaScore: 1, ballotCount: 1, rank: 1 },
      { modelId: "beta", bordaScore: 0, ballotCount: 1, rank: 2 }
    ]
  });

  assert.match(prompt, /Capital of France\?/);
  assert.match(prompt, /\[RANK 1.*\]\s*\nParis\./);
  assert.match(prompt, /\[RANK 2.*\]\s*\nLyon\./);
  assert.match(prompt, /Chairman of an AI council/);
  assert.match(prompt, /Be authoritative/);
  // The chairman should be reminded NOT to write meta-commentary
  assert.match(prompt, /Do not say "Response A said/);
});

test("buildChairmanPrompt gracefully degrades when peer review failed (no borda)", () => {
  const prompt = buildChairmanPrompt({
    originalUserPrompt: "Hello?",
    panelists: [
      { modelId: "alpha", responseText: "Hi." },
      { modelId: "beta", responseText: "Hey." }
    ],
    borda: []
  });

  assert.match(prompt, /could not produce reliable peer rankings/i);
  assert.match(prompt, /\[RANK 1.*Hi\./s);
  assert.match(prompt, /\[RANK 2.*Hey\./s);
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

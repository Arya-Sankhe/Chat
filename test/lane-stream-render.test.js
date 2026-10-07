import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createStreamReducer } from "../public/js/streaming.js";
import { createCompareController } from "../public/js/compare.js";
import { createCouncilController } from "../public/js/council.js";
import { extractReasoningDelta } from "../public/js/reasoning.js";

const app = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
function functionSource(name) {
  const start = app.indexOf(`function ${name}(`);
  return app.slice(start, app.indexOf("\n}\n", start) + 3);
}
const reducer = createStreamReducer({
  isAdminUser: () => true,
  mergeArtifacts() {},
  markActivityStarted(message) { message.activityStartedAt ||= 1; },
  markActivityEnded(message) { message.activityEndedAt = 2; },
  markReasoningStarted(message) { message.reasoningStartedAt ||= 1; },
  markReasoningEnded(message) { message.reasoningEndedAt = 2; },
  normalizeClientUsage: (usage) => usage,
  stripLeakedReasoningMarkup: (text) => text,
  stripLeakedToolMarkup: (text) => text,
  isFinalFinishReason: (reason) => Boolean(reason && reason !== "tool_calls"),
  isPlaceholderPeerReason: () => false
});

for (const council of [false, true]) {
  test(`${council ? "council" : "compare"} lifecycle events preserve sibling thinking surfaces and rekey starts`, () => {
    const lanes = [0, 1].map((i) => ({ id: `local_${i}`, content: "", reasoning: "", toolCalls: [] }));
    const group = council ? { panelists: lanes } : { compareResponses: lanes };
    const article = {};
    const surfaces = lanes.map((lane) => ({
      dataset: { messageId: lane.id },
      closest: () => article,
      querySelector: () => null
    }));
    const calls = { full: 0, patches: 0, renders: [] };
    const patch = (node, value, options) => {
      assert.equal(node, article);
      assert.equal(options.streaming, true);
      if (value.chairman && !surfaces.some((surface) => surface.dataset.messageId === value.chairman.id)) {
        surfaces.push({ dataset: { messageId: value.chairman.id }, closest: () => article, querySelector: () => null });
      }
      calls.patches++;
      return true;
    };
    const context = {
      ...reducer,
      els: { messages: { querySelector(selector) {
        const id = selector.match(/data-message-id="(.*)"/)[1];
        return surfaces.find((surface) => surface.dataset.messageId === id);
      } } },
      cssString: String,
      preserveMessageScroll: (fn) => fn(),
      isRunKeyActive: () => true,
      compareController: { patchCompareMessage: patch },
      councilController: { patchCouncilMessage: patch },
      hydrateKluiBars() {},
      queueRenderMessages() { calls.full++; },
      queueStreamingMessageRender(message) { calls.renders.push(message.id); },
      queueLaneStreamRender(message) { calls.renders.push(message.id); }
    };
    runInNewContext(functionSource("applyLaneStreamEvent"), context);
    const events = [
      ...(council ? [{ type: "council:start", sessionId: "session" }] : []),
      { type: "start", index: 0, assistantMessageId: "server_0" },
      { type: "start", index: 1, assistantMessageId: "server_1" },
      { type: "delta", index: 0, event: { choices: [{ delta: { content: "Answer" } }] } },
      { type: "done", index: 0 },
      { type: "error", index: 1, error: "Failed" },
      ...(council ? [
        { type: "council:peer:start" },
        { type: "council:peer:done", borda: [] },
        { type: "council:chairman:start", assistantMessageId: "chair" },
        { type: "council:chairman:done" }
      ] : [])
    ];
    for (const event of events) context.applyLaneStreamEvent(group, event, council, "run");
    assert.equal(calls.full, 0);
    assert.deepEqual(surfaces.slice(0, 2).map((surface) => surface.dataset.messageId), ["server_0", "server_1"]);
    assert.ok(calls.patches >= 4);
    assert.ok(calls.renders.includes("server_0"));
    assert.equal(lanes[1].error, "Failed");
  });
}

test("streaming compare metadata patch leaves every thinking node mounted", () => {
  let removals = 0;
  const bar = { remove() { removals++; } };
  const lane = {
    dataset: { rawText: "previous" },
    querySelectorAll: () => [bar],
    querySelector: () => null,
    insertAdjacentHTML() {}
  };
  const article = {
    classList: { contains: () => true },
    querySelectorAll: () => [lane],
    querySelector: () => ({ querySelector: () => null })
  };
  const controller = createCompareController({
    normalizeMessage: (msg) => msg,
    rawTextContent: String,
    renderCitations: () => ""
  });
  assert.equal(controller.patchCompareMessage(article, [{ id: "server", content: "" }], { streaming: true }), true);
  assert.equal(removals, 0);
  assert.equal(lane.dataset.rawText, "previous", "metadata patch must not advance the text-render baseline");
});

test("council stage patch updates the existing progress bar instead of restarting it", () => {
  const bar = {};
  const steps = {};
  const track = { style: {} };
  const progress = {
    querySelector: (selector) => ({ ".klui-bar": bar, ".council-progress-steps": steps, ".council-progress-track > span": track })[selector],
    set outerHTML(_) { assert.fail("live progress bar remounted"); }
  };
  const synthesis = { querySelector: () => null };
  const article = {
    classList: { contains: () => true },
    querySelectorAll: () => [],
    querySelector: (selector) => ({
      ":scope .council-progress": progress,
      ".council-details-body": { querySelector: () => null },
      ".council-synthesis": synthesis
    })[selector] || null
  };
  const updates = [];
  const controller = createCouncilController({
    DEFAULT_COUNCIL_MODELS: ["a", "b"],
    escapeHtml: String,
    updateKluiBar(node, options) { updates.push([node, options.label]); }
  });
  for (const council of [
    { panelists: [], stage1Status: "active" },
    { panelists: [], stage1Status: "done", stage2Status: "active" },
    { panelists: [], stage1Status: "done", stage2Status: "done", stage3Status: "active" }
  ]) assert.equal(controller.patchCouncilMessage(article, council, { streaming: true }), true);
  assert.deepEqual(updates.map(([node]) => node), [bar, bar, bar]);
  assert.equal(updates[1][1], "The judge is ranking the answers");
  assert.equal(track.style.width, "88%");
});

test("admin reasoning deltas patch the open panel, without inserting a Klui bar", () => {
  const summary = { textContent: "" };
  const body = { innerHTML: "" };
  const reasoning = {
    open: true,
    classList: { toggle() {} },
    querySelector: (selector) => selector === "summary" ? summary : body
  };
  const content = {
    querySelector: (selector) => selector === "details.reasoning" ? reasoning : null,
    insertAdjacentHTML() { assert.fail("admin reasoning must not gain a Klui bar"); }
  };
  const context = {
    state: { settings: { showModelReasoning: true } },
    els: { messages: { querySelector: () => ({ querySelector: () => content }) } },
    cssString: String, rawTextContent: String,
    isAdminUser: () => true,
    isStoppedMessage: () => false,
    isVisualizeRepairing: () => false,
    isAssistantMessageStreaming: () => true,
    isFinalFinishReason: () => false,
    reasoningSummaryLabel: () => "Thinking",
    renderContent: (text) => `<p>${text}</p>`,
    extractReasoningDelta,
    queueStreamingMessageRender() { assert.fail("thinking panel should patch immediately"); }
  };
  runInNewContext(["isStreamDeltaEvent", "patchReasoningInPlace", "patchKluiThinkingInPlace", "queueLaneStreamRender"].map(functionSource).join("\n"), context);
  const message = { id: "lane", content: "", reasoning: "", toolCalls: [] };
  for (const text of ["First", " second"]) {
    const event = { type: "delta", event: { choices: [{ delta: { reasoning_content: text } }] } };
    reducer.applyStreamEvent(message, event.event);
    context.queueLaneStreamRender(message, event);
  }
  assert.equal(body.innerHTML, "<p>First second</p>");
  assert.equal(summary.textContent, "Thinking");
  assert.equal(reasoning.open, true);
});

test("answer deltas leave an admin reasoning panel mounted and open", () => {
  const reasoning = { open: true };
  const content = {
    childNodes: [reasoning],
    querySelector: (selector) => selector === "details.reasoning" ? reasoning : null,
    replaceChildren() { assert.fail("reasoning panel remounted while answer streams"); },
    append(...nodes) { this.childNodes.push(...nodes); }
  };
  const surface = { dataset: { rawText: "" }, querySelector: () => content };
  let patches = 0;
  const context = {
    els: { messages: { querySelector: () => surface } },
    cssString: String, rawTextContent: String, stripOpenEmailFence: String,
    captureReasoningOpenState() {},
    preserveMessageScroll: (fn) => fn(),
    isStoppedMessage: () => false,
    isProvisionalToolProse: () => false,
    document: { createElement() {
      const tmp = { childNodes: [], querySelector: (selector) => selector === "details.reasoning" ? nextReasoning : null };
      const nextReasoning = { remove() { tmp.childNodes.splice(tmp.childNodes.indexOf(this), 1); } };
      const answer = { remove() { content.childNodes.splice(content.childNodes.indexOf(this), 1); } };
      tmp.childNodes.push(nextReasoning, answer);
      return tmp;
    } },
    renderAssistantMessageContent: () => "",
    adoptUnchangedTableScrolls() {}, adoptLiveEmailCards() {},
    adoptLiveVisualizeFrame: () => false, adoptLiveVisualizeBuilding: () => false,
    collapseExpandedVisualize() {}, hydrateKluiBars() {},
    patchReasoningInPlace(node) { assert.equal(node, reasoning); patches++; },
    animateNewestStreamingText() {}, syncPendingArtifactPolls() {}, renderContextMeter() {}
  };
  runInNewContext(functionSource("renderStreamingMessageSurface"), context);
  for (const text of ["Hello", "Hello world"]) {
    assert.equal(context.renderStreamingMessageSurface({ id: "lane", content: text }), true);
    assert.equal(content.childNodes[0], reasoning);
  }
  assert.equal(patches, 2);
  assert.equal(reasoning.open, true);
});

test("hidden empty lane deltas do not render, but tool activity still patches", () => {
  let patches = 0;
  const context = {
    extractReasoningDelta,
    patchKluiThinkingInPlace() { patches++; return true; },
    queueStreamingMessageRender() { assert.fail("thinking bar should stay mounted"); }
  };
  runInNewContext(["isStreamDeltaEvent", "queueLaneStreamRender"].map(functionSource).join("\n"), context);
  const message = { id: "lane", content: "" };
  context.queueLaneStreamRender(message, { type: "delta", event: { choices: [{ delta: {} }] } });
  assert.equal(patches, 0);
  context.queueLaneStreamRender(message, { type: "delta", event: { type: "tool:start", name: "web_search" } });
  assert.equal(patches, 1);
});

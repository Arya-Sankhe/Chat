import assert from "node:assert/strict";
import test from "node:test";

import { reconcilePendingTurnMessages } from "../public/js/pendingTurns.js";
import { startPendingTurnHeartbeat } from "../server/chat/turns.js";

test("pending single resume reuses its persisted assistant slot", () => {
  const assistant = { id: "local", role: "assistant", content: "", reasoning: "", toolCalls: [] };
  const messages = [
    { id: "user", role: "user", content: "Question" },
    {
      id: "persisted",
      role: "assistant",
      turn_run_id: "turn-1",
      output_slot: "single",
      content: "Partial",
      error: "Stopped by user."
    }
  ];

  const reconciled = reconcilePendingTurnMessages(messages, "turn-1", assistant);
  assert.equal(reconciled.length, 2);
  assert.equal(reconciled[1], assistant);
  assert.equal(assistant.id, "persisted");
  assert.equal(assistant.content, "Partial");
  assert.equal(assistant.error, undefined);
});

test("pending compare resume replaces placeholders without duplicating persisted rows", () => {
  const assistant = {
    id: "local-group",
    role: "assistant",
    compareGroup: true,
    compareResponses: [
      { id: "local-0", model: "model-a", content: "" },
      { id: "local-1", model: "model-b", content: "" }
    ]
  };
  const messages = [
    { id: "user", role: "user", content: "Question" },
    { id: "panel-0", role: "assistant", turn_run_id: "turn-1", output_slot: "compare:0", content: "A" },
    { id: "panel-1", role: "assistant", turn_run_id: "turn-1", output_slot: "compare:1", content: "B" }
  ];

  const reconciled = reconcilePendingTurnMessages(messages, "turn-1", assistant);
  assert.equal(reconciled.length, 2);
  assert.equal(reconciled[1], assistant);
  assert.deepEqual(assistant.compareResponses.map((entry) => entry.id), ["panel-0", "panel-1"]);
});

test("pending council resume restores panel and chairman slots into one shell", () => {
  const assistant = {
    id: "local-council",
    role: "assistant",
    councilGroup: true,
    panelists: [{ id: "local-panel", content: "" }],
    chairman: null
  };
  const messages = [
    { id: "user", role: "user", content: "Question" },
    { id: "panel", role: "assistant", turn_run_id: "turn-1", output_slot: "panel:0", content: "Panel" },
    { id: "chair", role: "assistant", turn_run_id: "turn-1", output_slot: "chairman", content: "Synthesis" }
  ];

  const reconciled = reconcilePendingTurnMessages(messages, "turn-1", assistant);
  assert.equal(reconciled.length, 2);
  assert.equal(assistant.panelists[0].id, "panel");
  assert.equal(assistant.chairman.id, "chair");
});

test("pending turn heartbeat aborts before an unrenewed lease can expire", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalDateNow = Date.now;
  let tick = null;
  let now = 1_000;
  globalThis.setInterval = (callback) => {
    tick = callback;
    return { unref() {} };
  };
  globalThis.clearInterval = () => {};
  Date.now = () => now;

  try {
    const controller = new AbortController();
    const stop = startPendingTurnHeartbeat({
      db: { async heartbeatPendingDocumentTurn() { throw new Error("database unavailable"); } },
      userId: "user-1",
      run: { id: "turn-1", claim_token: "claim-1" },
      controller
    });
    assert.equal(typeof tick, "function");
    now += 90_000;
    await tick();
    assert.equal(controller.signal.aborted, true);
    stop();
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    Date.now = originalDateNow;
  }
});

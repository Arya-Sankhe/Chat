import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const appJs = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
const functions = ["updateSendButton", "setVoiceState", "finishVoiceRecording", "stopVoiceRecording", "toggleVoiceRecording", "sendPrompt"]
  .map((name) => {
    const source = appJs.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}(?=\\n|$)`))?.[0];
    assert.ok(source, `${name} not found`);
    return source;
  }).join("\n");
const listeners = appJs.slice(
  appJs.indexOf('  els.sendButton.addEventListener("pointerdown"'),
  appJs.indexOf('  els.clarificationCard?.addEventListener("click"')
);

function composer({ native = true } = {}) {
  const classes = new Set();
  const handlers = {};
  const sendButton = {
    disabled: false,
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
    },
    setAttribute() {},
    addEventListener(type, handler) { handlers[type] = handler; },
    click() { if (!this.disabled) handlers.click({ detail: 0 }); },
  };
  const ctx = {
    Blob, Event,
    voiceState: "idle", voiceChunks: [], voiceCommit: true, voiceStream: null, voiceRecorder: null,
    state: { running: true, clarificationChecking: false, images: [], followUps: [], config: { services: { speech: true } } },
    els: {
      sendButton,
      promptInput: {
        focus() {}, blur() {},
        dispatchEvent(event) { assert.equal(event.type, "input"); ctx.inputs += 1; ctx.updateSendButton(); },
      },
    },
    document: { body: { classList: { contains: () => native } } },
    text: "", inputs: 0, stops: 0, sends: 0, transcriptions: 0, clarifications: 0,
    composerPlainText: () => ctx.text,
    composerSkillMarks: () => [],
    composerSnapshot: () => ({ text: ctx.text, marks: [] }),
    setComposerPlainText: (text) => { ctx.text = text; },
    pendingDocumentUploads: () => [],
    syncComposerBeam() {}, hideAttachmentModelNotice() {}, hideNativeKeyboard() {},
    requireAuth: () => true,
    addFollowUpFromInput: () => { ctx.sends += 1; },
    continueClarification: () => { ctx.clarifications += 1; },
    voiceRecordingWav: async (blob) => blob,
    transcribeSpeech: async () => { ctx.transcriptions += 1; return { transcript: "spoken text" }; },
    showToast(message) { assert.fail(message); },
  };
  runInNewContext(`${functions}\n${listeners}`, ctx);
  return {
    ctx, classes, sendButton,
    pointer(options = {}) {
      const event = { button: 0, isPrimary: true, prevented: false, preventDefault() { this.prevented = true; }, ...options };
      handlers.pointerdown(event);
      return event;
    },
    click(detail = 1) { handlers.click({ detail }); },
    record() {
      ctx.voiceChunks = [new Blob(["audio"], { type: "audio/wav" })];
      ctx.voiceRecorder = { state: "recording", stop() { ctx.stops += 1; } };
      ctx.setVoiceState("recording");
    },
  };
}

test("native confirmation stops on the first pointerdown and never sends its fast transcript", async () => {
  const c = composer();
  c.ctx.state.running = false;
  c.ctx.updateSendButton();
  assert.equal(c.classes.has("active"), false, "an empty composer remains visually inactive");
  c.record();
  assert.equal(c.pointer().prevented, true);
  assert.equal(c.ctx.stops, 1);
  assert.equal(c.ctx.voiceState, "processing");
  c.click();
  assert.equal(c.ctx.stops, 1);
  await c.ctx.finishVoiceRecording();
  assert.equal(c.ctx.voiceState, "idle");
  assert.equal(c.ctx.text, "spoken text");
  assert.equal(c.ctx.inputs, 1);
  assert.equal(c.sendButton.disabled, false);
  assert.equal(c.classes.has("active"), true, "transcript activates Send without another edit");
  assert.equal(c.classes.has("is-voice-confirm"), false);
  c.click();
  assert.equal(c.ctx.sends, 0, "even a click after transcription must not send");
  c.ctx.state.running = true;
  c.pointer();
  c.click();
  assert.equal(c.ctx.sends, 1, "a new gesture sends exactly once");
});

test("a missing compatibility click cannot suppress later recording or keyboard activation", async () => {
  const c = composer();
  c.ctx.text = "previous message";
  c.pointer(); // Sending can hide the button before its compatibility click arrives.
  assert.equal(c.ctx.sends, 1);
  c.record();
  c.pointer();
  c.click();
  assert.equal(c.ctx.stops, 1);
  await c.ctx.finishVoiceRecording();
  c.pointer(); // Another missing click must not swallow keyboard/AT activation.
  c.record();
  c.click(0);
  assert.equal(c.ctx.stops, 2);
  await c.ctx.finishVoiceRecording();
  const sends = c.ctx.sends;
  c.click(0);
  assert.equal(c.ctx.sends, sends + 1);
});

test("disabled, processing, secondary-button and non-primary pointers do nothing", () => {
  const c = composer();
  c.record();
  c.pointer({ button: 2 });
  c.pointer({ isPrimary: false });
  assert.equal(c.ctx.stops, 0);
  c.sendButton.disabled = true;
  c.pointer();
  c.click(0);
  assert.equal(c.ctx.stops, 0);
  c.ctx.setVoiceState("processing");
  c.sendButton.disabled = false; // The state guard also protects click-only activation.
  c.pointer();
  c.click(0);
  assert.equal(c.ctx.stops, 0);
  assert.equal(c.ctx.sends, 0);
});

test("desktop clicks, clarification ordering, and voice cancellation keep their semantics", async () => {
  const c = composer({ native: false });
  c.record();
  c.ctx.state.clarification = {};
  await c.ctx.sendPrompt();
  assert.equal(c.ctx.clarifications, 1, "sendPrompt still handles clarification before recording");
  assert.equal(c.ctx.stops, 0);
  assert.equal(c.pointer().prevented, false);
  c.click();
  assert.equal(c.ctx.stops, 1, "the explicit confirm button still bypasses clarification");
  await c.ctx.finishVoiceRecording();
  c.ctx.state.clarification = null;
  c.click();
  assert.equal(c.ctx.sends, 1);
  c.record();
  c.ctx.toggleVoiceRecording();
  assert.equal(c.ctx.voiceCommit, false);
  await c.ctx.finishVoiceRecording();
  assert.equal(c.ctx.transcriptions, 1, "cancel does not transcribe");
  assert.equal(c.ctx.sends, 1);
});

test("native generic hover and press backgrounds cannot override the send accent", () => {
  const css = readFileSync(new URL("../public/styles/mobile.css", import.meta.url), "utf8");
  for (const [, selectors, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/body\.capacitor-native \.send-btn:(?:hover|active)/.test(selectors)) {
      assert.doesNotMatch(declarations, /background\s*:/, selectors.trim());
    }
  }
  assert.match(css, /body\.capacitor-native \.send-btn:active,[^{}]*\{\s*transform: scale\(0\.94\)/);
});

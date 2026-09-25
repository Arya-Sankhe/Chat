import assert from "node:assert/strict";
import test from "node:test";

import { normalizeVoiceModeSpeed, normalizeVoiceModeVoice, VOICE_MODE_VOICES } from "../server/speech/voices.js";
import { withVoiceReasoning } from "../server/chat/shared.js";
import { fastestHealthyThroughput, resetVoiceModeRoleCache, voiceModeRole } from "../server/providers.js";
import { VOICE_SYSTEM_PROMPT } from "../server/saas/systemPrompt.js";
import { existsSync } from "node:fs";
import { createSpeechChunker, normalizeVoiceSpeed, SPEECH_CHUNK_MAX_CHARS, splitForSpeech, spokenText, VOICE_OPTIONS, VOICE_SPEEDS, voicePreviewUrl } from "../public/js/voiceMode.js";
import { VOICE_SPEECH_MAX_CHARS } from "../server/routes/voice.js";

test("voice mode voices use abstract names and match on both sides", () => {
  assert.deepEqual(VOICE_OPTIONS.map(({ id, name }) => ({ id, name })), VOICE_MODE_VOICES);
  assert.equal(normalizeVoiceModeVoice("nope"), "af_heart");
  assert.equal(normalizeVoiceModeSpeed(9), 1.4);
  assert.equal(normalizeVoiceModeSpeed("x"), 1);
  assert.equal(normalizeVoiceSpeed(1.15), 1.15);
  assert.equal(normalizeVoiceSpeed(1.2), 1);
});

test("voice turns reason at low effort and use the short spoken prompt", () => {
  const request = withVoiceReasoning({ model: "m", reasoning_effort: "xhigh", reasoning: { enabled: false }, messages: [] });
  assert.deepEqual(request, { model: "m", messages: [], reasoning_effort: "low" });
  assert.match(VOICE_SYSTEM_PROMPT, /read aloud/);
  assert.match(VOICE_SYSTEM_PROMPT, /under about 60 words/);
});

test("the speech chunker starts early at a clause and keeps order", () => {
  const chunker = createSpeechChunker();
  const out = [];
  for (const piece of "Mount Everest is the tallest mountain on Earth, standing about 8,849 meters high above the sea. It sits in the Himalayas.".split(/(?<= )/)) {
    out.push(...chunker.push(piece));
  }
  out.push(...chunker.flush());
  assert.match(out[0], /^Mount Everest is the tallest mountain on Earth,$/);
  assert.equal(out.join(" ").replace(/\s+/g, " "), "Mount Everest is the tallest mountain on Earth, standing about 8,849 meters high above the sea. It sits in the Himalayas.");
});

test("spoken text drops markdown, code, and links", () => {
  assert.equal(spokenText("## Tips\n- **Sleep** early [guide](https://x.y)\n```js\ncode()\n```"), "Tips Sleep early guide");
});

test("speech pieces never exceed the speech endpoint limit", () => {
  assert.ok(SPEECH_CHUNK_MAX_CHARS < VOICE_SPEECH_MAX_CHARS);
  const run = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  const chunker = createSpeechChunker();
  const pieces = [...chunker.push(run), ...chunker.flush()].flatMap((chunk) => splitForSpeech(chunk));
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every((piece) => piece.length <= SPEECH_CHUNK_MAX_CHARS));
  assert.equal(pieces.join(" "), run, "splitting only cuts at spaces here");
  assert.ok(splitForSpeech("x".repeat(1500)).every((piece) => piece.length <= SPEECH_CHUNK_MAX_CHARS));
  assert.deepEqual(splitForSpeech("Short one."), ["Short one."]);
});

test("spoken replies drop citation markers", () => {
  assert.equal(spokenText("It is 72 degrees [1] in Paris [2, 3]."), "It is 72 degrees in Paris.");
});

test("every voice has a prerecorded preview at every speed", () => {
  assert.equal(voicePreviewUrl("af_bella", 1.15), "/audio/voice-mode/af_bella-115.mp3");
  assert.equal(voicePreviewUrl("nope", 9), "/audio/voice-mode/af_heart-100.mp3");
  for (const voice of VOICE_OPTIONS) {
    for (const { value } of VOICE_SPEEDS) {
      const file = new URL(`../public${voicePreviewUrl(voice.id, value)}`, import.meta.url);
      assert.ok(existsSync(file), `missing ${file.pathname}; run scripts/generate-voice-previews.mjs`);
    }
  }
});

test("voice mode uses Nitro only while its fastest healthy host is at 90+ tokens/sec", async () => {
  assert.equal(fastestHealthyThroughput([
    { tag: "novita", status: 0, throughput_last_30m: { p50: 117 } },
    { tag: "deepinfra", status: 0, throughput_last_30m: { p50: 44 } },
    { tag: "down", status: -2, throughput_last_30m: { p50: 400 } }
  ]), 117);
  const realFetch = globalThis.fetch;
  const run = async (reply) => {
    resetVoiceModeRoleCache();
    let url = "";
    globalThis.fetch = async (href) => {
      url = String(href);
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify({ data: { endpoints: reply } }), { status: 200 });
    };
    const role = await voiceModeRole({ apiKey: "k", baseUrl: "https://openrouter.test/api/v1" });
    return { role, url };
  };
  try {
    const fast = await run([{ status: 0, throughput_last_30m: { p50: 90 } }]);
    assert.deepEqual(fast, { role: "nitro", url: "https://openrouter.test/api/v1/models/inclusionai/ling-3.0-flash/endpoints" });
    assert.equal((await run([{ status: 0, throughput_last_30m: { p50: 89 } }])).role, "think");
    assert.equal((await run([{ status: 1, throughput_last_30m: { p50: 200 } }])).role, "think", "a degraded host does not count");
    assert.equal((await run(new Error("offline"))).role, "think", "no reading falls back to Think");
  } finally {
    globalThis.fetch = realFetch;
    resetVoiceModeRoleCache();
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { normalizeVoiceModeSpeed, normalizeVoiceModeVoice, VOICE_MODE_VOICES } from "../server/speech/voices.js";
import { withoutReasoning } from "../server/chat/shared.js";
import { VOICE_SYSTEM_PROMPT } from "../server/saas/systemPrompt.js";
import { createSpeechChunker, normalizeVoiceSpeed, spokenText, VOICE_OPTIONS } from "../public/js/voiceMode.js";

test("voice mode voices use abstract names and match on both sides", () => {
  assert.deepEqual(VOICE_OPTIONS.map(({ id, name }) => ({ id, name })), VOICE_MODE_VOICES);
  assert.equal(normalizeVoiceModeVoice("nope"), "af_heart");
  assert.equal(normalizeVoiceModeSpeed(9), 1.4);
  assert.equal(normalizeVoiceModeSpeed("x"), 1);
  assert.equal(normalizeVoiceSpeed(1.15), 1.15);
  assert.equal(normalizeVoiceSpeed(1.2), 1);
});

test("voice turns skip reasoning and use the short spoken prompt", () => {
  const request = withoutReasoning({ model: "m", reasoning_effort: "xhigh", messages: [] });
  assert.deepEqual(request, { model: "m", messages: [], reasoning: { enabled: false } });
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

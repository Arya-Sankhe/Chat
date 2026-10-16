import assert from "node:assert/strict";
import test from "node:test";

import { normalizeVoiceModeSpeed, normalizeVoiceModeVoice, VOICE_MODE_VOICES } from "../server/speech/voices.js";
import { withVoiceReasoning } from "../server/chat/shared.js";
import { adaptChatRequestForProvider } from "../server/providers.js";
import { VOICE_SYSTEM_PROMPT } from "../server/saas/systemPrompt.js";
import { existsSync } from "node:fs";
import { createSpeechChunker, normalizeVoiceSpeed, SPEECH_CHUNK_MAX_CHARS, splitForSpeech, spokenText, toolUpdate, VOICE_OPTIONS, VOICE_SPEEDS, voicePreviewUrl } from "../public/js/voiceMode.js";
import { VOICE_SPEECH_MAX_CHARS } from "../server/routes/voice.js";

test("voice mode voices use abstract names and match on both sides", () => {
  assert.deepEqual(VOICE_OPTIONS.map(({ id, name }) => ({ id, name })), VOICE_MODE_VOICES);
  assert.equal(normalizeVoiceModeVoice("nope"), "af_heart");
  assert.equal(normalizeVoiceModeSpeed(9), 1.4);
  assert.equal(normalizeVoiceModeSpeed("x"), 1);
  assert.equal(normalizeVoiceSpeed(1.15), 1.15);
  assert.equal(normalizeVoiceSpeed(1.2), 1);
});

test("voice turns skip reasoning and use the short spoken prompt", () => {
  const request = withVoiceReasoning({ model: "deepseek/deepseek-v4-flash-0731", reasoning_effort: "xhigh", messages: [] });
  assert.deepEqual(request, { model: "deepseek/deepseek-v4-flash-0731", messages: [], reasoning: { enabled: false } });
  assert.deepEqual(adaptChatRequestForProvider(request, "openrouter").reasoning, { enabled: false }, "OpenRouter gets reasoning off");
  assert.match(VOICE_SYSTEM_PROMPT, /read aloud/);
  assert.match(VOICE_SYSTEM_PROMPT, /under about 60 words/);
  assert.match(VOICE_SYSTEM_PROMPT, /Before your first tool call, say one short, natural line/);
});

test("voice mode uses Mercury and falls back to Think's model on OpenRouter", () => {
  const adapted = adaptChatRequestForProvider(withVoiceReasoning({ model: "inception/mercury-2.5", messages: [] }), "openrouter");
  assert.deepEqual(adapted.models, ["inception/mercury-2.5", "deepseek/deepseek-v4-flash-0731"]);
  assert.deepEqual(adapted.reasoning, { enabled: false });
});

test("a tool started without a spoken line gets a short update that fits the tool", () => {
  assert.equal(toolUpdate("web_search", 0), "Let me look that up.");
  assert.equal(toolUpdate("get_weather", 0), "Let me check the weather.");
  assert.equal(toolUpdate("read_url", 0.99), "One sec, reading that.");
  assert.equal(toolUpdate("load_tools", 0), "One sec, working on that.");
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

test("every voice has a prerecorded preview at every speed on both engines", () => {
  assert.equal(voicePreviewUrl("af_bella", 1.15), "/audio/voice-mode/pocket/af_bella-115.mp3");
  assert.equal(voicePreviewUrl("af_bella", 1.15, "kokoro"), "/audio/voice-mode/af_bella-115.mp3");
  assert.equal(voicePreviewUrl("nope", 9), "/audio/voice-mode/pocket/af_heart-100.mp3");
  for (const engine of ["pocket", "kokoro"]) {
    for (const voice of VOICE_OPTIONS) {
      for (const { value } of VOICE_SPEEDS) {
        const file = new URL(`../public${voicePreviewUrl(voice.id, value, engine)}`, import.meta.url);
        assert.ok(existsSync(file), `missing ${file.pathname}; run scripts/generate-voice-previews.mjs`);
      }
    }
  }
});

test("the Android app keeps voice mode running in the background", async () => {
  const { readFile } = await import("node:fs/promises");
  const [manifest, activity] = await Promise.all([
    readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
    readFile(new URL("../android/app/src/main/java/tech/klui/app/MainActivity.java", import.meta.url), "utf8")
  ]);
  // Android only lets a background app hear the microphone from a microphone foreground service.
  assert.match(manifest, /android:name="\.VoiceSessionService"[^>]*android:foregroundServiceType="microphone\|mediaPlayback"/);
  for (const permission of ["FOREGROUND_SERVICE", "FOREGROUND_SERVICE_MICROPHONE", "FOREGROUND_SERVICE_MEDIA_PLAYBACK"]) {
    assert.match(manifest, new RegExp(`android\\.permission\\.${permission}"`));
  }
  assert.match(activity, /registerPlugin\(VoiceSessionPlugin\.class\)/);
});

test("only the newest voice conversation can stop the background service", async () => {
  const { createVoiceKeepAlive } = await import("../public/js/platform/index.js");
  const calls = [];
  const ends = [];
  let gate = Promise.resolve();
  const plugin = {
    addListener: async (event, listener) => { ends.push(listener); return { remove: async () => {} }; },
    start: async () => { calls.push("start"); await gate; return { running: true }; },
    stop: async () => { calls.push("stop"); }
  };
  const hold = createVoiceKeepAlive(async () => plugin);

  // A conversation that closes normally starts and then stops the service.
  const first = await hold();
  assert.equal(first.running, true);
  first.stop();
  first.stop();
  assert.deepEqual(calls, ["start", "stop"]);

  // A slow start that a newer conversation overtakes neither runs nor stops the newer one.
  let open;
  gate = new Promise((resolve) => { open = resolve; });
  const stale = hold();
  const fresh = hold();
  open();
  const [old, current] = await Promise.all([stale, fresh]);
  assert.equal(old.running, false);
  assert.equal(current.running, true);
  old.stop();
  assert.equal(calls.filter((call) => call === "stop").length, 1);

  // The notification's End only reaches the conversation that holds the service.
  let ended = 0;
  const latest = await createVoiceKeepAlive(async () => plugin)({ onEnd: () => { ended += 1; } });
  ends.at(-1)();
  assert.equal(ended, 1);
  latest.stop();
  ends.at(-1)();
  assert.equal(ended, 1);

  // Android refusing the service is reported, so the app can retry when it is back on screen.
  const refused = await createVoiceKeepAlive(async () => ({ ...plugin, start: async () => ({ running: false }) }))();
  assert.equal(refused.running, false);
});

test("holding the voice service resolves through the real Capacitor plugin proxy", async () => {
  // The plugin proxy is thenable; returning it from an async loader would never resolve.
  const { keepVoiceSessionAlive } = await import("../public/js/platform/index.js");
  const previous = globalThis.Capacitor;
  globalThis.Capacitor = { isNativePlatform: () => true };
  try {
    const result = await Promise.race([
      keepVoiceSessionAlive(),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 2000))
    ]);
    assert.notEqual(result, "hung");
    assert.equal(typeof result.stop, "function");
    result.stop();
  } finally {
    globalThis.Capacitor = previous;
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { joinMp3, readMp3, silence } from "../server/study/mp3.js";
import {
  PODCAST_LENGTHS,
  TTS_MODEL,
  chunkForSpeech,
  generatePodcast,
  normalizePodcastOptions,
  parsePodcastScript,
  podcastSystemPrompt,
  recordPodcast,
  speakable
} from "../server/study/podcast.js";
import {
  PODCAST_SPEEDS,
  PODCAST_VOICES,
  activeLine,
  createPodcastAudio,
  formatTime,
  podcastOptionsMarkup,
  podcastViewMarkup
} from "../public/js/studyPodcast.js";

const clip = fs.readFileSync(new URL("../public/audio/voices/af_heart.mp3", import.meta.url));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

test("voice samples ship with a correct header for every podcast voice", () => {
  for (const voice of PODCAST_VOICES) {
    const sample = readMp3(fs.readFileSync(new URL(`../public/audio/voices/${voice.id}.mp3`, import.meta.url)));
    assert.ok(sample.seconds > 5 && sample.seconds < 15, voice.id);
  }
});

test("joined mp3 keeps exact frame timing and writes one Xing header", () => {
  const one = readMp3(clip);
  const gap = silence(one, 0.5);
  const joined = joinMp3([one, gap, one]);
  const again = readMp3(joined);
  // The Xing frame is dropped on re-read, so only audio frames are counted.
  assert.equal(again.frames.length, one.frames.length * 2 + gap.frames.length);
  assert.ok(joined.indexOf("Xing") < 40);
  assert.equal(joined.indexOf("Xing", joined.indexOf("Xing") + 1), -1);
  assert.equal(joined.readUInt32BE(joined.indexOf("Xing") + 8), again.frames.length);
  assert.ok(Math.abs(again.seconds - (one.seconds * 2 + gap.seconds)) < 1e-9);
});

test("script parsing keeps speakers, merges repeats, and turns PAUSE into thinking time", () => {
  const script = parsePodcastScript(`TITLE: "**Enzymes** explained"
A: Welcome back! Enzymes -> faster reactions (laughs) & 50% less waiting, e.g. digestion.
A: Second line from A.
B: What is the active site, really? PAUSE
B: It is where the substrate binds.
A: PAUSE
not a line
PAUSE`);
  assert.equal(script.title, "Enzymes explained");
  assert.deepEqual(script.turns.map((turn) => turn.pause ? "pause" : turn.speaker), [0, 1, "pause", 1]);
  assert.equal(script.turns[0].text, "Welcome back! Enzymes leads to faster reactions and 50 percent less waiting, for example, digestion. Second line from A.");
  assert.equal(speakable("*Bold* [music] 🙂 i.e. this"), "Bold that is, this");
});

test("speech chunks stay inside Kokoro's comfortable length", () => {
  const long = "Short one. " + "This clause keeps going, ".repeat(20) + "and ends here. Ok. Final bit here now.";
  const chunks = chunkForSpeech(long);
  const words = chunks.map((chunk) => chunk.split(/\s+/).length);
  assert.ok(words.every((count) => count <= 60), words.join(","));
  assert.ok(words.every((count) => count >= 8), words.join(","));
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), long.trim().replace(/\s+/g, " "));
});

test("podcast options fall back to safe defaults and never repeat a voice", () => {
  const options = normalizePodcastOptions({ style: "nope", length: "huge", voiceA: "am_puck", voiceB: "am_puck", focus: ` ${"x".repeat(2000)}` });
  assert.equal(options.style, "casual");
  assert.equal(options.length, "standard");
  assert.deepEqual(options.voices.map((voice) => voice.id), ["am_puck", "af_heart"]);
  assert.equal(options.focus.length, 1000);
  const prompt = podcastSystemPrompt({ ...options, style: "recall", focus: "osmosis" });
  assert.match(prompt, /A is Leo, the coach\. B is Maya, the learner\./);
  assert.match(prompt, /PAUSE/);
  assert.match(prompt, /focus on: osmosis/);
  assert.match(prompt, new RegExp(`about ${PODCAST_LENGTHS.standard.words} words`));
});

test("recording times every transcript line against the joined audio", async () => {
  const calls = [];
  const turns = [
    { speaker: 0, text: "Enzymes speed up reactions by lowering activation energy, and they are reused again and again." },
    { speaker: 1, text: "So what happens when the temperature climbs too high for the enzyme to cope?" },
    { pause: true },
    { speaker: 0, text: "The bonds holding its shape break, the active site changes, and the enzyme is denatured for good." }
  ];
  const voices = [{ id: "af_heart", name: "Maya" }, { id: "am_puck", name: "Leo" }];
  const progress = [];
  const result = await recordPodcast({
    config: {},
    turns,
    voices,
    onProgress: (share) => progress.push(share),
    tts: async ({ text, voice }) => { calls.push({ text, voice }); return clip; }
  });
  const one = readMp3(clip).seconds;
  assert.deepEqual(calls.map((call) => call.voice), ["af_heart", "am_puck", "af_heart"]);
  assert.equal(progress.at(-1), 1);
  assert.equal(result.transcript.length, 4);
  assert.equal(result.transcript[0].start, 0);
  assert.ok(result.transcript[1].start > result.transcript[0].end);
  assert.equal(result.transcript[2].pause, true);
  assert.ok(Math.abs(result.transcript[2].end - result.transcript[2].start - 3.5) < 0.03);
  assert.ok(Math.abs(result.seconds - readMp3(result.audio).seconds) < 0.002);
  assert.ok(result.seconds > one * 3 + 3.5);
});

test("generatePodcast writes the script, meters speech, and stores the episode", async () => {
  const stages = [];
  const usage = [];
  const created = [];
  const uploads = [];
  const context = {
    user: { id: "user-1" },
    plan: { id: "pro", maxStorageBytes: 10 ** 9 },
    subscription: null,
    r2: {
      objectKey: ({ fileName }) => `users/user-1/k/${fileName}`,
      async putObject(key, body) { uploads.push({ key, size: body.length }); return { etag: "e" }; },
      async deleteObjects() {}
    },
    db: {
      async reserveAttachment(input) { return { id: "att-1", object_key: input.objectKey, ...input }; },
      async completeReservedAttachment() {},
      async deleteAttachment() {},
      async createStudyPodcast(userId, row) { created.push(row); return { id: "pod-1", ...row }; },
      async reserveApiUsage(input) { usage.push(["reserve", input.model]); return { allowed: true }; },
      async markApiUsageSubmitted() { usage.push(["submitted"]); },
      async settleApiUsage(input) { usage.push(["settle", input.costCredits]); }
    }
  };
  const config = { desktop: { meteringMode: "enforce" }, providers: { openrouter: { apiKey: "k", baseUrl: "https://or.test/api/v1" } } };
  const script = ["TITLE: Enzymes in Ten Minutes", "A: Enzymes are proteins that speed up reactions without being used up, which is why so little is needed.", "B: And the active site is the pocket where the substrate binds, shaped by the tertiary structure.", "A: Heat past the optimum breaks the bonds that hold that shape, so the enzyme denatures for good.", "B: So shape is everything, and changing the shape changes the function every single time."].join("\n");
  let system = "";
  const { podcast } = await generatePodcast({
    context,
    config,
    course: { id: "course-1" },
    source: { note: { id: "n", title: "Notes", content: "Enzymes lower activation energy." } },
    options: { style: "tutor", length: "quick", voiceA: "bf_emma", voiceB: "am_fenrir", focus: "denaturation" },
    onStage: (stage) => stages.push(stage),
    complete: async (input) => { system = input.system; assert.equal(input.temperature, 0.7); return { content: script }; },
    tts: async () => clip
  });
  assert.match(system, /A is Emma, the teacher\. B is Finn, the student\./);
  assert.equal(podcast.title, "Enzymes in Ten Minutes");
  assert.equal(created[0].style, "tutor");
  assert.deepEqual(created[0].voices, [{ id: "bf_emma", name: "Emma" }, { id: "am_fenrir", name: "Finn" }]);
  assert.equal(created[0].transcript.length, 4);
  assert.equal(uploads[0].key, "users/user-1/k/Enzymes in Ten Minutes.mp3");
  assert.deepEqual(usage.map((row) => row[0]), ["reserve", "submitted", "settle"]);
  assert.equal(usage[0][1], TTS_MODEL);
  assert.ok(usage[2][1] > 0 && usage[2][1] < 0.001);
  assert.deepEqual(stages.slice(0, 3), ["preparing", "writing script", "recording 0%"]);
  assert.equal(stages.at(-1), "saving");
});

test("player markup shows transcript, controls, and every speed in one menu", () => {
  const podcast = {
    id: "pod-1",
    title: "Enzymes",
    style: "recall",
    durationSeconds: 125,
    createdAt: "2026-09-24T00:00:00Z",
    voices: [{ id: "af_heart", name: "Maya" }, { id: "am_puck", name: "Leo" }],
    transcript: [{ speaker: 0, text: "Hi <b>", start: 0, end: 4 }, { pause: true, start: 4, end: 7.5 }, { speaker: 1, text: "Answer", start: 7.5, end: 12 }],
    downloadUrl: "https://r2.test/a.mp3?x=1&y=2"
  };
  const html = podcastViewMarkup({ podcast, speedOpen: true, error: "" }, { title: "Enzymes" }, {
    escapeHtml,
    player: { time: 8, playing: true, waiting: false, rate: 1.5, volume: 0.6, muted: false }
  });
  assert.match(html, /Hi &#60;b&#62;/);
  assert.match(html, /Your turn to think · 4s/);
  assert.match(html, /data-pod-line="2"[^>]*data-start="7.5"/);
  assert.match(html, /class="dojo-pod-line is-b is-active"/);
  assert.match(html, /href="https:\/\/r2\.test\/a\.mp3\?x=1&#38;y=2" download/);
  assert.equal((html.match(/data-pod-speed="/g) || []).length, PODCAST_SPEEDS.length);
  assert.match(html, /data-pod-speed="1.5" aria-pressed="true"/);
  assert.match(html, /aria-label="Pause"/);
  assert.equal(activeLine(podcast.transcript, 3.9), 0);
  assert.equal(activeLine(podcast.transcript, 20), 2);
  assert.equal(formatTime(3725), "1:02:05");
});

test("create options offer four styles, three lengths, and distinct voice rows", () => {
  const html = podcastOptionsMarkup({ escapeHtml });
  assert.equal((html.match(/name="style"/g) || []).length, 4);
  assert.equal((html.match(/name="length"/g) || []).length, 3);
  assert.equal((html.match(/name="voiceA"/g) || []).length, PODCAST_VOICES.length);
  assert.equal((html.match(/name="voiceB"/g) || []).length, PODCAST_VOICES.length);
  assert.match(html, /name="voiceB" value="af_heart" disabled/);
  assert.match(html, /Optional · recommended/);
  assert.doesNotMatch(html, /language/i);
});

class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
    this.paused = true;
    this.ended = false;
    this.currentTime = 0;
    this.readyState = 4;
    this.plays = 0;
  }
  play() { this.plays += 1; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  removeAttribute() {}
}

async function withFakeAudio(run) {
  const saved = globalThis.Audio;
  try {
    let element;
    globalThis.Audio = class extends FakeAudio { constructor() { super(); element = this; } };
    await run(() => element);
  } finally {
    globalThis.Audio = saved;
  }
}

test("a link refresh only resumes playback the listener still wants", async () => {
  for (const pauseDuringRefresh of [false, true]) {
    await withFakeAudio(async (element) => {
      let finishRefresh;
      const player = createPodcastAudio({
        onUpdate() {},
        refreshUrl: () => new Promise((resolve) => { finishRefresh = resolve; })
      });
      const audio = element();
      player.load("ep-1", "https://old.example/ep-1.mp3");
      await player.toggle();
      assert.equal(audio.plays, 1);

      audio.dispatchEvent(new Event("error"));
      if (pauseDuringRefresh) player.pause();
      finishRefresh("https://new.example/ep-1.mp3");
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.equal(audio.src, "https://new.example/ep-1.mp3");
      assert.equal(audio.plays, pauseDuringRefresh ? 1 : 2);
    });
  }
});

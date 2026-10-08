// Records the voice previews into public/audio/. Run again only if the voices, speeds or lines change.
//   Pocket (the default engine): voice-mode/pocket/{id}-{speed}.mp3 and voices/pocket/{id}.mp3 (tutor)
//   Kokoro (the fallback):       voice-mode/{id}-{speed}.mp3 (podcast previews in voices/ are Kokoro too)
//   POCKET_TTS_URLS=http://localhost:8091 node --env-file=.env scripts/generate-voice-previews.mjs [pocket|kokoro] [voice ids...]
import { mkdir, writeFile } from "node:fs/promises";
import { loadConfig } from "../server/config.js";
import { POCKET_VOICES, PocketPool } from "../server/speech/engine.js";
import { PODCAST_VOICES, synthesizeSpeech } from "../server/study/podcast.js";
import { VOICE_OPTIONS, VOICE_SPEEDS, previewLine, voicePreviewUrl } from "../public/js/voiceMode.js";

const [engine = "pocket", ...only] = process.argv.slice(2);
const picked = (list) => list.filter((item) => !only.length || only.includes(item.id));
const urls = String(process.env.POCKET_TTS_URLS || "").split(",").map((url) => url.trim()).filter(Boolean);
if (engine === "pocket" && !urls.length) throw new Error("Set POCKET_TTS_URLS.");
const pool = new PocketPool({ urls });
const config = engine === "pocket" ? null : loadConfig();

const speak = (text, voice, speed = 1) => engine === "pocket"
  ? pool.speak({ text, voice: POCKET_VOICES[voice], speed })
  : synthesizeSpeech({ config, text, voice, speed });

async function save(path, audio) {
  const file = new URL(`../public${path}`, import.meta.url);
  await mkdir(new URL(".", file), { recursive: true });
  await writeFile(file, audio);
  console.log(path, audio.length, "bytes");
}

for (const voice of picked(VOICE_OPTIONS)) {
  for (const { value } of VOICE_SPEEDS) {
    await save(voicePreviewUrl(voice.id, value, engine), await speak(previewLine(voice), voice.id, value));
  }
}
if (engine === "pocket") {
  for (const voice of picked(PODCAST_VOICES)) {
    await save(`/audio/voices/pocket/${voice.id}.mp3`, await speak(`Hi, I'm ${voice.name}. Let's work through this together, one idea at a time.`, voice.id));
  }
}

// Records the voice picker's preview clips (every voice at every speed) into
// public/audio/voice-mode/. Run once, and again only if the voices, speeds or preview line change:
//   node --env-file=.env scripts/generate-voice-previews.mjs [voice ids...]
import { mkdir, writeFile } from "node:fs/promises";
import { loadConfig } from "../server/config.js";
import { synthesizeSpeech } from "../server/study/podcast.js";
import { VOICE_OPTIONS, VOICE_SPEEDS, previewLine, voicePreviewUrl } from "../public/js/voiceMode.js";

const config = loadConfig();
const root = new URL("../public", import.meta.url);
await mkdir(new URL("../public/audio/voice-mode/", import.meta.url), { recursive: true });
const only = process.argv.slice(2);
for (const voice of VOICE_OPTIONS.filter((item) => !only.length || only.includes(item.id))) {
  for (const { value } of VOICE_SPEEDS) {
    const path = voicePreviewUrl(voice.id, value);
    const audio = await synthesizeSpeech({ config, text: previewLine(voice), voice: voice.id, speed: value });
    await writeFile(new URL(`.${path}`, `${root}/`), audio);
    console.log(path, audio.length, "bytes");
  }
}

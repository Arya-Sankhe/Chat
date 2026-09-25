// Chat voice mode voices: Kokoro's best-rated English voices under abstract names (never
// people's names). Mirrored in public/js/voiceMode.js.
export const VOICE_MODE_VOICES = [
  { id: "af_heart", name: "Solar" },
  { id: "am_puck", name: "Spark" },
  { id: "af_bella", name: "Velvet" },
  { id: "am_fenrir", name: "Ember" },
  { id: "bf_emma", name: "Willow" },
  { id: "am_michael", name: "Harbor" }
];
export const DEFAULT_VOICE_MODE_VOICE = VOICE_MODE_VOICES[0].id;
export const VOICE_MODE_MIN_SPEED = 0.8;
export const VOICE_MODE_MAX_SPEED = 1.4;

export function normalizeVoiceModeVoice(value) {
  const id = String(value || "");
  return VOICE_MODE_VOICES.some((voice) => voice.id === id) ? id : DEFAULT_VOICE_MODE_VOICE;
}

export function normalizeVoiceModeSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return 1;
  return Math.round(Math.min(VOICE_MODE_MAX_SPEED, Math.max(VOICE_MODE_MIN_SPEED, speed)) * 100) / 100;
}

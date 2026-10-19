/* Chat controls and appearance, stored under "klui.chat.controls.v1" exactly as
   the current site stores them (public/js/app.js loadSettings), so a person's
   choices carry over and both sites can read each other's value. */

export const SETTINGS_KEY = "klui.chat.controls.v1";
export const PINNED_CHATS_KEY = "klui.pinnedChats.v1";

export const OPENROUTER_TEXT_MODEL = "deepseek/deepseek-v4-flash-0731";
export const OPENROUTER_PRO_MODEL = "openai/gpt-6-luna";
export const OPENROUTER_NITRO_MODEL = "inclusionai/ling-3.0-flash";

export const DEFAULT_REASONING_EFFORT = "high";
export const SPECTRUM_N = 3;
export const SPECTRUM_STEPS = [
  { mode: "thinking", model: OPENROUTER_NITRO_MODEL, effort: "high" },
  { mode: "thinking", model: OPENROUTER_TEXT_MODEL, effort: "xhigh" },
  { mode: "pro", model: OPENROUTER_PRO_MODEL, effort: "xhigh" }
] as const;

export const APPEARANCES = new Set(["light", "dark", "system"]);
export const COLOR_PRESETS = new Set(["default", "indigo", "emerald", "rose", "ocean", "violet", "teal", "amber"]);
export const HOME_WALLPAPERS = new Set(["none", "clouds", "alpine", "valley", "launch"]);
export const WRITING_STYLE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  normal: "Normal",
  learning: "Learning",
  concise: "Concise",
  explanatory: "Explanatory",
  formal: "Formal"
});

// Mirrors server/speech/voices.js (ids) and public/js/voiceMode.js (speeds).
export const VOICE_IDS = ["af_heart", "am_puck", "af_bella", "am_fenrir", "bf_emma", "am_michael"];
export const VOICE_SPEEDS = [0.85, 1, 1.15, 1.3];
export const DEFAULT_VOICE = "af_heart";
export const DEFAULT_VOICE_SPEED = 1;

export type Appearance = "light" | "dark" | "system";

export interface ChatSettings {
  model: string;
  modelMode: string;
  systemPrompt: string;
  thinkingEffort: string;
  spectrumLevel: number;
  spectrumScale: number;
  compareEnabled: boolean;
  compareModels: string[];
  compareMode: "compare" | "council";
  agentMode: boolean;
  webSearchMode: "auto" | "off";
  writingStyle: string;
  appearance: Appearance;
  colorPreset: string;
  colorChosen: boolean;
  wallpaper: string;
  showModelReasoning: boolean;
  weatherUnits: string;
  uiTextScale: number;
  voiceId: string;
  voiceSpeed: number;
  voiceChosen: boolean;
  [key: string]: unknown;
}

export const defaultSettings: ChatSettings = {
  model: OPENROUTER_TEXT_MODEL,
  modelMode: "thinking",
  systemPrompt: "",
  thinkingEffort: DEFAULT_REASONING_EFFORT,
  spectrumLevel: 1,
  spectrumScale: 3,
  compareEnabled: false,
  compareModels: [],
  compareMode: "compare",
  agentMode: true,
  webSearchMode: "auto",
  writingStyle: "normal",
  appearance: "system",
  colorPreset: "ocean",
  colorChosen: false,
  wallpaper: "clouds",
  showModelReasoning: true,
  weatherUnits: "metric",
  uiTextScale: 100,
  voiceId: DEFAULT_VOICE,
  voiceSpeed: DEFAULT_VOICE_SPEED,
  voiceChosen: false
};

export function normalizeThinkingEffort(value: unknown): string {
  const effort = String(value || "").trim().toLowerCase();
  if (effort === "max") return "xhigh";
  return effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh" ? effort : DEFAULT_REASONING_EFFORT;
}

export function normalizeWritingStyle(value: unknown): string {
  const style = String(value || "normal").trim().toLowerCase();
  return Object.hasOwn(WRITING_STYLE_LABELS, style) ? style : "normal";
}

export function clampTextScale(value: unknown): number {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return 100;
  return Math.min(130, Math.max(85, num));
}

export function normalizeVoiceId(value: unknown): string {
  return VOICE_IDS.includes(value as string) ? (value as string) : DEFAULT_VOICE;
}

export function normalizeVoiceSpeed(value: unknown): number {
  const speed = Number(value);
  return VOICE_SPEEDS.find((item) => Math.abs(item - speed) < 0.01) ?? DEFAULT_VOICE_SPEED;
}

/** Reads the stored value. `migrated` is set when a legacy "theme" key was
   dropped, which the caller writes back (the current site does the same). */
export function parseSettings(raw: string | null): { settings: ChatSettings; migrated: boolean } {
  try {
    const stored = JSON.parse(raw || "{}");
    const migrated = Object.hasOwn(stored, "theme");
    const loaded: ChatSettings = { ...defaultSettings, ...stored };
    loaded.compareModels = Array.isArray(loaded.compareModels) ? loaded.compareModels.slice(0, 4) : [];
    loaded.compareEnabled = false;
    loaded.compareMode = loaded.compareMode === "council" ? "council" : "compare";
    loaded.agentMode = true;
    loaded.webSearchMode = loaded.webSearchMode === "off" ? "off" : "auto";
    loaded.writingStyle = normalizeWritingStyle(loaded.writingStyle);
    // Every load opens on Think: the slider applies for the session only, so
    // the stored level is not read.
    loaded.spectrumLevel = 1;
    loaded.spectrumScale = 3;
    loaded.model = SPECTRUM_STEPS[1].model;
    loaded.thinkingEffort = SPECTRUM_STEPS[1].effort;
    loaded.modelMode = SPECTRUM_STEPS[1].mode;
    delete loaded.provider;
    delete loaded.kluiModel;
    delete loaded.theme;
    loaded.appearance = APPEARANCES.has(loaded.appearance) ? loaded.appearance : "system";
    // Blue until someone picks a swatch; a saved swatch other than "default"
    // predates the flag and was picked on purpose.
    loaded.colorChosen = loaded.colorChosen === true || (COLOR_PRESETS.has(loaded.colorPreset) && loaded.colorPreset !== "default");
    loaded.colorPreset = loaded.colorChosen && COLOR_PRESETS.has(loaded.colorPreset) ? loaded.colorPreset : "ocean";
    loaded.wallpaper = HOME_WALLPAPERS.has(loaded.wallpaper) ? loaded.wallpaper : "clouds";
    loaded.showModelReasoning = loaded.showModelReasoning !== false;
    loaded.uiTextScale = clampTextScale(loaded.uiTextScale);
    loaded.voiceId = normalizeVoiceId(loaded.voiceId);
    loaded.voiceSpeed = normalizeVoiceSpeed(loaded.voiceSpeed);
    loaded.voiceChosen = loaded.voiceChosen === true;
    return { settings: loaded, migrated };
  } catch {
    return { settings: { ...defaultSettings }, migrated: false };
  }
}

export function resolvedAppearance(settings: ChatSettings, systemDark: boolean): "light" | "dark" {
  const appearance = APPEARANCES.has(settings.appearance) ? settings.appearance : "system";
  if (appearance === "system") return systemDark ? "dark" : "light";
  return appearance;
}

/** The body attributes and CSS variables the home wallpaper and accent come
   from (app.js applyAppearance). `packaged` drops the cache-busting query, as
   the Android app ships its images. */
export function appearanceAttributes(settings: ChatSettings, systemDark: boolean, packaged = false) {
  const accent = COLOR_PRESETS.has(settings.colorPreset) ? settings.colorPreset : "default";
  const mode = resolvedAppearance(settings, systemDark);
  const wallpaper = HOME_WALLPAPERS.has(settings.wallpaper) ? settings.wallpaper : "clouds";
  if (wallpaper === "none") return { accent, mode, wallpaper, wallpaperSrc: "", style: {} as Record<string, string> };
  const lightWallpaper = mode === "light" && ["clouds", "alpine", "valley", "launch"].includes(wallpaper);
  const darkClouds = mode === "dark" && wallpaper === "clouds";
  const version = packaged ? "" : darkClouds ? "?v=20260825-clouds-dark-v3" : "?v=20260825-clouds-b-1080";
  const wallpaperSrc = darkClouds
    ? `/images/home-clouds-dark-v3.webp${version}`
    : `/images/home-${wallpaper}${lightWallpaper ? "-light" : ""}.webp${version}`;
  const nightSky = mode === "dark" && ["alpine", "valley"].includes(wallpaper);
  return {
    accent,
    mode,
    wallpaper,
    wallpaperSrc,
    style: {
      "--home-wallpaper-image": `url("${wallpaperSrc}")`,
      // Inside a chat the same scene returns as a faint monochrome print.
      "--chat-outline-image": `url("/images/home-${wallpaper}-ink-${mode}.webp${packaged ? "" : "?v=20261005-1"}")`,
      "--home-wallpaper-base": nightSky ? `url("/images/home-night-sky.webp${packaged ? "" : "?v=20260723-1"}")` : "none"
    } as Record<string, string>
  };
}

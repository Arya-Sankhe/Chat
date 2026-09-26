// Chat voice mode: a hands-free conversation with Klui.
// The browser records each turn (Grok transcribes it), the reply streams through the normal
// chat pipeline with the short voice prompt, and it is spoken sentence by sentence with Kokoro
// while the model is still writing. Turn-taking and the orb come from the AI tutor call.
import { CHIMES, createOrb, endOfTurnSilence, looksComplete, playChime } from "./studyTutor.js";
import { createSatellites } from "./voiceSatellites.js";

// Mirrors server/speech/voices.js. Abstract names only, never people's names.
// Each voice has its own orb: one hue in light shades. `b` is the pale top, `a` the richer side,
// `c` the palest swirl.
export const VOICE_OPTIONS = [
  { id: "af_heart", name: "Solar", tone: "Warm and bright", palette: { a: [255, 168, 108], b: [255, 212, 168], c: [255, 232, 206], glow: [255, 194, 148] } },
  { id: "am_puck", name: "Spark", tone: "Upbeat and lively", palette: { a: [244, 196, 56], b: [255, 228, 128], c: [255, 244, 190], glow: [250, 216, 108] } },
  { id: "af_bella", name: "Velvet", tone: "Smooth, expressive", palette: { a: [158, 134, 240], b: [210, 196, 255], c: [234, 226, 255], glow: [188, 170, 248] } },
  { id: "am_fenrir", name: "Ember", tone: "Deep, grounded", palette: { a: [238, 110, 112], b: [255, 178, 174], c: [255, 214, 210], glow: [244, 150, 148] } },
  { id: "bf_emma", name: "Willow", tone: "Calm, British", palette: { a: [118, 200, 118], b: [184, 236, 166], c: [218, 246, 206], glow: [158, 220, 148] } },
  { id: "am_michael", name: "Harbor", tone: "Steady and clear", palette: { a: [108, 170, 240], b: [174, 214, 255], c: [214, 234, 255], glow: [148, 196, 246] } }
];
export const VOICE_SPEEDS = [
  { value: 0.85, label: "Relaxed" },
  { value: 1, label: "Natural" },
  { value: 1.15, label: "Brisk" },
  { value: 1.3, label: "Quick" }
];
export const DEFAULT_VOICE = VOICE_OPTIONS[0].id;
export const DEFAULT_VOICE_SPEED = 1;

export function voiceOption(id) {
  return VOICE_OPTIONS.find((voice) => voice.id === id) || VOICE_OPTIONS[0];
}

export function normalizeVoiceId(value) {
  return voiceOption(value).id;
}

export function normalizeVoiceSpeed(value) {
  const speed = Number(value);
  const match = VOICE_SPEEDS.find((item) => Math.abs(item.value - speed) < 0.01);
  return match ? match.value : DEFAULT_VOICE_SPEED;
}

export function voiceSpeedLabel(value) {
  return (VOICE_SPEEDS.find((item) => item.value === normalizeVoiceSpeed(value)) || VOICE_SPEEDS[1]).label;
}

const svg = (paths, size = 20, width = 1.9) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const VOICE_ICONS = {
  // Same shape as ChatGPT's and Claude's voice buttons: a small waveform.
  wave: svg('<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>', 18, 2.2),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>', 22),
  micOff: svg('<path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.4V6a3 3 0 0 0-5.7-1.3"/><path d="M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 10.4 5.2M12 17.5V21M3 3l18 18"/>', 22),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 22, 2.1),
  chevron: svg('<path d="m7 10 5 5 5-5"/>', 14, 2.2),
  prev: svg('<path d="m14.5 6-6 6 6 6"/>', 20, 2.2),
  next: svg('<path d="m9.5 6 6 6-6 6"/>', 20, 2.2),
  check: svg('<path d="m5 12.5 4.2 4.2L19 7"/>', 14, 2.4)
};

/* ---------- Speech chunking ---------- */

// Mirrors createSpeechChunker in server/study/tutor.js: a short first chunk so audio starts
// fast, then fuller ones (Kokoro stumbles on very short inputs and rushes very long ones).
export function createSpeechChunker({ first = 6, min = 14, max = 42 } = {}) {
  let buffer = "";
  let emitted = 0;
  const words = (text) => text.split(/\s+/).filter(Boolean).length;
  const take = (final) => {
    const out = [];
    for (;;) {
      const target = emitted ? min : first;
      const ends = [...buffer.matchAll(/[.!?]+["')\]]*(?=\s|$)|\n+/g)].map((match) => match.index + match[0].length);
      let cut = -1;
      for (const end of ends) {
        const count = words(buffer.slice(0, end));
        if (count >= target) { cut = end; break; }
        if (count > max) break;
      }
      // The very first chunk may end at a comma, so a long opening sentence starts speaking sooner.
      if (cut < 0 && !emitted) {
        cut = [...buffer.matchAll(/[,;:](?=\s)/g)].map((match) => match.index + 1).find((end) => words(buffer.slice(0, end)) >= 8) ?? -1;
      }
      if (cut < 0 && words(buffer) > max * 1.4) {
        const clause = [...buffer.matchAll(/[,;:](?=\s)/g)].map((match) => match.index + 1).filter((end) => words(buffer.slice(0, end)) >= min).at(-1);
        cut = clause || -1;
      }
      if (cut < 0 || (!final && cut === buffer.trimEnd().length && !/\s$/.test(buffer))) break;
      const chunk = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut);
      if (chunk) { out.push(chunk); emitted += 1; }
    }
    if (final && buffer.trim()) {
      out.push(buffer.trim());
      buffer = "";
      emitted += 1;
    }
    return out;
  };
  // Hold a chunk until a few more words follow it, so a short closing line joins the one before.
  let held = "";
  const release = (chunks, final) => {
    const out = [];
    for (const chunk of chunks) {
      if (held) out.push(held);
      held = chunk;
    }
    if (final && held) {
      if (out.length && words(held) < first) out[out.length - 1] = `${out.at(-1)} ${held}`;
      else out.push(held);
      held = "";
    } else if (held && words(buffer) >= first) {
      out.push(held);
      held = "";
    }
    return out;
  };
  return {
    push: (text) => { buffer += text; return release(take(false), false); },
    flush: () => release(take(true), true)
  };
}

// /api/voice/speech rejects more than 700 characters; stay under it with room for word swaps.
export const SPEECH_CHUNK_MAX_CHARS = 600;

// Splits text that is too long to speak in one request, preferring sentence, then clause,
// then word boundaries. Pieces are slices of the input, so spoken-progress tracking still works.
export function splitForSpeech(text, max = SPEECH_CHUNK_MAX_CHARS) {
  const pieces = [];
  let rest = String(text || "").trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    const at = (pattern) => [...window.matchAll(pattern)].map((match) => match.index + match[0].length).filter((end) => end <= max && end >= max / 3).at(-1);
    const cut = at(/[.!?]+["')\]]*\s/g) ?? at(/[,;:]\s/g) ?? at(/\s/g) ?? max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

// What reaches text-to-speech: markdown and links read badly aloud.
export function spokenText(text) {
  return String(text || "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`~#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- Voice picker ---------- */

const rgb = (color) => `rgb(${color.join(" ")})`;

// Paints a voice's colors onto an element as CSS variables (dots, speed thumb, buttons, chip).
export function voiceTint(element, id) {
  const { palette } = voiceOption(id);
  element.style.setProperty("--vp-deep", rgb(palette.a));
  element.style.setProperty("--vp-soft", rgb(palette.b));
}

export function previewLine(voice) {
  return `Hi, I'm ${voice.name}. Ask me anything and I'll keep it short and sweet.`;
}

// The picker's previews are fixed, so they are recorded once (scripts/generate-voice-previews.mjs)
// and served as static files instead of being synthesized on every pick.
export function voicePreviewUrl(voice, speed) {
  return `/audio/voice-mode/${normalizeVoiceId(voice)}-${Math.round(normalizeVoiceSpeed(speed) * 100)}.mp3`;
}

async function fetchVoicePreview(voice, speed) {
  const response = await fetch(voicePreviewUrl(voice, speed));
  if (!response.ok) throw new Error("Could not play the preview.");
  return response.arrayBuffer();
}

export function voicePickerMarkup({ voice = DEFAULT_VOICE, speed = DEFAULT_VOICE_SPEED } = {}) {
  const picked = voiceOption(voice);
  const pace = normalizeVoiceSpeed(speed);
  const dots = VOICE_OPTIONS.map((item) => `<button type="button" role="tab" aria-label="${item.name}" aria-selected="${item.id === picked.id}" data-voice-id="${item.id}"${item.id === picked.id ? ' class="is-picked"' : ""}></button>`).join("");
  const speeds = VOICE_SPEEDS.map((item) => `<button type="button" role="radio" aria-checked="${item.value === pace}" data-voice-speed="${item.value}"${item.value === pace ? ' class="is-picked"' : ""}>${item.label}</button>`).join("");
  return `<div class="voice-picker" data-voice="${picked.id}">
      <div class="vp-stage">
        <button class="vp-arrow" type="button" data-voice-step="-1" aria-label="Previous voice">${VOICE_ICONS.prev}</button>
        <div class="vp-orb" data-vp-orb aria-hidden="true"><canvas></canvas></div>
        <button class="vp-arrow" type="button" data-voice-step="1" aria-label="Next voice">${VOICE_ICONS.next}</button>
      </div>
      <div class="vp-name" aria-live="polite"><span data-vp-name><strong>${picked.name}</strong><small>${picked.tone}</small></span></div>
      <div class="vp-dots" role="tablist" aria-label="Voice">${dots}</div>
      <div class="vp-speed" role="radiogroup" aria-label="Speaking speed"><span class="vp-speed-thumb" aria-hidden="true"></span>${speeds}</div>
    </div>`;
}

function paintSpeedThumb(root) {
  const picked = root.querySelector("[data-voice-speed].is-picked");
  const thumb = root.querySelector(".vp-speed-thumb");
  if (!picked || !thumb || !picked.offsetWidth) return;
  thumb.style.width = `${picked.offsetWidth}px`;
  thumb.style.transform = `translateX(${picked.offsetLeft}px)`;
}

/**
 * Wires a rendered voice picker: one animated orb per voice, stepped with the arrows, the dots,
 * arrow keys or a swipe. Previews play the prerecorded clips (`loadPreview(voice, speed)` resolves to
 * MP3 bytes); `onChange({ voice, speed })` fires on every pick. Returns { value, step, preview, stopPreview, destroy }.
 */
export function bindVoicePicker(root, { voice, speed, loadPreview = fetchVoicePreview, onChange, onError, reducedMotion = false }) {
  let state = { voice: normalizeVoiceId(voice), speed: normalizeVoiceSpeed(speed) };
  const orb = createOrb(root.querySelector("[data-vp-orb] canvas"), { calm: reducedMotion });
  orb.setPalette(voiceOption(state.voice).palette, { instant: true });
  orb.setMode("idle");
  orb.start();
  voiceTint(root, state.voice);
  const cache = new Map();
  const ready = new Set();
  let ctx = null;
  let source = null;
  let meter = 0;
  let playToken = 0;
  let debounce = 0;

  function stopPreview() {
    playToken += 1;
    clearTimeout(debounce);
    cancelAnimationFrame(meter);
    try { source?.stop(); } catch {}
    source = null;
    orb.setMode("idle");
    orb.setLevel(0);
    root.classList.remove("is-playing", "is-loading");
  }
  function audioContext() {
    const Context = window.AudioContext || window.webkitAudioContext;
    ctx ||= new Context();
    return ctx;
  }
  // Fetches and decodes a clip once; decoding works while the context is still suspended.
  function clip(voiceId, pace) {
    const key = `${voiceId}|${pace}`;
    if (!cache.has(key)) {
      const pending = Promise.resolve(loadPreview(voiceId, pace))
        .then((bytes) => audioContext().decodeAudioData(bytes.slice(0)))
        .then((buffer) => { ready.add(key); return buffer; });
      pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
      cache.set(key, pending);
    }
    return cache.get(key);
  }
  // The next voice either way and the other speeds of this one, so the next pick plays at once.
  function prefetch() {
    const index = VOICE_OPTIONS.findIndex((item) => item.id === state.voice);
    const near = [VOICE_OPTIONS[(index + 1) % VOICE_OPTIONS.length], VOICE_OPTIONS[(index + VOICE_OPTIONS.length - 1) % VOICE_OPTIONS.length]];
    for (const item of near) clip(item.id, state.speed).catch(() => {});
    for (const { value } of VOICE_SPEEDS) clip(state.voice, value).catch(() => {});
  }
  async function preview() {
    stopPreview();
    const token = playToken;
    const key = `${state.voice}|${state.speed}`;
    if (!ready.has(key)) {
      root.classList.add("is-loading");
      orb.setMode("thinking");
    }
    try {
      const context = audioContext();
      if (context.state === "suspended") await context.resume().catch(() => {});
      const pending = clip(state.voice, state.speed);
      prefetch();
      const buffer = await pending;
      if (token !== playToken) return;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.connect(ctx.destination);
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const pump = () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
        orb.setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 7));
        meter = requestAnimationFrame(pump);
      };
      source.addEventListener("ended", () => { if (token === playToken) stopPreview(); }, { once: true });
      root.classList.remove("is-loading");
      root.classList.add("is-playing");
      orb.setMode("speaking");
      source.start();
      pump();
    } catch (error) {
      if (token !== playToken) return;
      stopPreview();
      if (error?.name !== "NotAllowedError" && error?.name !== "AbortError") onError?.(error?.message || "Could not play the preview.");
    }
  }
  // A clip already in memory plays at once; otherwise a short pause means rapid stepping only
  // fetches the voice you land on.
  function queuePreview() {
    stopPreview();
    if (ready.has(`${state.voice}|${state.speed}`)) void preview();
    else debounce = setTimeout(() => void preview(), 120);
  }
  function select(next, direction = 0) {
    const changedVoice = next.voice && next.voice !== state.voice;
    state = { ...state, ...next };
    root.dataset.voice = state.voice;
    root.querySelectorAll("[data-voice-id]").forEach((dot) => {
      const on = dot.dataset.voiceId === state.voice;
      dot.classList.toggle("is-picked", on);
      dot.setAttribute("aria-selected", String(on));
    });
    root.querySelectorAll("[data-voice-speed]").forEach((button) => {
      const on = Number(button.dataset.voiceSpeed) === state.speed;
      button.classList.toggle("is-picked", on);
      button.setAttribute("aria-checked", String(on));
    });
    paintSpeedThumb(root);
    if (changedVoice) {
      const item = voiceOption(state.voice);
      orb.setPalette(item.palette);
      voiceTint(root, state.voice);
      const name = root.querySelector("[data-vp-name]");
      name.innerHTML = `<strong>${item.name}</strong><small>${item.tone}</small>`;
      // The name slides in from the side we moved toward; the orb recolors in place.
      root.style.setProperty("--vp-from", direction < 0 ? "-1" : "1");
      root.classList.remove("is-moving");
      void root.offsetWidth;
      root.classList.add("is-moving");
    }
    onChange?.({ ...state });
  }
  function step(delta) {
    const index = VOICE_OPTIONS.findIndex((item) => item.id === state.voice);
    select({ voice: VOICE_OPTIONS[(index + delta + VOICE_OPTIONS.length) % VOICE_OPTIONS.length].id }, delta);
    queuePreview();
  }
  const onClick = (event) => {
    const arrow = event.target.closest("[data-voice-step]");
    if (arrow) { step(Number(arrow.dataset.voiceStep)); return; }
    const dot = event.target.closest("[data-voice-id]");
    if (dot && root.contains(dot)) {
      const from = VOICE_OPTIONS.findIndex((item) => item.id === state.voice);
      const to = VOICE_OPTIONS.findIndex((item) => item.id === dot.dataset.voiceId);
      if (to === from) { void preview(); return; }
      select({ voice: dot.dataset.voiceId }, to - from);
      queuePreview();
      return;
    }
    if (event.target.closest("[data-vp-orb]")) {
      if (root.classList.contains("is-playing")) stopPreview();
      else void preview();
      return;
    }
    const pace = event.target.closest("[data-voice-speed]");
    if (pace && root.contains(pace)) {
      select({ speed: normalizeVoiceSpeed(pace.dataset.voiceSpeed) });
      queuePreview();
    }
  };
  const onKey = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    step(event.key === "ArrowRight" ? 1 : -1);
  };
  let swipe = null;
  const onDown = (event) => { if (event.isPrimary) swipe = { x: event.clientX, y: event.clientY }; };
  const onUp = (event) => {
    if (!swipe) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
  };
  const stage = root.querySelector(".vp-stage");
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", () => { swipe = null; });
  requestAnimationFrame(() => paintSpeedThumb(root));
  const resize = () => paintSpeedThumb(root);
  window.addEventListener("resize", resize);
  return {
    get value() { return { ...state }; },
    step,
    preview,
    stopPreview,
    refresh: resize,
    destroy() {
      stopPreview();
      orb.stop();
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", resize);
      cache.clear();
      ctx?.close().catch(() => {});
    }
  };
}

/**
 * Modal voice picker: the first-run chooser (`first: true`) and the in-call voice switcher.
 * Resolves when closed; `onSave({ voice, speed })` fires only when confirmed. Esc or a tap
 * outside dismisses it.
 */
export function openVoicePicker({ voice, speed, first = false, onSave, onError, reducedMotion = false }) {
  const shell = document.createElement("div");
  shell.className = "voice-picker-dialog";
  shell.innerHTML = `<div class="voice-picker-backdrop" data-voice-cancel></div>
    <section class="voice-picker-card" role="dialog" aria-modal="true" aria-label="Choose a voice">
      ${voicePickerMarkup({ voice, speed })}
      <button class="vp-save" type="button" data-voice-save>${first ? `${VOICE_ICONS.wave}<span>Start talking</span>` : "<span>Done</span>"}</button>
    </section>`;
  document.body.append(shell);
  const card = shell.querySelector(".voice-picker-card");
  const picker = bindVoicePicker(shell.querySelector(".voice-picker"), {
    voice,
    speed,
    onError,
    reducedMotion,
    onChange: ({ voice: next }) => voiceTint(card, next)
  });
  voiceTint(card, picker.value.voice);
  requestAnimationFrame(() => {
    shell.classList.add("is-open");
    picker.refresh();
  });
  shell.querySelector("[data-voice-save]").focus({ preventScroll: true });
  // Opening came from a click, so the first voice can speak right away.
  setTimeout(() => void picker.preview(), reducedMotion ? 0 : 320);
  return new Promise((resolve) => {
    let closed = false;
    const close = (saved) => {
      if (closed) return;
      closed = true;
      const value = picker.value;
      picker.destroy();
      document.removeEventListener("keydown", onKey, true);
      shell.classList.remove("is-open");
      shell.classList.add("is-closing");
      setTimeout(() => shell.remove(), 240);
      if (saved) onSave?.(value);
      resolve(saved ? value : null);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(false);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (event.target.closest?.(".voice-picker")) return; // the picker handles its own
        event.preventDefault();
        picker.step(event.key === "ArrowRight" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", onKey, true);
    shell.addEventListener("click", (event) => {
      if (event.target.closest("[data-voice-save]")) close(true);
      else if (event.target.closest("[data-voice-cancel]")) close(false);
    });
  });
}

/* ---------- Live session ---------- */

const TICK_MS = 50;
const TTS_PARALLEL = 3;
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function recordingType() {
  if (typeof MediaRecorder === "undefined") return "";
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

export function voiceModeSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && recordingType() && (window.AudioContext || window.webkitAudioContext));
}

/**
 * One voice conversation.
 * - api.transcribe(blob, { signal }) -> { text }
 * - api.speak(text, voice, speed, { signal }) -> ArrayBuffer (MP3)
 * - sendTurn(text, { onStart(abort), onText(fullText), onTool() }) -> { ok, aborted, error } | null when busy
 * - prefs() -> { voice, speed }; pickVoice() opens the picker and resolves when it closes.
 */
export function createVoiceSession({ api, sendTurn, prefs, pickVoice, escapeHtml, reducedMotion = false, onClose, onToast }) {
  const root = document.createElement("div");
  root.className = "voice-mode";
  root.dataset.phase = "connecting";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Voice mode");
  root.innerHTML = `
    <div class="voice-aura" aria-hidden="true"><i></i><i></i><i></i></div>
    <header class="voice-top">
      <button class="voice-chip" type="button" data-voice-pick aria-label="Change voice">
        <span class="voice-chip-orb" data-voice-chip-orb aria-hidden="true"></span>
        <span class="voice-chip-name" data-voice-chip-name></span>
        <span class="voice-chip-speed" data-voice-chip-speed></span>
        ${VOICE_ICONS.chevron}
      </button>
    </header>
    <div class="voice-stage">
      <button class="voice-orb" type="button" data-voice-orb aria-label="Klui">
        <span class="voice-orb-halo" aria-hidden="true"><i></i><i></i></span>
        <span class="voice-orb-ripple" aria-hidden="true"><i></i><i></i></span>
        <canvas data-voice-orb-canvas></canvas>
        <canvas class="voice-orb-satellites" data-voice-satellites aria-hidden="true"></canvas>
      </button>
      <span class="voice-status" role="status" data-voice-status><i></i><span>Connecting…</span></span>
      <span class="voice-hint" data-voice-hint></span>
    </div>
    <div class="voice-captions" data-voice-captions aria-live="polite">
      <p class="voice-you" data-voice-you></p>
      <p class="voice-reply" data-voice-reply></p>
    </div>
    <footer class="voice-controls">
      <button class="voice-ctl is-mute" type="button" data-voice-mute aria-pressed="false" aria-label="Mute microphone" title="Mute">${VOICE_ICONS.mic}</button>
      <button class="voice-ctl is-end" type="button" data-voice-end aria-label="End voice mode" title="End">${VOICE_ICONS.close}</button>
    </footer>`;
  const $ = (selector) => root.querySelector(selector);
  const orb = createOrb($("[data-voice-orb-canvas]"), { calm: reducedMotion });
  const satellites = createSatellites($("[data-voice-satellites]"), { calm: reducedMotion });
  const youLine = $("[data-voice-you]");
  const replyLine = $("[data-voice-reply]");

  let phase = "connecting";
  let started = false;
  let closed = false;
  let muted = false;
  let ctx = null;
  let stream = null;
  let micAnalyser = null;
  let outAnalyser = null;
  let outGain = null;
  let samples = null;
  let floor = 0.006;
  let echo = 0;
  let barge = 0;
  let ticker = 0;
  let turnSeq = 0;
  let abortTurn = null;
  let streaming = false;
  let listen = null;
  let reply = { full: "", spoken: 0, cut: false };
  // Speech: sentences are recorded up to TTS_PARALLEL at a time and played strictly in order.
  let queue = [];
  let current = null;
  let speechGen = 0;
  let speechAbort = new AbortController();
  let jobs = [];
  let activeJobs = 0;
  let chain = Promise.resolve();
  let pendingSpeech = 0;
  let turnDone = false;

  /* Chrome */
  let paintedVoice = "";
  function paintChip() {
    const { voice, speed } = prefs();
    const item = voiceOption(voice);
    voiceTint($("[data-voice-chip-orb]"), item.id);
    $("[data-voice-chip-name]").textContent = item.name;
    $("[data-voice-chip-speed]").textContent = voiceSpeedLabel(speed);
    if (item.id === paintedVoice) return;
    // The orb, aura, rings, small orbs and status dot all take the chosen voice's colors;
    // switching voices mid-call swirls the new colors in.
    orb.setPalette(item.palette, { instant: !paintedVoice });
    satellites.setPalette(item.palette, { instant: !paintedVoice });
    root.style.setProperty("--voice-deep", rgb(item.palette.a));
    root.style.setProperty("--voice-glow", rgb(item.palette.glow));
    root.style.setProperty("--voice-pale", rgb(item.palette.b));
    paintedVoice = item.id;
  }
  const LABELS = { connecting: "Connecting…", listening: "Listening", thinking: "Thinking", speaking: "Speaking", muted: "Microphone off" };
  function setPhase(next, label = LABELS[next]) {
    phase = next;
    root.dataset.phase = next;
    const mode = next === "connecting" ? "thinking" : next === "muted" ? "paused" : next;
    orb.setMode(mode);
    satellites.setMode(mode);
    setStatus(label);
    $("[data-voice-orb]").setAttribute("aria-label", next === "speaking" || next === "thinking" ? "Klui is answering. Tap to interrupt."
      : next === "listening" ? "Listening. Tap when you're done." : next === "muted" ? "Microphone off. Tap to turn it on." : "Klui");
    if (next !== "listening") setHint("");
  }
  function setStatus(text) {
    const node = $("[data-voice-status] span");
    if (node.textContent !== text) node.textContent = text;
  }
  function setHint(text) {
    const node = $("[data-voice-hint]");
    if (node.textContent !== text) node.textContent = text;
  }
  function paintYou(text, live = false) {
    youLine.classList.toggle("is-live", live);
    youLine.innerHTML = text ? escapeHtml(text) : live ? '<span class="voice-dots" aria-label="Listening"><i></i><i></i><i></i></span>' : "";
  }
  function paintReply() {
    const captions = $("[data-voice-captions]");
    const stick = captions.scrollHeight - captions.scrollTop - captions.clientHeight < 48;
    // The answer appears sentence by sentence as Klui says it, never ahead of the voice, and it
    // replaces the user's words once it starts.
    const said = reply.full.slice(0, reply.spoken).trim();
    if (!said) {
      replyLine.innerHTML = phase === "thinking" ? '<span class="voice-dots" aria-label="Thinking"><i></i><i></i><i></i></span>' : "";
    } else {
      if (!youLine.classList.contains("is-live")) paintYou("");
      replyLine.innerHTML = `${escapeHtml(said)}${reply.cut ? '<span class="voice-cut">…</span>' : ""}`;
    }
    if (stick) captions.scrollTop = captions.scrollHeight;
  }
  function markSpoken(text) {
    const probe = text.slice(0, 24);
    const at = probe ? reply.full.indexOf(probe, Math.max(0, reply.spoken - 4)) : -1;
    reply.spoken = at >= 0 ? Math.min(reply.full.length, at + text.length) : Math.min(reply.full.length, reply.spoken + text.length + 1);
    paintReply();
  }

  /* Audio */
  async function openAudio() {
    const Context = window.AudioContext || window.webkitAudioContext;
    ctx = new Context();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    outGain = ctx.createGain();
    outAnalyser = ctx.createAnalyser();
    outAnalyser.fftSize = 1024;
    outGain.connect(outAnalyser);
    outAnalyser.connect(ctx.destination);
    samples = new Float32Array(1024);
    const granted = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (closed) {
      granted.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = granted;
    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 1024;
    micAnalyser.smoothingTimeConstant = 0.2;
    ctx.createMediaStreamSource(stream).connect(micAnalyser);
  }
  function rms(analyser) {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  // "Got it": a soft rising two-note chime and a ripple off the orb the moment the user's turn
  // ends, so the wait for the reply never feels like dead air.
  function acknowledge() {
    root.classList.remove("is-heard");
    void root.offsetWidth; // restart the ripple
    root.classList.add("is-heard");
    clearTimeout(acknowledge.timer);
    acknowledge.timer = setTimeout(() => {
      root.classList.remove("is-heard");
      if (phase === "thinking" && $("[data-voice-status] span").textContent === "Got it") setStatus("Thinking");
    }, 1100);
    playChime(ctx, CHIMES.heard);
  }

  /* Speech out */
  function resetSpeech() {
    speechGen += 1;
    speechAbort.abort();
    speechAbort = new AbortController();
    jobs = [];
    activeJobs = 0;
    chain = Promise.resolve();
    pendingSpeech = 0;
    current?.stop();
    current = null;
    queue = [];
  }
  function startJobs() {
    const gen = speechGen;
    while (activeJobs < TTS_PARALLEL && jobs.length) {
      const job = jobs.shift();
      activeJobs += 1;
      const { voice, speed } = prefs();
      api.speak(job.speech, voice, speed, { signal: speechAbort.signal })
        .then((bytes) => ctx.decodeAudioData(bytes))
        .catch(() => null)
        .then((buffer) => {
          if (gen !== speechGen) return;
          activeJobs -= 1;
          job.resolve(buffer);
          startJobs();
        });
    }
  }
  function say(text) {
    if (text.length > SPEECH_CHUNK_MAX_CHARS) {
      for (const piece of splitForSpeech(text)) say(piece);
      return;
    }
    const speech = spokenText(text);
    if (!speech) return;
    const gen = speechGen;
    const job = { text, speech };
    job.ready = new Promise((resolve) => { job.resolve = resolve; });
    jobs.push(job);
    pendingSpeech += 1;
    chain = chain.then(() => job.ready).then((buffer) => {
      if (gen !== speechGen) return;
      pendingSpeech -= 1;
      queue.push({ buffer, text });
      pump();
    });
    startJobs();
  }
  function pump() {
    if (current || !queue.length || closed) return;
    const item = queue.shift();
    setPhase("speaking");
    markSpoken(item.text);
    const next = () => {
      current = null;
      pump();
      settle();
    };
    if (!item.buffer) {
      // This sentence could not be recorded: leave it on screen for a reading beat.
      const timer = setTimeout(next, Math.min(5000, 260 * item.text.split(/\s+/).length));
      current = { stop: () => clearTimeout(timer) };
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = item.buffer;
    source.connect(outGain);
    source.onended = () => { if (current?.source === source) next(); };
    source.start();
    current = { source, stop: () => { source.onended = null; try { source.stop(); } catch { /* already stopped */ } } };
  }

  /* Turns */
  async function runTurn(text) {
    const seq = ++turnSeq;
    resetSpeech();
    turnDone = false;
    reply = { full: "", spoken: 0, cut: false };
    paintYou(text);
    setPhase("thinking", root.classList.contains("is-heard") ? "Got it" : LABELS.thinking);
    paintReply();
    const chunker = createSpeechChunker();
    let seen = "";
    streaming = true;
    let outcome = null;
    let ended = false;
    // Speak the tail as soon as the stream ends, not after the chat finishes refreshing.
    const endStream = () => {
      if (ended || seq !== turnSeq || closed) return;
      ended = true;
      streaming = false;
      for (const chunk of chunker.flush()) say(chunk);
      turnDone = true;
      settle();
    };
    try {
      outcome = await sendTurn(text, {
        onStreamEnd: endStream,
        onStart: (abort) => { if (seq === turnSeq) abortTurn = abort; else abort(); },
        onTool: () => { if (seq === turnSeq && phase === "thinking") setStatus("Looking that up"); },
        onText: (full) => {
          if (seq !== turnSeq || closed) return;
          let delta;
          if (full.startsWith(seen)) delta = full.slice(seen.length);
          else {
            // The answer restarted after a tool call: speak the new text from its start.
            delta = `\n${full}`;
            reply.spoken = 0;
          }
          seen = full;
          if (!delta) return;
          reply.full = full;
          if (phase === "thinking") setStatus("Thinking");
          paintReply();
          for (const chunk of chunker.push(delta)) say(chunk);
        }
      });
    } catch (error) {
      outcome = { error: error?.message || "Klui could not answer." };
    }
    // A superseded turn must not touch the shared state: a newer turn may own it by now.
    if (seq !== turnSeq || closed) return;
    streaming = false;
    abortTurn = null;
    if (!outcome) {
      onToast?.("Wait for the current reply to finish.");
      beginListening();
      return;
    }
    if (outcome.error && !reply.full.trim()) {
      resetSpeech();
      turnDone = false;
      replyLine.innerHTML = `<span class="voice-error">${escapeHtml(outcome.error)}</span>`;
      beginListening();
      return;
    }
    endStream();
  }
  // Hands the floor back once every sentence of the reply has been spoken.
  function settle() {
    if (!turnDone || current || queue.length || pendingSpeech || closed) return;
    turnDone = false;
    reply.spoken = reply.full.length;
    paintReply();
    beginListening();
  }
  function interrupt(byVoice) {
    if (phase !== "speaking" && phase !== "thinking") return;
    turnSeq += 1;
    if (streaming) abortTurn?.();
    streaming = false;
    abortTurn = null;
    resetSpeech();
    turnDone = false;
    if (reply.full) {
      reply.full = reply.full.slice(0, reply.spoken).trimEnd();
      reply.cut = Boolean(reply.full);
      paintReply();
    }
    beginListening();
    if (byVoice && listen) {
      const now = performance.now();
      listen.heard = true;
      listen.firstVoiceAt = now - 300;
      listen.lastVoiceAt = now;
      listen.voicedMs = 300;
      paintYou("", true);
    }
  }

  /* Listening */
  function startRecorder(state) {
    const type = recordingType();
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    state.recorder = recorder;
    state.chunks = [];
    state.type = recorder.mimeType || type || "audio/webm";
    state.recordStart = performance.now();
    state.waiters = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) state.chunks.push(event.data);
      state.waiters.splice(0).forEach((resolve) => resolve());
    });
    recorder.start(250);
  }
  function stopRecorder(state) {
    return new Promise((resolve) => {
      const recorder = state?.recorder;
      if (!recorder || recorder.state === "inactive") { resolve(); return; }
      recorder.addEventListener("stop", () => resolve(), { once: true });
      try { recorder.stop(); } catch { resolve(); }
    });
  }
  function snapshot(state) {
    return new Promise((resolve) => {
      const done = () => resolve(new Blob(state.chunks, { type: state.type }));
      if (state.recorder?.state !== "recording") { done(); return; }
      state.waiters.push(done);
      try { state.recorder.requestData(); } catch { done(); }
    });
  }
  function dropListening() {
    if (!listen) return;
    const state = listen;
    listen = null;
    state.abort?.abort();
    void stopRecorder(state);
  }
  function beginListening() {
    if (closed) return;
    dropListening();
    if (muted || !stream) {
      setPhase("muted");
      return;
    }
    setPhase("listening");
    const now = performance.now();
    listen = { startedAt: now, heard: false, voicedRun: 0, voicedMs: 0, firstVoiceAt: 0, lastVoiceAt: 0, spec: null, abort: new AbortController() };
    startRecorder(listen);
  }
  async function restartRecorder(state) {
    await stopRecorder(state);
    if (listen === state && !closed) startRecorder(state);
  }
  // Transcribes what has been said so far during a pause, so the reply can start the moment
  // the pause turns out to be the end of the turn.
  function speculate(state) {
    const spec = { at: state.lastVoiceAt, done: false, text: "", complete: false };
    state.spec = spec;
    spec.promise = (async () => {
      try {
        const blob = await snapshot(state);
        const result = await api.transcribe(blob, { signal: state.abort.signal });
        spec.text = String(result?.text || "").trim();
      } catch {
        spec.failed = true;
      }
      spec.complete = looksComplete(spec.text);
      spec.done = true;
      return spec;
    })();
  }
  function listenTick(level, now) {
    const state = listen;
    if (!state) return;
    const on = Math.max(0.014, floor * 3.2);
    const off = on * 0.62;
    if (level > on) {
      state.voicedRun += TICK_MS;
      if (state.voicedRun >= 120) {
        if (!state.heard) {
          state.heard = true;
          state.firstVoiceAt = now - state.voicedRun;
          paintYou("", true);
          reply = { full: "", spoken: 0, cut: false };
          paintReply();
        }
        state.lastVoiceAt = now;
        state.voicedMs += TICK_MS;
        setStatus("Listening");
        setHint("");
      }
    } else if (level < off) {
      state.voicedRun = 0;
    }
    if (!state.heard) {
      // Drop long silences from the recording so the eventual clip stays short.
      if (now - state.recordStart > 20_000) void restartRecorder(state);
      return;
    }
    const silence = now - state.lastVoiceAt;
    if (silence >= 500 && state.spec?.at !== state.lastVoiceAt) speculate(state);
    const spec = state.spec?.at === state.lastVoiceAt && state.spec.done ? state.spec : null;
    if (spec && !spec.failed && !spec.text) {
      // Only noise so far: keep listening as if nothing was said.
      if (silence > 1200) {
        state.heard = false;
        state.voicedMs = 0;
        paintYou("");
        setStatus("Listening");
        void restartRecorder(state);
      }
      return;
    }
    if (spec?.text) paintYou(spec.text, true);
    const wait = endOfTurnSilence({ answering: false, complete: spec ? spec.complete : null, voicedMs: state.voicedMs });
    if (silence > 2600) {
      setStatus("Take your time");
      setHint("Tap the orb when you're done");
    }
    if (silence >= wait || now - state.firstVoiceAt > 150_000) void endListening(spec);
  }
  async function endListening(spec) {
    const state = listen;
    if (!state) return;
    listen = null;
    if (!state.heard) {
      await stopRecorder(state);
      beginListening();
      return;
    }
    setPhase("thinking", "Got it");
    acknowledge();
    paintReply();
    let text = "";
    try {
      const pending = spec || (state.spec?.at === state.lastVoiceAt ? state.spec : null);
      if (pending && !pending.done) await pending.promise;
      if (pending?.done && !pending.failed) {
        text = pending.text;
        await stopRecorder(state);
      } else {
        await stopRecorder(state);
        const result = await api.transcribe(new Blob(state.chunks, { type: state.type }), { signal: state.abort.signal });
        text = String(result?.text || "").trim();
      }
    } catch (error) {
      if (!closed) onToast?.(error?.message || "Could not catch that. Try again.");
    }
    if (closed || listen) return;
    if (!text) {
      paintYou("");
      beginListening();
      return;
    }
    void runTurn(text);
  }

  /* Loop */
  const bargeThreshold = () => Math.max(0.035, floor * 5, echo * 2.6);
  function tick() {
    if (closed) return;
    const now = performance.now();
    const mic = muted ? 0 : rms(micAnalyser);
    const out = rms(outAnalyser);
    // Learn the echo of Klui's own voice only from frames quieter than a barge-in.
    if (phase === "speaking") { if (mic < bargeThreshold()) echo = echo * 0.95 + mic * 0.05; }
    else if (!listen?.heard && mic < floor * 2.5) floor = mic < floor ? floor * 0.85 + mic * 0.15 : floor * 0.995 + mic * 0.005;
    floor = Math.max(0.002, Math.min(0.05, floor));
    const level = phase === "speaking" ? out * 5.5 : phase === "listening" && listen?.heard ? mic * 7 : phase === "listening" ? mic * 3 : 0;
    orb.setLevel(level);
    satellites.setLevel(level);
    root.style.setProperty("--voice-level", Math.min(1, level).toFixed(3));
    if (phase === "listening") listenTick(mic, now);
    else if (phase === "speaking" && stream && !muted) {
      // Jumping in: clearly louder than the room and the echo, for about 0.3 seconds.
      barge = mic > bargeThreshold() ? barge + TICK_MS : Math.max(0, barge - TICK_MS * 2);
      if (barge >= 300) {
        barge = 0;
        interrupt(true);
      }
    } else barge = 0;
  }

  function setMuted(on) {
    muted = Boolean(on);
    const button = $("[data-voice-mute]");
    button.innerHTML = muted ? VOICE_ICONS.micOff : VOICE_ICONS.mic;
    button.setAttribute("aria-pressed", String(muted));
    button.setAttribute("aria-label", muted ? "Turn microphone on" : "Mute microphone");
    button.title = muted ? "Unmute" : "Mute";
    root.classList.toggle("is-muted", muted);
    stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    if (muted && phase === "listening") beginListening();
    else if (!muted && phase === "muted") beginListening();
  }

  async function close() {
    if (closed) return;
    closed = true;
    turnSeq += 1;
    // A reply still being written finishes in the chat; only the voice stops.
    resetSpeech();
    clearInterval(ticker);
    document.removeEventListener("keydown", onKey, true);
    if (listen) {
      const state = listen;
      listen = null;
      state.abort?.abort();
      await stopRecorder(state);
    }
    stream?.getTracks().forEach((track) => track.stop());
    // Call ended: the start chime played back down.
    const tail = playChime(ctx, CHIMES.end);
    root.classList.add("is-closing");
    await new Promise((resolve) => setTimeout(resolve, Math.max(reducedMotion ? 0 : 280, tail * 1000)));
    orb.stop();
    satellites.stop();
    ctx?.close().catch(() => {});
    root.remove();
    onClose?.();
  }

  function onKey(event) {
    if (event.key !== "Escape" || document.querySelector(".voice-picker-dialog")) return;
    event.stopPropagation();
    void close();
  }

  root.addEventListener("click", async (event) => {
    if (event.target.closest("[data-voice-end]")) { void close(); return; }
    if (event.target.closest("[data-voice-mute]")) { setMuted(!muted); return; }
    if (event.target.closest("[data-voice-pick]")) {
      await pickVoice?.();
      if (!closed) paintChip();
      return;
    }
    if (event.target.closest("[data-voice-orb]")) {
      if (phase === "muted") setMuted(false);
      else if (phase === "speaking" || phase === "thinking") interrupt(false);
      else if (phase === "listening" && listen?.heard) void endListening(listen.spec?.at === listen.lastVoiceAt ? listen.spec : null);
    }
  });

  return {
    root,
    get active() { return !closed; },
    async start() {
      if (started) return;
      started = true;
      paintChip();
      document.addEventListener("keydown", onKey, true);
      setPhase("connecting");
      orb.start();
      satellites.start();
      requestAnimationFrame(() => root.classList.add("is-open"));
      try {
        await openAudio();
      } catch (error) {
        onToast?.(error?.name === "NotAllowedError" ? "Microphone access was blocked. Allow it to talk with Klui." : "Could not start the microphone.");
        void close();
        return;
      }
      if (closed) return;
      // Call connected: a soft rising three-note chime.
      playChime(ctx, CHIMES.start);
      ticker = setInterval(tick, TICK_MS);
      beginListening();
      setHint("Go ahead, I'm listening");
    },
    close
  };
}

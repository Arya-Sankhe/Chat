/* The voice picker: one animated orb per voice, stepped with the arrows, the
   dots, arrow keys or a swipe, plus the speaking speed. Previews play the
   prerecorded clips. Used in Settings → Voice and in the modal chooser
   (VoicePickerDialog, opened through state/voicePicker.ts). */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { createOrb } from "../islands/studyTutor.js";
import {
  DEFAULT_SPEECH_ENGINE,
  VOICE_ICONS,
  VOICE_OPTIONS,
  VOICE_SPEEDS,
  normalizeVoiceId,
  normalizeVoiceSpeed,
  voiceOption as findVoice,
  voicePreviewUrl
} from "../islands/voiceMode.js";
import { showToast, updateSetting, useApp } from "../state/app";
import { finishVoicePicker, useVoicePicker, type VoiceChoice, type VoicePickerRequest } from "../state/voicePicker";
import { cx } from "./cx";

type Voice = (typeof VOICE_OPTIONS)[number];
type Palette = Voice["palette"];
/** Unknown ids fall back to the first voice. */
const voiceOption = (id: string) => findVoice(id) as Voice;
const voiceAt = (index: number) => VOICE_OPTIONS[index] as Voice;
type Flags = { playing: boolean; loading: boolean };

export type VoicePickerApi = {
  readonly value: VoiceChoice;
  step(delta: number): void;
  preview(): Promise<void>;
  stopPreview(): void;
  refresh(): void;
};

const rgb = (color: number[]) => `rgb(${color.join(" ")})`;

/** A voice's colors as CSS variables (dots, speed thumb, buttons, chip). */
function tintStyle(id: string) {
  const { palette } = voiceOption(id);
  return { "--vp-deep": rgb(palette.a), "--vp-soft": rgb(palette.b) } as CSSProperties;
}

export function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

async function fetchVoicePreview(voice: string, speed: number, engine: string) {
  const response = await fetch(voicePreviewUrl(voice, speed, engine));
  if (!response.ok) throw new Error("Could not play the preview.");
  return response.arrayBuffer();
}

/** The orb and the preview audio. Clips are fetched and decoded once; the
   orb follows the clip's loudness while it plays. */
function createPreviewPlayer({
  canvas,
  calm,
  current,
  loadPreview,
  onError,
  setFlags
}: {
  canvas: HTMLCanvasElement;
  calm: boolean;
  current: () => VoiceChoice;
  loadPreview: (voice: string, speed: number) => Promise<ArrayBuffer>;
  onError: (message: string) => void;
  setFlags: (flags: Flags) => void;
}) {
  const orb = createOrb(canvas, { calm });
  orb.setPalette(voiceOption(current().voice).palette, { instant: true });
  orb.setMode("idle");
  orb.start();
  const cache = new Map<string, Promise<AudioBuffer>>();
  const ready = new Set<string>();
  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let meter = 0;
  let playToken = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let flags: Flags = { playing: false, loading: false };
  let destroyed = false;
  const flag = (next: Partial<Flags>) => {
    flags = { ...flags, ...next };
    if (!destroyed) setFlags(flags);
  };
  const keyOf = ({ voice, speed }: VoiceChoice) => `${voice}|${speed}`;

  function stopPreview() {
    playToken += 1;
    clearTimeout(debounce);
    cancelAnimationFrame(meter);
    try { source?.stop(); } catch {}
    source = null;
    orb.setMode("idle");
    orb.setLevel(0);
    flag({ playing: false, loading: false });
  }
  function audioContext() {
    const Context = window.AudioContext || (window as any).webkitAudioContext;
    ctx ||= new Context();
    return ctx!;
  }
  // Decoding works while the context is still suspended.
  function clip(voice: string, speed: number) {
    const key = `${voice}|${speed}`;
    if (!cache.has(key)) {
      const pending = Promise.resolve(loadPreview(voice, speed))
        .then((bytes) => audioContext().decodeAudioData(bytes.slice(0)))
        .then((buffer) => { ready.add(key); return buffer; });
      pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
      cache.set(key, pending);
    }
    return cache.get(key)!;
  }
  // The next voice either way and the other speeds of this one, so the next pick plays at once.
  function prefetch() {
    const { voice, speed } = current();
    const index = VOICE_OPTIONS.findIndex((item) => item.id === voice);
    const near = [voiceAt((index + 1) % VOICE_OPTIONS.length), voiceAt((index + VOICE_OPTIONS.length - 1) % VOICE_OPTIONS.length)];
    for (const item of near) clip(item.id, speed).catch(() => {});
    for (const { value } of VOICE_SPEEDS) clip(voice, value).catch(() => {});
  }
  async function preview() {
    if (destroyed) return;
    stopPreview();
    const token = playToken;
    const picked = current();
    if (!ready.has(keyOf(picked))) {
      flag({ loading: true });
      orb.setMode("thinking");
    }
    try {
      const context = audioContext();
      if (context.state === "suspended") await context.resume().catch(() => {});
      const pending = clip(picked.voice, picked.speed);
      prefetch();
      const buffer = await pending;
      if (token !== playToken) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.connect(context.destination);
      const playing = context.createBufferSource();
      source = playing;
      playing.buffer = buffer;
      playing.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const pump = () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        orb.setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 7));
        meter = requestAnimationFrame(pump);
      };
      playing.addEventListener("ended", () => { if (token === playToken) stopPreview(); }, { once: true });
      flag({ loading: false, playing: true });
      orb.setMode("speaking");
      playing.start();
      pump();
    } catch (error: any) {
      if (token !== playToken) return;
      stopPreview();
      if (error?.name !== "NotAllowedError" && error?.name !== "AbortError") onError(error?.message || "Could not play the preview.");
    }
  }
  // A clip already in memory plays at once; otherwise a short pause means rapid
  // stepping only fetches the voice you land on.
  function queuePreview() {
    stopPreview();
    if (ready.has(keyOf(current()))) void preview();
    else debounce = setTimeout(() => void preview(), 120);
  }
  return {
    preview,
    queuePreview,
    stopPreview,
    playing: () => flags.playing,
    recolor: (palette: Palette) => orb.setPalette(palette),
    destroy() {
      stopPreview();
      destroyed = true;
      orb.stop();
      cache.clear();
      ctx?.close().catch(() => {});
    }
  };
}

type Player = ReturnType<typeof createPreviewPlayer>;

export function VoicePicker({
  voice,
  speed,
  engine = DEFAULT_SPEECH_ENGINE,
  onChange,
  onError,
  reducedMotion = false,
  apiRef
}: {
  voice: string;
  speed: number;
  engine?: string;
  onChange?: (choice: VoiceChoice) => void;
  onError?: (message: string) => void;
  reducedMotion?: boolean;
  apiRef?: MutableRefObject<VoicePickerApi | null>;
}) {
  const [value, setValue] = useState<VoiceChoice>(() => ({ voice: normalizeVoiceId(voice), speed: normalizeVoiceSpeed(speed) }));
  const [moves, setMoves] = useState({ count: 0, from: 1 });
  const [flags, setFlags] = useState<Flags>({ playing: false, loading: false });
  const valueRef = useRef(value);
  const callbacks = useRef({ onChange, onError });
  callbacks.current = { onChange, onError };
  const canvas = useRef<HTMLCanvasElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const speedGroup = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const paintSpeedThumb = () => {
    const picked = speedGroup.current?.querySelector<HTMLElement>("[data-voice-speed].is-picked");
    const el = thumb.current;
    if (!picked || !el || !picked.offsetWidth) return;
    el.style.width = `${picked.offsetWidth}px`;
    el.style.transform = `translateX(${picked.offsetLeft}px)`;
  };

  function select(next: Partial<VoiceChoice>, direction = 0) {
    const previous = valueRef.current;
    const changedVoice = Boolean(next.voice && next.voice !== previous.voice);
    const state = { ...previous, ...next };
    valueRef.current = state;
    setValue(state);
    if (changedVoice) {
      player.current?.recolor(voiceOption(state.voice).palette);
      // The name slides in from the side we moved toward; the orb recolors in place.
      setMoves((m) => ({ count: m.count + 1, from: direction < 0 ? -1 : 1 }));
    }
    callbacks.current.onChange?.({ ...state });
  }
  function step(delta: number) {
    const index = VOICE_OPTIONS.findIndex((item) => item.id === valueRef.current.voice);
    select({ voice: voiceAt((index + delta + VOICE_OPTIONS.length) % VOICE_OPTIONS.length).id }, delta);
    player.current?.queuePreview();
  }

  useLayoutEffect(() => {
    const created = createPreviewPlayer({
      canvas: canvas.current!,
      calm: reducedMotion,
      current: () => valueRef.current,
      loadPreview: (id, pace) => fetchVoicePreview(id, pace, engine),
      onError: (message) => callbacks.current.onError?.(message),
      setFlags
    });
    player.current = created;
    const frame = requestAnimationFrame(paintSpeedThumb);
    window.addEventListener("resize", paintSpeedThumb);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", paintSpeedThumb);
      created.destroy();
      if (player.current === created) player.current = null;
    };
    // The player lives as long as the picker; its inputs are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(paintSpeedThumb, [value.speed]);

  if (apiRef) {
    apiRef.current = {
      get value() { return { ...valueRef.current }; },
      step,
      preview: () => player.current?.preview() ?? Promise.resolve(),
      stopPreview: () => player.current?.stopPreview(),
      refresh: paintSpeedThumb
    };
  }

  const picked = voiceOption(value.voice);
  const style = { ...tintStyle(value.voice), ...(moves.count ? { "--vp-from": String(moves.from) } : {}) } as CSSProperties;
  const onPointerUp = (event: ReactPointerEvent) => {
    const start = swipe.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    swipe.current = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
  };
  return (
    <div
      className={cx("voice-picker", { "is-moving": moves.count > 0, "is-playing": flags.playing, "is-loading": flags.loading })}
      data-voice={picked.id}
      style={style}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        step(event.key === "ArrowRight" ? 1 : -1);
      }}
    >
      <div
        className="vp-stage"
        onPointerDown={(event) => { if (event.isPrimary) swipe.current = { x: event.clientX, y: event.clientY }; }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { swipe.current = null; }}
      >
        <button className="vp-arrow" type="button" data-voice-step="-1" aria-label="Previous voice" onClick={() => step(-1)} dangerouslySetInnerHTML={{ __html: VOICE_ICONS.prev }} />
        <div
          className="vp-orb"
          data-vp-orb=""
          aria-hidden="true"
          onClick={() => {
            if (player.current?.playing()) player.current.stopPreview();
            else void player.current?.preview();
          }}
        >
          <canvas ref={canvas} />
        </div>
        <button className="vp-arrow" type="button" data-voice-step="1" aria-label="Next voice" onClick={() => step(1)} dangerouslySetInnerHTML={{ __html: VOICE_ICONS.next }} />
      </div>
      <div className="vp-name" aria-live="polite">
        <span data-vp-name="" key={moves.count}>
          <strong>{picked.name}</strong>
          <small>{picked.tone}</small>
        </span>
      </div>
      <div className="vp-dots" role="tablist" aria-label="Voice">
        {VOICE_OPTIONS.map((item, to) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-label={item.name}
            aria-selected={item.id === picked.id}
            data-voice-id={item.id}
            className={item.id === picked.id ? "is-picked" : undefined}
            onClick={() => {
              const from = VOICE_OPTIONS.findIndex((option) => option.id === valueRef.current.voice);
              if (to === from) { void player.current?.preview(); return; }
              select({ voice: item.id }, to - from);
              player.current?.queuePreview();
            }}
          />
        ))}
      </div>
      <div className="vp-speed" role="radiogroup" aria-label="Speaking speed" ref={speedGroup}>
        <span className="vp-speed-thumb" aria-hidden="true" ref={thumb} />
        {VOICE_SPEEDS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={item.value === value.speed}
            data-voice-speed={item.value}
            className={item.value === value.speed ? "is-picked" : undefined}
            onClick={() => {
              select({ speed: normalizeVoiceSpeed(item.value) });
              player.current?.queuePreview();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Settings → Voice: every pick is saved at once. Mounted while the tab shows. */
export function SettingsVoicePicker() {
  const [initial] = useState(() => {
    const { settings } = useApp.getState();
    return { voice: normalizeVoiceId(settings.voiceId), speed: normalizeVoiceSpeed(settings.voiceSpeed) };
  });
  return <VoicePicker voice={initial.voice} speed={initial.speed} onChange={saveVoicePrefs} onError={showToast} reducedMotion={prefersReducedMotion()} />;
}

export function saveVoicePrefs({ voice, speed }: VoiceChoice) {
  updateSetting("voiceId", normalizeVoiceId(voice));
  updateSetting("voiceSpeed", normalizeVoiceSpeed(speed));
  updateSetting("voiceChosen", true);
}

/** The modal chooser; Esc or a tap outside dismisses it. */
export function VoicePickerDialog() {
  const dialog = useVoicePicker((s) => s.dialog);
  if (!dialog) return null;
  return createPortal(<VoicePickerModal key={dialog.id} dialog={dialog} />, document.body);
}

function VoicePickerModal({ dialog }: { dialog: VoicePickerRequest }) {
  const api = useRef<VoicePickerApi | null>(null);
  const save = useRef<HTMLButtonElement>(null);
  const [tint, setTint] = useState(() => normalizeVoiceId(dialog.voice));
  const [shown, setShown] = useState(false);
  const closing = dialog.closing;
  const close = (saved: boolean) => {
    if (useVoicePicker.getState().dialog?.closing) return;
    const value = api.current?.value ?? { voice: normalizeVoiceId(dialog.voice), speed: normalizeVoiceSpeed(dialog.speed) };
    api.current?.stopPreview();
    finishVoicePicker(dialog.id, saved ? value : null);
  };

  useLayoutEffect(() => {
    save.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => {
      setShown(true);
      api.current?.refresh();
    });
    // Opening came from a click, so the first voice can speak right away.
    const speak = setTimeout(() => {
      if (!useVoicePicker.getState().dialog?.closing) void api.current?.preview();
    }, dialog.reducedMotion ? 0 : 320);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(speak);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (closing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(false);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if ((event.target as Element | null)?.closest?.(".voice-picker")) return; // the picker handles its own
        event.preventDefault();
        api.current?.step(event.key === "ArrowRight" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  return (
    <div className={cx("voice-picker-dialog", { "is-open": shown && !closing, "is-closing": closing })}>
      <div className="voice-picker-backdrop" data-voice-cancel="" onClick={() => close(false)} />
      <section className="voice-picker-card" role="dialog" aria-modal="true" aria-label="Choose a voice" style={tintStyle(tint)}>
        <VoicePicker
          voice={dialog.voice}
          speed={dialog.speed}
          engine={dialog.engine}
          onError={dialog.onError}
          reducedMotion={dialog.reducedMotion}
          onChange={({ voice }) => setTint(voice)}
          apiRef={api}
        />
        <button className="vp-save" type="button" data-voice-save="" ref={save} onClick={() => close(true)}>
          {dialog.first ? (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
              </svg>
              <span>Start talking</span>
            </>
          ) : (
            <span>Done</span>
          )}
        </button>
      </section>
    </div>
  );
}

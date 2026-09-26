// Audio sources in Dojo: the lecture player shown in the Sources preview slot.
// It reuses the podcast player's look and audio controller; transcript lines carry
// timestamps instead of speakers. The viewer keeps its own state so studyHub can repaint
// the panel at any time and simply mount it again.

import { activeLine, createPodcastAudio, formatDurationLabel, formatTime, PLAYER_ICONS, PODCAST_SPEEDS, speedLabel, syncSpeedMenu } from "./studyPodcast.js";

const SKIP_SECONDS = 10;
const svg = (paths, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  download: svg('<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  back10: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><text x="12.2" y="15.4" fill="currentColor" stroke="none" font-size="7.4" font-weight="700" text-anchor="middle" font-family="system-ui, sans-serif">10</text>', 22),
  fwd10: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/><text x="11.8" y="15.4" fill="currentColor" stroke="none" font-size="7.4" font-weight="700" text-anchor="middle" font-family="system-ui, sans-serif">10</text>', 22),
  speed: svg('<path d="M12 20a8 8 0 1 1 8-8"/><path d="m12 12 4-3"/>')
};

export function createAudioSourceViewer({ escapeHtml, fetchAudio, showToast, onClose, reducedMotion = () => false }) {
  let view = null; // { id, audio, error, speedOpen, scrubbing }
  let root = null;
  let scrolledAt = 0;
  const player = createPodcastAudio({
    onUpdate: patch,
    refreshUrl: async (id) => (await fetchAudio(id))?.audio?.audioUrl || ""
  });

  function meta(audio) {
    const date = audio.createdAt ? new Date(audio.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    return [formatDurationLabel(audio.durationSeconds), audio.source === "recording" ? "Recorded" : "Uploaded", audio.wordCount ? `${audio.wordCount.toLocaleString()} words` : "", date].filter(Boolean).join(" · ");
  }

  function playerState() {
    const state = player.state();
    return player.id === view?.id ? state : { ...state, time: 0, playing: false, waiting: false };
  }

  function linesMarkup(audio, active) {
    if (!audio.transcript.length) return `<div class="study-empty"><strong>No transcript lines</strong><p>This recording has no timed transcript.</p></div>`;
    return audio.transcript.map((line, index) => {
      const state = index === active ? " is-active" : index < active ? " is-past" : "";
      return `<button class="dojo-pod-line dojo-lecture-line${state}" type="button" data-lec-line="${index}" data-start="${line.start}"><time>${formatTime(line.start)}</time><span class="dojo-pod-line-text">${escapeHtml(line.text)}</span></button>`;
    }).join("");
  }

  function markup() {
    const audio = view.audio;
    const title = audio?.title || view.title || "Audio";
    const head = `<header class="dojo-view-head dojo-pod-head">
      <span class="dojo-lecture-badge" aria-hidden="true">${svg('<path d="M3 12h2m3-5v10m4-13v16m4-11v6m3-3h2"/>')}</span>
      <span class="dojo-pod-title"><h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3><small>${audio ? escapeHtml(meta(audio)) : "Audio"}</small></span>
      ${audio?.transcript?.length ? `<button class="study-icon-btn" type="button" data-lec-copy aria-label="Copy transcript" title="Copy transcript">${ICONS.copy}</button>` : ""}
      ${audio?.downloadUrl ? `<a class="study-icon-btn dojo-pod-download" href="${escapeHtml(audio.downloadUrl)}" download aria-label="Download audio" title="Download audio">${ICONS.download}</a>` : ""}
      <button class="study-icon-btn" type="button" data-lec-close aria-label="Close" title="Close">${ICONS.close}</button>
    </header>`;
    if (view.error) {
      return `<div class="dojo-lecture">${head}<div class="dojo-lecture-body"><div class="study-empty"><strong>Could not load this recording</strong><p>${escapeHtml(view.error)}</p></div></div></div>`;
    }
    if (!audio) {
      return `<div class="dojo-lecture">${head}<div class="dojo-lecture-body"><div class="study-empty" role="status"><span class="study-spin" aria-hidden="true"></span><p>Loading transcript…</p></div></div></div>`;
    }
    const state = playerState();
    const duration = audio.durationSeconds || 0;
    const time = view.scrubbing ?? state.time;
    const progress = duration ? Math.min(100, (time / duration) * 100) : 0;
    const volume = state.muted ? 0 : state.volume;
    const active = activeLine(audio.transcript, time);
    const playable = Boolean(audio.audioUrl);
    return `<div class="dojo-lecture">
      ${head}
      ${playable ? `<section class="dojo-pod-player dojo-lecture-player${state.playing ? " is-playing" : ""}${state.waiting ? " is-waiting" : ""}" aria-label="Player">
        <div class="dojo-pod-scrub" style="--p: ${progress.toFixed(3)}%"><input type="range" min="0" max="${duration.toFixed(2)}" step="0.1" value="${Math.min(time, duration).toFixed(2)}" data-lec-seek aria-label="Seek" aria-valuetext="${formatTime(time)} of ${formatTime(duration)}"></div>
        <div class="dojo-pod-times"><span data-lec-time>${formatTime(time)}</span><span data-lec-left>-${formatTime(Math.max(0, duration - time))}</span></div>
        <div class="dojo-pod-transport">
          <button class="dojo-pod-skip" type="button" data-lec-skip="-${SKIP_SECONDS}" aria-label="Back ${SKIP_SECONDS} seconds" title="Back ${SKIP_SECONDS}s">${ICONS.back10}</button>
          <button class="dojo-pod-play" type="button" data-lec-toggle aria-label="${state.playing ? "Pause" : "Play"}" title="${state.playing ? "Pause" : "Play"} (Space)">${state.playing ? PLAYER_ICONS.pause : PLAYER_ICONS.play}</button>
          <button class="dojo-pod-skip" type="button" data-lec-skip="${SKIP_SECONDS}" aria-label="Forward ${SKIP_SECONDS} seconds" title="Forward ${SKIP_SECONDS}s">${ICONS.fwd10}</button>
        </div>
        <div class="dojo-pod-extras">
          <div class="dojo-pod-volume" style="--v: ${(volume * 100).toFixed(0)}%">
            <button class="study-icon-btn" type="button" data-lec-mute aria-label="${state.muted ? "Unmute" : "Mute"}" title="${state.muted ? "Unmute" : "Mute"}">${volume === 0 ? PLAYER_ICONS.muted : PLAYER_ICONS.volume}</button>
            <input type="range" min="0" max="1" step="0.05" value="${volume}" data-lec-volume aria-label="Volume">
          </div>
          <div class="dojo-pod-speed">
            <button class="dojo-pod-speed-btn${state.rate !== 1 ? " is-on" : ""}" type="button" data-lec-speed-toggle aria-haspopup="true" aria-expanded="${view.speedOpen}" aria-label="Playback speed ${speedLabel(state.rate)}" title="Playback speed">${ICONS.speed}<span>${speedLabel(state.rate)}</span></button>
            ${view.speedOpen ? `<div class="dojo-pod-speed-menu" role="group" aria-label="Playback speed">${PODCAST_SPEEDS.map((rate) => `<button type="button" data-lec-speed="${rate}" aria-pressed="${rate === state.rate}">${speedLabel(rate)}</button>`).join("")}</div>` : ""}
          </div>
        </div>
      </section>` : ""}
      <div class="dojo-pod-transcript-head"><span>Transcript</span><small>${playable ? "Tap a line to jump there" : ""}</small></div>
      <div class="dojo-lecture-body dojo-pod-transcript" data-lec-transcript data-active="${active}">${linesMarkup(audio, active)}</div>
    </div>`;
  }

  function paint() {
    if (!root || !view) return;
    const list = root.querySelector("[data-lec-transcript]");
    const scroll = list?.scrollTop;
    root.innerHTML = markup();
    const next = root.querySelector("[data-lec-transcript]");
    if (next && scroll) next.scrollTop = scroll;
  }

  function patch(kind) {
    if (!root || !view?.audio || player.id !== view.id) return;
    if (kind === "error") {
      showToast("This recording could not play. Try opening it again.");
      return;
    }
    const state = player.state();
    const section = root.querySelector(".dojo-pod-player");
    if (!section) return;
    if (kind === "state") {
      section.classList.toggle("is-playing", state.playing);
      section.classList.toggle("is-waiting", state.waiting);
      const toggle = section.querySelector("[data-lec-toggle]");
      const label = state.playing ? "Pause" : "Play";
      if (toggle && toggle.getAttribute("aria-label") !== label) {
        toggle.innerHTML = state.playing ? PLAYER_ICONS.pause : PLAYER_ICONS.play;
        toggle.setAttribute("aria-label", label);
        toggle.title = `${label} (Space)`;
      }
      syncSpeedMenu(section.querySelector(".dojo-pod-speed"), { open: view.speedOpen, rate: state.rate, attr: "lec" });
    }
    if (kind === "volume") {
      const wrap = section.querySelector(".dojo-pod-volume");
      const value = state.muted ? 0 : state.volume;
      wrap?.style.setProperty("--v", `${Math.round(value * 100)}%`);
      const range = wrap?.querySelector("[data-lec-volume]");
      if (range && document.activeElement !== range) range.value = String(value);
      const mute = wrap?.querySelector("[data-lec-mute]");
      if (mute) mute.innerHTML = value === 0 ? PLAYER_ICONS.muted : PLAYER_ICONS.volume;
      return;
    }
    patchTime(state);
  }

  function patchTime(state) {
    const audio = view.audio;
    const duration = audio.durationSeconds || 0;
    const time = view.scrubbing ?? state.time;
    const scrub = root.querySelector(".dojo-pod-scrub");
    const seek = scrub?.querySelector("[data-lec-seek]");
    if (seek) {
      if (view.scrubbing == null) seek.value = Math.min(time, duration).toFixed(2);
      scrub.style.setProperty("--p", `${duration ? Math.min(100, (time / duration) * 100).toFixed(3) : 0}%`);
      seek.setAttribute("aria-valuetext", `${formatTime(time)} of ${formatTime(duration)}`);
    }
    const now = root.querySelector("[data-lec-time]");
    if (now) now.textContent = formatTime(time);
    const left = root.querySelector("[data-lec-left]");
    if (left) left.textContent = `-${formatTime(Math.max(0, duration - time))}`;
    const index = activeLine(audio.transcript, time);
    const list = root.querySelector("[data-lec-transcript]");
    if (!list || list.dataset.active === String(index)) return;
    list.dataset.active = String(index);
    let current = null;
    list.querySelectorAll("[data-lec-line]").forEach((line) => {
      const at = Number(line.dataset.lecLine);
      line.classList.toggle("is-active", at === index);
      line.classList.toggle("is-past", at < index);
      if (at === index) current = line;
    });
    // Follow playback unless the reader scrolled in the last few seconds.
    if (current && state.playing && Date.now() - scrolledAt > 4000) {
      const top = current.offsetTop - list.offsetTop - list.clientHeight * 0.28;
      list.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }

  function setSpeedOpen(open, focusSelector = "") {
    view.speedOpen = open;
    syncSpeedMenu(root?.querySelector(".dojo-pod-speed"), { open, rate: player.state().rate, attr: "lec" });
    if (focusSelector) root?.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  function onClick(event) {
    if (!view) return;
    event.stopPropagation();
    if (event.target.closest("[data-lec-close]")) { close(event); return; }
    if (event.target.closest("[data-lec-copy]")) {
      const text = (view.audio?.transcript || []).map((line) => `[${formatTime(line.start)}] ${line.text}`).join("\n");
      navigator.clipboard?.writeText(text).then(() => showToast("Transcript copied."), () => showToast("Copy failed."));
      return;
    }
    if (!view.audio?.audioUrl) return;
    if (view.speedOpen && !event.target.closest(".dojo-pod-speed")) setSpeedOpen(false);
    if (event.target.closest("[data-lec-toggle]")) { ensureLoaded(); void player.toggle(); return; }
    const skip = event.target.closest("[data-lec-skip]");
    if (skip) { ensureLoaded(); player.skip(Number(skip.dataset.lecSkip)); return; }
    if (event.target.closest("[data-lec-mute]")) { player.toggleMute(); return; }
    if (event.target.closest("[data-lec-speed-toggle]")) {
      const open = !view.speedOpen;
      setSpeedOpen(open, open ? `[data-lec-speed="${player.state().rate}"]` : "");
      return;
    }
    const speed = event.target.closest("[data-lec-speed]");
    if (speed) {
      player.setRate(Number(speed.dataset.lecSpeed));
      setSpeedOpen(false, "[data-lec-speed-toggle]");
      return;
    }
    const line = event.target.closest("[data-lec-line]");
    if (line) {
      scrolledAt = 0;
      ensureLoaded();
      player.seek(Number(line.dataset.start), { play: true });
    }
  }

  function onInput(event) {
    if (!view?.audio) return;
    event.stopPropagation();
    if (event.target.matches("[data-lec-seek]")) {
      view.scrubbing = Number(event.target.value);
      patchTime(player.state());
    }
    if (event.target.matches("[data-lec-volume]")) player.setVolume(Number(event.target.value));
  }

  function onChange(event) {
    if (!view?.audio) return;
    event.stopPropagation();
    if (event.target.matches("[data-lec-seek]")) {
      ensureLoaded();
      player.seek(Number(event.target.value));
      view.scrubbing = null;
      scrolledAt = 0;
    }
  }

  function onKey(event) {
    if (!view?.audio?.audioUrl) return;
    if (event.key === " " && !event.target.matches?.("[data-lec-toggle], [data-lec-line], a, input:not([type=range])")) {
      event.preventDefault();
      event.stopPropagation();
      ensureLoaded();
      void player.toggle();
    }
    if (event.key === "Escape" && view.speedOpen) {
      event.stopPropagation();
      setSpeedOpen(false, "[data-lec-speed-toggle]");
    }
  }

  function onScroll(event) {
    if (event.target.closest?.("[data-lec-transcript]")) scrolledAt = Date.now();
  }

  function ensureLoaded() {
    if (view?.audio?.audioUrl && player.id !== view.id) player.load(view.id, view.audio.audioUrl);
  }

  async function load() {
    const current = view;
    try {
      const payload = await fetchAudio(current.id);
      if (view !== current) return;
      current.audio = payload?.audio || null;
      if (!current.audio) throw new Error("This recording is no longer available.");
      current.error = "";
    } catch (error) {
      if (view !== current) return;
      current.error = error.message || "Please try again.";
    }
    paint();
  }

  function mount(slot) {
    if (!slot || !view) return;
    if (root?.parentElement !== slot) {
      root = document.createElement("div");
      root.className = "dojo-lecture-root";
      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("change", onChange);
      root.addEventListener("keydown", onKey);
      root.addEventListener("scroll", onScroll, true);
      slot.replaceChildren(root);
    }
    paint();
  }

  function open(doc) {
    if (view?.id === doc.id) return;
    if (player.id && player.id !== doc.id) player.pause();
    view = { id: doc.id, title: doc.title, audio: null, error: "", speedOpen: false, scrubbing: null };
    void load();
  }

  function close(event, { silent = false } = {}) {
    if (!view) return;
    player.pause();
    const id = view.id;
    view = null;
    root = null;
    if (!silent) onClose?.(id, event);
  }

  return {
    open,
    mount,
    close,
    pause() { player.pause(); },
    get id() { return view?.id || ""; }
  };
}

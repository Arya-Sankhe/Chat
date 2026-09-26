// AI podcast: create-dialog options, the in-panel player markup, and the audio controller.
// studyHub owns when things render; everything markup-related here is a pure function of state.

// Mirrors server/study/podcast.js. Each voice is one of Kokoro's best-rated English voices.
export const PODCAST_VOICES = [
  { id: "af_heart", name: "Maya", tone: "Warm and natural", accent: "American" },
  { id: "af_bella", name: "Bella", tone: "Bright and upbeat", accent: "American" },
  { id: "bf_emma", name: "Emma", tone: "Calm and clear", accent: "British" },
  { id: "am_michael", name: "Michael", tone: "Steady and friendly", accent: "American" },
  { id: "am_fenrir", name: "Finn", tone: "Deep and direct", accent: "American" },
  { id: "am_puck", name: "Leo", tone: "Lively and curious", accent: "American" }
];

export const PODCAST_STYLES = [
  { value: "casual", title: "Casual", description: "Friendly chat with humor", roles: ["Host", "Co-host"] },
  { value: "professional", title: "Professional", description: "Polished and structured", roles: ["Lead", "Co-host"] },
  { value: "tutor", title: "Teacher & student", description: "Learn by asking questions", roles: ["Teacher", "Student"] },
  { value: "recall", title: "Exam prep", description: "Quiz yourself as you listen", roles: ["Coach", "Learner"] }
];

export const PODCAST_LENGTHS = [
  { value: "quick", title: "Quick", minutes: 4, description: "Key points overview" },
  { value: "standard", title: "Standard", minutes: 9, description: "Balanced walkthrough" },
  { value: "deep", title: "Deep dive", minutes: 15, description: "Detailed exploration" }
];

export const PODCAST_SPEEDS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SKIP_SECONDS = 10;

const svg = (paths, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  back: svg('<path d="M19 12H5m6-6-6 6 6 6"/>'),
  download: svg('<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>'),
  play: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.9l10-6.4a1 1 0 0 0 0-1.8l-10-6.4A1 1 0 0 0 8 5.6Z"/></svg>',
  pause: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/></svg>',
  back10: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><text x="12.2" y="15.4" fill="currentColor" stroke="none" font-size="7.4" font-weight="700" text-anchor="middle" font-family="system-ui, sans-serif">10</text>', 22),
  fwd10: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/><text x="11.8" y="15.4" fill="currentColor" stroke="none" font-size="7.4" font-weight="700" text-anchor="middle" font-family="system-ui, sans-serif">10</text>', 22),
  volume: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
  muted: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5m0-5-5 5"/>'),
  speed: svg('<path d="M12 20a8 8 0 1 1 8-8"/><path d="m12 12 4-3"/>'),
  think: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>')
};

export const PLAYER_ICONS = { play: ICONS.play, pause: ICONS.pause, volume: ICONS.volume, muted: ICONS.muted };

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

export function formatDurationLabel(seconds) {
  const total = Math.round(Number(seconds) || 0);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return secs ? `${minutes}m ${secs}s` : `${minutes}m`;
}

export function speedLabel(rate) {
  return `${Number(rate).toString()}×`;
}

// Opens, closes, or updates the speed menu in place. Re-rendering the player for this
// restarts its animations and swaps every icon, which reads as a flicker.
export function syncSpeedMenu(wrap, { open, rate, attr }) {
  if (!wrap) return null;
  const toggle = wrap.querySelector(`[data-${attr}-speed-toggle]`);
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", `Playback speed ${speedLabel(rate)}`);
    toggle.classList.toggle("is-on", rate !== 1);
    const label = toggle.querySelector("span");
    if (label && label.textContent !== speedLabel(rate)) label.textContent = speedLabel(rate);
  }
  let menu = wrap.querySelector(".dojo-pod-speed-menu");
  if (!open) {
    menu?.remove();
    return null;
  }
  if (!menu) {
    menu = document.createElement("div");
    menu.className = "dojo-pod-speed-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "Playback speed");
    menu.innerHTML = PODCAST_SPEEDS.map((value) => `<button type="button" data-${attr}-speed="${value}">${speedLabel(value)}</button>`).join("");
    wrap.append(menu);
  }
  menu.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.getAttribute(`data-${attr}-speed`)) === rate));
  });
  return menu;
}

export function styleOf(value) {
  return PODCAST_STYLES.find((style) => style.value === value) || PODCAST_STYLES[0];
}

export function lengthOf(value) {
  return PODCAST_LENGTHS.find((length) => length.value === value) || PODCAST_LENGTHS[1];
}

export function voiceOf(id) {
  return PODCAST_VOICES.find((voice) => voice.id === id) || null;
}

export function podcastMeta(podcast) {
  return [formatTime(podcast.durationSeconds), styleOf(podcast.style).title].join(" · ");
}

// Index of the transcript line playing at `time` (last line whose start has passed).
export function activeLine(transcript, time) {
  let active = -1;
  for (let i = 0; i < transcript.length; i += 1) {
    if (transcript[i].start <= time + 0.05) active = i;
    else break;
  }
  return active;
}

/* ---------- Create dialog ---------- */

const STYLE_ART = {
  casual: '<span class="dojo-pod-art is-casual"><i class="dojo-pod-face">A</i><i class="dojo-pod-face is-b">B</i><span class="dojo-pod-bubbles"><b></b><b></b><em>ha!</em></span></span>',
  professional: '<span class="dojo-pod-art is-professional"><span class="dojo-pod-mic"></span><span class="dojo-pod-lines"><b></b><b></b><b></b></span></span>',
  tutor: '<span class="dojo-pod-art is-tutor"><span class="dojo-pod-q">?</span><b class="dojo-pod-bar"></b><b class="dojo-pod-bar is-short"></b><span class="dojo-pod-q is-a">!</span></span>',
  recall: '<span class="dojo-pod-art is-recall"><span class="dojo-pod-card">Q</span><span class="dojo-pod-dots"><i></i><i></i><i></i></span><span class="dojo-pod-card is-a">A</span></span>'
};

function voiceChips(slot, selected, blocked, escapeHtml) {
  return PODCAST_VOICES.map((voice) => {
    const checked = voice.id === selected;
    const disabled = voice.id === blocked;
    return `<span class="dojo-voice${checked ? " is-picked" : ""}" data-voice-chip="${voice.id}">
      <label title="${escapeHtml(`${voice.name} · ${voice.tone} · ${voice.accent}`)}"><input type="radio" name="voice${slot}" value="${voice.id}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}><span class="dojo-voice-face"><span class="dojo-voice-avatar is-${voice.id}">${voice.name[0]}</span><span class="dojo-voice-name">${voice.name}</span></span></label>
      <button class="dojo-voice-play" type="button" data-voice-preview="${voice.id}" aria-label="Hear ${voice.name}" title="Hear ${voice.name}"><span class="dojo-voice-play-icon">${ICONS.play}</span><span class="dojo-voice-eq" aria-hidden="true"><i></i><i></i><i></i></span></button>
    </span>`;
  }).join("");
}

export function podcastOptionsMarkup({ escapeHtml, style = "casual", length = "standard", voices = ["af_heart", "am_michael"] }) {
  const roles = styleOf(style).roles;
  const styles = PODCAST_STYLES.map((item) => `<label class="dojo-option" data-value="${item.value}"><input type="radio" name="style" value="${item.value}"${item.value === style ? " checked" : ""}><span class="dojo-option-face"><span class="dojo-option-preview is-podcast">${STYLE_ART[item.value]}</span><span class="dojo-option-copy"><strong>${item.title}</strong><small>${item.description}</small></span><span class="dojo-option-check" aria-hidden="true">✓</span></span></label>`).join("");
  const lengths = PODCAST_LENGTHS.map((item) => `<label class="dojo-option" data-value="${item.value}"><input type="radio" name="length" value="${item.value}"${item.value === length ? " checked" : ""}><span class="dojo-option-face"><span class="dojo-option-copy"><span class="dojo-length-top"><strong>${item.title}</strong><span class="dojo-length-time">~${item.minutes} min</span></span><small>${item.description}</small></span></span></label>`).join("");
  const voiceNote = (id) => {
    const voice = voiceOf(id);
    return voice ? `${voice.tone} · ${voice.accent}` : "";
  };
  return `<fieldset class="dojo-option-group is-illustrated is-podcast-style"><legend>Style</legend><div class="dojo-option-grid">${styles}</div></fieldset>
    <fieldset class="dojo-option-group is-podcast-length"><legend>Episode length</legend><div class="dojo-option-grid">${lengths}</div></fieldset>
    <fieldset class="dojo-option-group dojo-voices"><legend>Voices</legend>
      ${[0, 1].map((slot) => `<div class="dojo-voice-row" data-voice-slot="${slot}">
        <span class="dojo-voice-role"><strong data-voice-role="${slot}">${roles[slot]}</strong><small data-voice-note="${slot}">${escapeHtml(voiceNote(voices[slot]))}</small></span>
        <div class="dojo-voice-list" role="radiogroup" aria-label="${roles[slot]} voice">${voiceChips(slot ? "B" : "A", voices[slot], voices[slot ? 0 : 1], escapeHtml)}</div>
      </div>`).join("")}
    </fieldset>
    <label class="dojo-focus-field is-podcast">What should they focus on? <span class="dojo-focus-tag">Optional · recommended</span><textarea name="focus" maxlength="1000" placeholder="e.g. Focus on chapter 3 and the key terms…" rows="3"></textarea></label>`;
}

/* ---------- Player ---------- */

function speakerOf(podcast, index) {
  const voice = podcast.voices?.[index] || {};
  return { name: voice.name || (index ? "Guest" : "Host"), id: voice.id || "" };
}

function transcriptMarkup(podcast, active, escapeHtml) {
  return podcast.transcript.map((line, index) => {
    const state = index === active ? " is-active" : index < active ? " is-past" : "";
    if (line.pause) {
      const secs = Math.round(line.end - line.start);
      return `<button class="dojo-pod-line is-pause${state}" type="button" data-pod-line="${index}" data-start="${line.start}"><span class="dojo-pod-think">${ICONS.think}Your turn to think · ${secs}s</span></button>`;
    }
    const speaker = speakerOf(podcast, line.speaker);
    return `<button class="dojo-pod-line is-${line.speaker ? "b" : "a"}${state}" type="button" data-pod-line="${index}" data-start="${line.start}">
      <span class="dojo-voice-avatar is-${escapeHtml(speaker.id)}" aria-hidden="true">${escapeHtml(speaker.name[0] || "?")}</span>
      <span class="dojo-pod-line-body"><span class="dojo-pod-line-head"><strong>${escapeHtml(speaker.name)}</strong><time>${formatTime(line.start)}</time></span><span class="dojo-pod-line-text">${escapeHtml(line.text)}</span></span>
    </button>`;
  }).join("");
}

export function podcastViewMarkup(view, item, { escapeHtml, player }) {
  const podcast = view.podcast;
  const title = podcast?.title || item.title || "Podcast";
  const duration = podcast?.durationSeconds || item.durationSeconds || 0;
  const created = podcast?.createdAt || item.createdAt;
  const date = created ? new Date(created).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
  const hosts = podcast?.voices?.length === 2 ? `${podcast.voices[0].name} & ${podcast.voices[1].name}` : "";
  const meta = [formatDurationLabel(duration), styleOf(podcast?.style || item.style).title, hosts, date].filter(Boolean).join(" · ");
  const head = `<header class="dojo-view-head dojo-pod-head">
    <button class="study-icon-btn" type="button" data-studio-back aria-label="Back to Create" title="Back">${ICONS.back}</button>
    <span class="dojo-pod-title"><h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3><small>${escapeHtml(meta)}</small></span>
    ${podcast?.downloadUrl ? `<a class="study-icon-btn dojo-pod-download" href="${escapeHtml(podcast.downloadUrl)}" download aria-label="Download MP3" title="Download MP3">${ICONS.download}</a>` : ""}
  </header>`;
  if (view.error) {
    return `<div class="dojo-studio-content dojo-studio-view is-podcast" data-studio-kind="podcast">${head}<div class="dojo-view-body"><div class="study-empty"><strong>Could not load this podcast</strong><p>${escapeHtml(view.error)}</p></div></div></div>`;
  }
  if (!podcast) {
    return `<div class="dojo-studio-content dojo-studio-view is-podcast" data-studio-kind="podcast">${head}<div class="dojo-view-body"><div class="study-empty" role="status"><span class="study-spin" aria-hidden="true"></span><p>Loading episode…</p></div></div></div>`;
  }
  const time = player.time;
  const progress = duration ? Math.min(100, (time / duration) * 100) : 0;
  const active = activeLine(podcast.transcript, time);
  const volume = player.muted ? 0 : player.volume;
  return `<div class="dojo-studio-content dojo-studio-view is-podcast" data-studio-kind="podcast">
    ${head}
    <section class="dojo-pod-player${player.playing ? " is-playing" : ""}${player.waiting ? " is-waiting" : ""}" aria-label="Player">
      <div class="dojo-pod-scrub" style="--p: ${progress.toFixed(3)}%">
        <input type="range" min="0" max="${duration.toFixed(2)}" step="0.1" value="${Math.min(time, duration).toFixed(2)}" data-pod-seek aria-label="Seek" aria-valuetext="${formatTime(time)} of ${formatTime(duration)}">
      </div>
      <div class="dojo-pod-times"><span data-pod-time>${formatTime(time)}</span><span data-pod-left>-${formatTime(Math.max(0, duration - time))}</span></div>
      <div class="dojo-pod-transport">
        <button class="dojo-pod-skip" type="button" data-pod-skip="-${SKIP_SECONDS}" aria-label="Back ${SKIP_SECONDS} seconds" title="Back ${SKIP_SECONDS}s">${ICONS.back10}</button>
        <button class="dojo-pod-play" type="button" data-pod-toggle aria-label="${player.playing ? "Pause" : "Play"}" title="${player.playing ? "Pause" : "Play"} (Space)">${player.playing ? ICONS.pause : ICONS.play}</button>
        <button class="dojo-pod-skip" type="button" data-pod-skip="${SKIP_SECONDS}" aria-label="Forward ${SKIP_SECONDS} seconds" title="Forward ${SKIP_SECONDS}s">${ICONS.fwd10}</button>
      </div>
      <div class="dojo-pod-extras">
        <div class="dojo-pod-volume" style="--v: ${(volume * 100).toFixed(0)}%">
          <button class="study-icon-btn" type="button" data-pod-mute aria-label="${player.muted ? "Unmute" : "Mute"}" title="${player.muted ? "Unmute" : "Mute"}">${volume === 0 ? ICONS.muted : ICONS.volume}</button>
          <input type="range" min="0" max="1" step="0.05" value="${volume}" data-pod-volume aria-label="Volume">
        </div>
        <div class="dojo-pod-speed">
          <button class="dojo-pod-speed-btn${player.rate !== 1 ? " is-on" : ""}" type="button" data-pod-speed-toggle aria-haspopup="true" aria-expanded="${view.speedOpen}" aria-label="Playback speed ${speedLabel(player.rate)}" title="Playback speed">${ICONS.speed}<span>${speedLabel(player.rate)}</span></button>
          ${view.speedOpen ? `<div class="dojo-pod-speed-menu" role="group" aria-label="Playback speed">${PODCAST_SPEEDS.map((rate) => `<button type="button" data-pod-speed="${rate}" aria-pressed="${rate === player.rate}">${speedLabel(rate)}</button>`).join("")}</div>` : ""}
        </div>
      </div>
    </section>
    <div class="dojo-pod-transcript-head"><span>Transcript</span><small>Tap a line to jump there</small></div>
    <div class="dojo-view-body dojo-pod-transcript" data-pod-transcript>${transcriptMarkup(podcast, active, escapeHtml)}</div>
  </div>`;
}

/* ---------- Audio controller ---------- */

// One long-lived <audio> element per player, so repaints never interrupt playback.
export function createPodcastAudio({ onUpdate, onEnded, refreshUrl }) {
  const audio = new Audio();
  audio.preload = "metadata";
  let current = null;
  let rate = 1;
  let volume = 1;
  let muted = false;
  let frame = 0;
  let pendingSeek = null;
  let retried = false;
  try {
    rate = Number(localStorage.getItem("klui.dojo.podcastRate")) || 1;
    if (!PODCAST_SPEEDS.includes(rate)) rate = 1;
    const savedVolume = Number(localStorage.getItem("klui.dojo.podcastVolume"));
    if (Number.isFinite(savedVolume) && localStorage.getItem("klui.dojo.podcastVolume") !== null) volume = Math.min(1, Math.max(0, savedVolume));
  } catch { /* Storage is optional. */ }
  audio.volume = volume;

  const tick = () => {
    frame = 0;
    onUpdate("time");
    if (!audio.paused) frame = requestAnimationFrame(tick);
  };
  const startTicking = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };
  audio.addEventListener("play", () => { onUpdate("state"); startTicking(); });
  audio.addEventListener("pause", () => onUpdate("state"));
  audio.addEventListener("waiting", () => onUpdate("state"));
  audio.addEventListener("playing", () => { retried = false; onUpdate("state"); });
  audio.addEventListener("seeked", () => onUpdate("time"));
  audio.addEventListener("ratechange", () => onUpdate("state"));
  audio.addEventListener("loadedmetadata", () => {
    audio.playbackRate = rate;
    if (pendingSeek != null) {
      audio.currentTime = pendingSeek;
      pendingSeek = null;
    }
  });
  audio.addEventListener("ended", () => { onUpdate("state"); onEnded?.(); });
  // Signed URLs expire; fetch a fresh one once and carry on from the same spot.
  audio.addEventListener("error", async () => {
    if (!current || retried) {
      onUpdate("error");
      return;
    }
    retried = true;
    const resume = !audio.paused || audio.dataset.wantPlay === "1";
    const at = audio.currentTime;
    const episode = current;
    try {
      const url = await refreshUrl(episode.id);
      // Another episode (or none) may have been picked while the link refreshed.
      if (!url || current !== episode) return;
      current.url = url;
      pendingSeek = at;
      audio.src = url;
      // The listener may have paused (or pressed play) while the link refreshed.
      const want = audio.dataset.wantPlay;
      if (want === "1" || (resume && want !== "0")) await audio.play().catch(() => {});
    } catch {
      if (current === episode) onUpdate("error");
    }
  });

  return {
    load(id, url) {
      if (current?.id === id) return;
      audio.pause();
      current = { id, url };
      retried = false;
      pendingSeek = null;
      audio.src = url;
      audio.playbackRate = rate;
      onUpdate("state");
    },
    unload() {
      audio.pause();
      current = null;
      audio.removeAttribute("src");
      audio.load();
      cancelAnimationFrame(frame);
      frame = 0;
    },
    get id() { return current?.id || ""; },
    state() {
      return {
        time: audio.currentTime || pendingSeek || 0,
        playing: !audio.paused && !audio.ended,
        waiting: !audio.paused && audio.readyState < 3,
        rate,
        volume,
        muted
      };
    },
    async toggle() {
      if (!current) return;
      if (audio.paused) {
        audio.dataset.wantPlay = "1";
        if (audio.ended) audio.currentTime = 0;
        await audio.play().catch(() => {});
      } else {
        audio.dataset.wantPlay = "0";
        audio.pause();
      }
    },
    pause() {
      audio.dataset.wantPlay = "0";
      audio.pause();
    },
    seek(seconds, { play = false } = {}) {
      const duration = Number.isFinite(audio.duration) ? audio.duration : Infinity;
      const target = Math.max(0, Math.min(duration, seconds));
      if (audio.readyState < 1) pendingSeek = target;
      else audio.currentTime = target;
      onUpdate("time");
      if (play && audio.paused) void this.toggle();
    },
    skip(delta) {
      this.seek((audio.currentTime || 0) + delta);
    },
    setRate(next) {
      if (!PODCAST_SPEEDS.includes(next)) return;
      rate = next;
      audio.playbackRate = next;
      try { localStorage.setItem("klui.dojo.podcastRate", String(next)); } catch { /* Storage is optional. */ }
      onUpdate("state");
    },
    stepRate(direction) {
      const index = PODCAST_SPEEDS.indexOf(rate);
      this.setRate(PODCAST_SPEEDS[Math.max(0, Math.min(PODCAST_SPEEDS.length - 1, index + direction))]);
    },
    setVolume(next) {
      volume = Math.min(1, Math.max(0, Number(next) || 0));
      muted = volume === 0;
      audio.volume = volume;
      audio.muted = muted;
      try { localStorage.setItem("klui.dojo.podcastVolume", String(volume)); } catch { /* Storage is optional. */ }
      onUpdate("volume");
    },
    toggleMute() {
      if (volume === 0) {
        volume = 0.8;
        audio.volume = volume;
        muted = false;
      } else muted = !muted;
      audio.muted = muted;
      onUpdate("volume");
    }
  };
}

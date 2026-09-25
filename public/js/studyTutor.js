// AI tutor: create-dialog options, the plan / recap views, and the live voice call.
// The call keeps one long-lived root element (with its canvas orb and audio graph); studyHub
// re-renders around it and moves that element into the view's slot, so repaints never cut a call.
import { PODCAST_VOICES, formatDurationLabel, voiceOf } from "./studyPodcast.js";

export const TUTOR_MAX_SECONDS = 30 * 60;

const svg = (paths, size = 16, width = 1.7) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const STYLE_ICONS = {
  teacher: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2v.2h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  buddy: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.6 14.1A4.6 4.6 0 0 1 21 18.6"/>',
  socratic: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6"/><path d="M12 16.8h.01"/>',
  professor: '<path d="m2.5 9 9.5-4.5L21.5 9 12 13.5z"/><path d="M6.5 11v4.5c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3V11"/><path d="M21.5 9v5"/>'
};

// Mirrors server/study/tutor.js. The voice only changes how the tutor sounds; the style
// alone decides how it teaches.
export const TUTOR_STYLES = [
  {
    value: "teacher",
    title: "Patient teacher",
    description: "Explains ideas from scratch with clear examples, then checks you've got it.",
    preview: "Picture it like a ball rolling down a hill: the steeper the slope, the faster it goes. So what do you think would slow it down?"
  },
  {
    value: "buddy",
    title: "Study buddy",
    description: "A friend who's a step ahead. Relaxed, encouraging, and quizzes you as you go.",
    preview: "Okay, honestly this one confused me at first too. Here's the trick I use to remember it. Want to try saying it back in your own words?"
  },
  {
    value: "socratic",
    title: "Socratic guide",
    description: "Asks the right questions so you work the answers out yourself.",
    preview: "Before I explain, what would you expect to happen if we doubled it? Walk me through your thinking, one step at a time."
  },
  {
    value: "professor",
    title: "Strict professor",
    description: "Viva-style drilling: precise questions, exact definitions, honest feedback.",
    preview: "Define it precisely. Close, but you've left out the mechanism. Try again, and this time use the correct terminology."
  }
];

const ICONS = {
  back: svg('<path d="M19 12H5m6-6-6 6 6 6"/>'),
  pause: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.4"/><rect x="13.5" y="5" width="4" height="14" rx="1.4"/></svg>',
  play: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.9l10-6.4a1 1 0 0 0 0-1.8l-10-6.4A1 1 0 0 0 8 5.6Z"/></svg>',
  hangup: svg('<path d="M3.4 14.2c-.5-.5-.5-1.3 0-1.8C5.8 10.1 8.8 9 12 9s6.2 1.1 8.6 3.4c.5.5.5 1.3 0 1.8l-1.5 1.5c-.4.4-1.1.5-1.6.2l-2-1.2c-.4-.3-.7-.8-.6-1.3l.2-1.5a11 11 0 0 0-6.2 0l.2 1.5c.1.5-.2 1-.6 1.3l-2 1.2c-.5.3-1.2.2-1.6-.2z"/>', 22, 1.8),
  keyboard: svg('<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>', 18),
  send: svg('<path d="M5 12h13m-5-6 6 6-6 6"/>', 16, 2),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 13),
  spark: svg('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>', 14),
  check: svg('<path d="m5 12.5 4.2 4.2L19 7"/>', 14, 2),
  target: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".6"/>', 14),
  replay: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>', 14)
};

export function tutorStyleOf(value) {
  return TUTOR_STYLES.find((style) => style.value === value) || TUTOR_STYLES[0];
}

export function tutorStyleIcon(value, size = 16) {
  return svg(STYLE_ICONS[tutorStyleOf(value).value], size);
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function tutorMeta(item) {
  const style = tutorStyleOf(item.style).title;
  if (item.status === "preparing") return "Planning your lesson…";
  if (item.status === "ready") return `Lesson plan ready · ${style}`;
  if (item.status === "live") return `In progress · ${style}`;
  return [formatDurationLabel(item.activeSeconds || 0), style].join(" · ");
}

/* ---------- Create dialog ---------- */

export function tutorOptionsMarkup({ escapeHtml, style = "teacher", voice = "af_heart" }) {
  const styles = TUTOR_STYLES.map((item) => `<label class="dojo-tutor-style is-${item.value}">
      <input type="radio" name="style" value="${item.value}"${item.value === style ? " checked" : ""}>
      <span class="dojo-tutor-style-face">
        <span class="dojo-tutor-style-top"><span class="dojo-tutor-style-icon">${svg(STYLE_ICONS[item.value], 18)}</span><strong>${item.title}</strong></span>
        <small>${item.description}</small>
      </span>
    </label>`).join("");
  const voices = PODCAST_VOICES.map((item) => `<span class="dojo-voice${item.id === voice ? " is-picked" : ""}" data-voice-chip="${item.id}">
      <label title="${escapeHtml(`${item.name} · ${item.tone} · ${item.accent}`)}"><input type="radio" name="voice" value="${item.id}"${item.id === voice ? " checked" : ""}><span class="dojo-voice-face"><span class="dojo-voice-avatar is-${item.id}">${item.name[0]}</span><span class="dojo-voice-name">${item.name}</span></span></label>
      <button class="dojo-voice-play" type="button" data-voice-preview="${item.id}" aria-label="Hear ${item.name}" title="Hear ${item.name}"><span class="dojo-voice-play-icon">${ICONS.play.replace('width="22" height="22"', 'width="11" height="11"')}</span><span class="dojo-voice-eq" aria-hidden="true"><i></i><i></i><i></i></span></button>
    </span>`).join("");
  const picked = tutorStyleOf(style);
  const sound = voiceOf(voice);
  return `<fieldset class="dojo-option-group dojo-tutor-styles"><legend>Teaching style</legend>
      <div class="dojo-tutor-style-grid">${styles}</div>
      <div class="dojo-tutor-preview is-${picked.value}" aria-live="polite">
        <span class="dojo-tutor-preview-head">${svg(STYLE_ICONS[picked.value], 15)}<span>How it sounds</span></span>
        <q data-tutor-preview>${escapeHtml(picked.preview)}</q>
      </div>
    </fieldset>
    <fieldset class="dojo-option-group dojo-voices is-tutor"><legend>Voice <small data-tutor-voice-note>${escapeHtml(sound ? `${sound.tone} · ${sound.accent}` : "")}</small></legend>
      <div class="dojo-voice-list" role="radiogroup" aria-label="Tutor voice">${voices}</div>
    </fieldset>
    <label class="dojo-focus-field is-tutor">Custom instructions <span class="dojo-focus-tag">Optional</span><textarea name="instructions" maxlength="1000" placeholder="e.g. Quiz me with exam-style questions and keep explanations short." rows="3"></textarea></label>`;
}

// Keeps the preview and voice chips in step with the form.
export function syncTutorOptions(root) {
  if (!root) return;
  const style = tutorStyleOf(root.querySelector('input[name="style"]:checked')?.value);
  const preview = root.querySelector(".dojo-tutor-preview");
  if (preview && !preview.classList.contains(`is-${style.value}`)) {
    preview.className = `dojo-tutor-preview is-${style.value}`;
    preview.querySelector(".dojo-tutor-preview-head svg")?.replaceWith(document.createRange().createContextualFragment(svg(STYLE_ICONS[style.value], 15)));
    const quote = preview.querySelector("[data-tutor-preview]");
    if (quote) {
      quote.textContent = style.preview;
      quote.classList.remove("is-new");
      void quote.offsetWidth; // restart the fade-in
      quote.classList.add("is-new");
    }
  }
  const voice = root.querySelector('input[name="voice"]:checked')?.value;
  root.querySelectorAll("[data-voice-chip]").forEach((chip) => chip.classList.toggle("is-picked", chip.dataset.voiceChip === voice));
  const sound = voiceOf(voice);
  const note = root.querySelector("[data-tutor-voice-note]");
  if (note) note.textContent = sound ? `${sound.tone} · ${sound.accent}` : "";
}

/* ---------- Views ---------- */

const PREP_STAGES = [
  ["reading", "Reading your sources"],
  ["planning", "Planning the lesson"],
  ["saving", "Getting your tutor ready"]
];

function staticOrb(extra = "") {
  return `<span class="dojo-tutor-orb${extra}" aria-hidden="true"><i></i><i></i><i></i></span>`;
}

function formatStamp(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function transcriptMarkup(session, escapeHtml) {
  const voice = voiceOf(session.voice) || PODCAST_VOICES[0];
  return (session.transcript || []).map((line) => line.role === "tutor"
    ? `<div class="dojo-tutor-line is-tutor"><span class="dojo-voice-avatar is-${escapeHtml(voice.id)}" aria-hidden="true">${escapeHtml(voice.name[0])}</span><div><span class="dojo-tutor-line-head"><strong>Tutor</strong><time>${formatStamp(line.at)}</time></span><p>${escapeHtml(line.text)}${line.interrupted ? '<span class="dojo-tutor-cut" title="You jumped in here">—</span>' : ""}</p></div></div>`
    : `<div class="dojo-tutor-line is-student"><div><span class="dojo-tutor-line-head"><strong>You</strong><time>${formatStamp(line.at)}</time></span><p>${escapeHtml(line.text)}</p></div></div>`).join("");
}

function recapMarkup(session, escapeHtml) {
  const summary = session.summary;
  if (!summary) {
    const talked = (session.transcript || []).some((line) => line.role === "student");
    return `<section class="dojo-tutor-recap is-empty"><p>${talked ? "The recap could not be written this time. Your full conversation is below." : "This call ended before you got going, so there's no recap. Start a new session whenever you're ready."}</p></section>`;
  }
  const list = (items) => items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<section class="dojo-tutor-recap">
      <h4>${ICONS.spark}Summary</h4>
      ${summary.overview ? `<p class="dojo-tutor-overview">${escapeHtml(summary.overview)}</p>` : ""}
      ${summary.concepts?.length ? `<h5>Key concepts</h5><dl class="dojo-tutor-concepts">${summary.concepts.map((item) => `<div><dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.detail)}</dd></div>`).join("")}</dl>` : ""}
      ${summary.strengths?.length || summary.review?.length ? `<div class="dojo-tutor-split">
        ${summary.strengths?.length ? `<div class="is-good"><h5>${ICONS.check}You did well</h5><ul>${list(summary.strengths)}</ul></div>` : ""}
        ${summary.review?.length ? `<div class="is-review"><h5>${ICONS.target}Review next</h5><ul>${list(summary.review)}</ul></div>` : ""}
      </div>` : ""}
      ${summary.next ? `<p class="dojo-tutor-next"><strong>Next up:</strong> ${escapeHtml(summary.next)}</p>` : ""}
    </section>`;
}

function planMarkup(session, escapeHtml) {
  const steps = session.plan?.steps || [];
  const voice = voiceOf(session.voice) || PODCAST_VOICES[0];
  const style = tutorStyleOf(session.style);
  return `<div class="dojo-view-body dojo-tutor-ready">
      <div class="dojo-tutor-hero">${staticOrb(" is-ready")}<span class="dojo-tutor-kicker">${ICONS.check}Lesson plan ready</span>${session.plan?.goal ? `<p>${escapeHtml(session.plan.goal)}</p>` : ""}</div>
      <ol class="dojo-tutor-plan">${steps.map((step, index) => `<li style="--i: ${index}"><span class="dojo-tutor-plan-num">${index + 1}</span><span>${escapeHtml(step.title)}</span></li>`).join("")}</ol>
      <div class="dojo-tutor-launch">
        <span class="dojo-tutor-who"><span class="dojo-voice-avatar is-${escapeHtml(voice.id)}" aria-hidden="true">${escapeHtml(voice.name[0])}</span><span><strong>${escapeHtml(style.title)}</strong><small>${escapeHtml(voice.name)}'s voice · up to 30 minutes</small></span></span>
        <button class="dojo-tutor-start" type="button" data-tutor-start>${ICONS.play.replace('width="22" height="22"', 'width="15" height="15"')}Start call</button>
        <small class="dojo-tutor-mic-note">Uses your microphone. Pause whenever you need a moment.</small>
      </div>
    </div>`;
}

export function tutorViewMarkup(view, item, { escapeHtml, callActive }) {
  const session = view.session;
  const title = session?.title || item?.title || "AI tutor";
  const style = tutorStyleOf(session?.style || item?.style);
  const created = session?.createdAt || item?.createdAt;
  const date = created ? new Date(created).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const meta = session?.status === "ended"
    ? [formatDurationLabel(session.activeSeconds), style.title, date].filter(Boolean).join(" · ")
    : [style.title, date].filter(Boolean).join(" · ");
  const head = `<header class="dojo-view-head dojo-pod-head">
    <button class="study-icon-btn" type="button" data-studio-back aria-label="Back to Create" title="Back">${ICONS.back}</button>
    <span class="dojo-pod-title"><h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3><small>${escapeHtml(meta)}</small></span>
  </header>`;
  const wrap = (body, extra = "") => `<div class="dojo-studio-content dojo-studio-view is-tutor${extra}" data-studio-kind="tutor">${head}${body}</div>`;
  if (view.error) {
    return wrap(`<div class="dojo-view-body"><div class="study-empty"><strong>${view.preparing ? "Could not plan this lesson" : "Could not load this session"}</strong><p>${escapeHtml(view.error)}</p></div></div>`);
  }
  if (view.preparing) {
    const at = Math.max(0, PREP_STAGES.findIndex(([key]) => key === view.stage));
    return wrap(`<div class="dojo-view-body dojo-tutor-prep" role="status">
        ${staticOrb(" is-thinking")}
        <h4>Preparing your lesson</h4>
        <p>Your tutor is reading the material and planning a session around what matters most.</p>
        <ol class="dojo-tutor-stages">${PREP_STAGES.map(([key, label], index) => `<li class="${index < at ? "is-done" : index === at ? "is-now" : ""}"><span>${index < at ? ICONS.check : ""}</span>${label}</li>`).join("")}</ol>
      </div>`);
  }
  if (!session) return wrap('<div class="dojo-view-body"><div class="study-empty" role="status"><span class="study-spin" aria-hidden="true"></span><p>Loading session…</p></div></div>');
  if (callActive) return wrap('<div class="dojo-tutor-slot"></div>', " is-live");
  if (session.status === "ready") return wrap(planMarkup(session, escapeHtml));
  if (session.status === "live" || view.finishing) {
    return wrap(`<div class="dojo-view-body dojo-tutor-prep" role="status">${staticOrb(" is-thinking")}<h4>Wrapping up</h4><p>Writing a recap of your call…</p></div>`);
  }
  return wrap(`<div class="dojo-view-body dojo-tutor-review">
      ${recapMarkup(session, escapeHtml)}
      ${session.transcript?.length ? `<div class="dojo-tutor-log-head"><span>Conversation</span><small>${session.transcript.length} turns</small></div><div class="dojo-tutor-log">${transcriptMarkup(session, escapeHtml)}</div>` : ""}
    </div>`);
}

/* ---------- Turn-taking ---------- */

// Words that leave a thought hanging. A reply ending on one of these (or a trailing "…")
// is probably mid-sentence, so the tutor keeps waiting instead of jumping in.
const TRAILING = new Set(["and", "but", "so", "or", "because", "cause", "um", "uh", "er", "erm", "hmm", "like", "the", "a", "an", "of", "to", "with", "is", "are", "was", "were", "if", "then", "that", "which", "my", "your", "its", "it's", "in", "on", "for", "at", "by", "from", "maybe", "well", "basically", "means", "i", "we", "you", "they", "when", "where", "how", "why", "what", "as", "than", "into", "about", "also", "plus", "whereas", "while"]);
const SHORT_ANSWERS = /^(yes|yeah|yep|no|nope|okay|ok|sure|right|correct|true|false|exactly|got it|i don't know|not sure|no idea|pass|skip|repeat that|go on|continue|next)[.!?]*$/i;

export function looksComplete(text) {
  const clean = String(text || "").trim();
  if (!clean) return false;
  if (/(\.\.\.|…|,|;|:|-|—)$/.test(clean)) return false;
  const last = clean.toLowerCase().replace(/[.!?"')\]]+$/, "").split(/\s+/).pop() || "";
  if (TRAILING.has(last)) return false;
  const words = clean.split(/\s+/).length;
  if (words <= 2 && !SHORT_ANSWERS.test(clean) && !/[.!?]$/.test(clean)) return false;
  return /[.!?]["')\]]*$/.test(clean) || words >= 6;
}

// How long a pause must last before the tutor answers. Answers to its questions get more
// room, and a reply that sounds unfinished (or barely started) gets the most.
export function endOfTurnSilence({ answering, complete, voicedMs }) {
  if (complete === true) return answering ? 1500 : 1150;
  const unsure = answering ? 4200 : 3200;
  return voicedMs < 700 ? Math.max(unsure, 3600) : unsure;
}

/* ---------- Orb ---------- */

const PALETTES = {
  idle: { a: [108, 196, 236], b: [156, 228, 124], c: [150, 214, 255], glow: [140, 212, 236], speed: 0.5, wobble: 0.6 },
  listening: { a: [100, 194, 240], b: [150, 230, 116], c: [140, 210, 255], glow: [132, 218, 222], speed: 0.9, wobble: 1 },
  speaking: { a: [112, 202, 234], b: [164, 234, 128], c: [255, 222, 176], glow: [142, 220, 214], speed: 1.2, wobble: 1.25 },
  thinking: { a: [128, 190, 246], b: [160, 226, 170], c: [200, 190, 255], glow: [156, 196, 252], speed: 2.2, wobble: 0.5 },
  paused: { a: [164, 184, 192], b: [206, 222, 212], c: [186, 200, 214], glow: [176, 192, 198], speed: 0.18, wobble: 0.25 }
};

const rgba = (color, alpha) => `rgba(${color[0] | 0}, ${color[1] | 0}, ${color[2] | 0}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
const shade = (color, amount) => color.map((channel) => amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount));

export function createOrb(canvas, { calm = false } = {}) {
  const g = canvas.getContext("2d");
  const mix = JSON.parse(JSON.stringify(PALETTES.idle));
  let mode = "idle";
  let target = 0;
  let level = 0;
  let phase = Math.random() * 10;
  let last = 0;
  let raf = 0;
  let ripple = 0;
  let tint = null;
  let stir = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    const modeGoal = PALETTES[mode] || PALETTES.idle;
    const goal = tint ? { ...modeGoal, ...tint } : modeGoal;
    const blend = Math.min(1, dt * 3);
    // While stirring (a recolor), the inner swirls take the new colors first and the body follows,
    // so the change blooms from inside the orb.
    const rate = { a: stir ? dt * 2.6 : blend, glow: stir ? dt * 2.6 : blend, b: stir ? dt * 4 : blend, c: stir ? dt * 6 : blend };
    for (const key of ["a", "b", "c", "glow"]) mix[key] = mix[key].map((value, index) => value + (goal[key][index] - value) * Math.min(1, rate[key]));
    stir = Math.max(0, stir - dt * 1.1);
    mix.speed += (goal.speed - mix.speed) * blend;
    mix.wobble += (goal.wobble - mix.wobble) * blend;
    level += (target - level) * (target > level ? 0.4 : 0.07);
    phase += dt * (mix.speed + stir * 2.4) * (calm ? 0.4 : 1);
    ripple = (ripple + dt * (0.35 + level * 0.6)) % 1;

    // Mid-recolor the orb brightens toward white, so two far-apart colors never meet as grey.
    const bloom = 0.4 * Math.sin(Math.PI * stir);
    const show = bloom ? { a: shade(mix.a, bloom), b: shade(mix.b, bloom), c: shade(mix.c, bloom), glow: shade(mix.glow, bloom) } : mix;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;
    const lift = calm ? 0.3 : 1;
    const base = Math.min(width, height) * 0.3;
    const radius = base * (1 + 0.09 * level * lift + 0.02 * Math.sin(phase * 1.4));

    const glow = g.createRadialGradient(cx, cy, radius * 0.55, cx, cy, Math.min(radius * 1.75, Math.min(width, height) / 2 - 1));
    glow.addColorStop(0, rgba(show.glow, 0.34 + 0.3 * level));
    glow.addColorStop(1, rgba(show.glow, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, width, height);

    // Soft rings drift out while someone is talking.
    if (mode === "speaking" || mode === "listening") {
      for (let k = 0; k < 2; k += 1) {
        const p = (ripple + k * 0.5) % 1;
        g.beginPath();
        g.arc(cx, cy, radius * (1.02 + p * 0.55), 0, Math.PI * 2);
        g.strokeStyle = rgba(show.b, (1 - p) * (0.12 + level * 0.35));
        g.lineWidth = 1.5;
        g.stroke();
      }
    }

    const amp = radius * (0.008 + 0.026 * level * mix.wobble * lift);
    g.beginPath();
    for (let i = 0; i <= 120; i += 1) {
      const theta = (i / 120) * Math.PI * 2;
      const r = radius + amp * (Math.sin(3 * theta + phase * 1.7) + 0.6 * Math.sin(5 * theta - phase * 1.25) + 0.35 * Math.sin(8 * theta + phase * 2.3))
        + radius * 0.012 * Math.sin(2 * theta - phase * 0.6);
      const x = cx + Math.cos(theta) * r;
      const y = cy + Math.sin(theta) * r;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.save();
    g.clip();
    // Grass green sweeping into sky blue across the orb, so the hue shift stays visible.
    const body = g.createLinearGradient(cx - radius, cy - radius, cx + radius * 0.9, cy + radius);
    body.addColorStop(0, rgba(shade(show.b, 0.35), 1));
    body.addColorStop(0.4, rgba(show.b, 1));
    body.addColorStop(0.75, rgba(show.a, 1));
    body.addColorStop(1, rgba(shade(show.a, -0.08), 1));
    g.fillStyle = body;
    g.fillRect(cx - radius * 1.3, cy - radius * 1.3, radius * 2.6, radius * 2.6);

    g.globalCompositeOperation = "screen";
    [show.b, show.c, shade(show.b, 0.2)].forEach((color, k) => {
      const x = cx + radius * 0.44 * Math.sin(phase * (0.7 + k * 0.23) + k * 2.1);
      const y = cy + radius * 0.4 * Math.cos(phase * (0.9 + k * 0.17) + k * 1.3);
      const r = radius * (0.5 + 0.12 * Math.sin(phase * 0.8 + k) + 0.18 * level + 0.3 * Math.sin(Math.PI * stir));
      const swirl = g.createRadialGradient(x, y, 0, x, y, r);
      swirl.addColorStop(0, rgba(color, k === 1 ? 0.4 : 0.6));
      swirl.addColorStop(1, rgba(color, 0));
      g.fillStyle = swirl;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    });
    if (mode === "thinking" && g.createConicGradient) {
      const sheen = g.createConicGradient(phase * 1.6, cx, cy);
      sheen.addColorStop(0, "rgba(255,255,255,0)");
      sheen.addColorStop(0.18, "rgba(255,255,255,.22)");
      sheen.addColorStop(0.36, "rgba(255,255,255,0)");
      sheen.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = sheen;
      g.fillRect(cx - radius * 1.3, cy - radius * 1.3, radius * 2.6, radius * 2.6);
    }
    g.globalCompositeOperation = "source-over";
    const shadow = g.createRadialGradient(cx + radius * 0.45, cy + radius * 0.55, radius * 0.1, cx + radius * 0.3, cy + radius * 0.4, radius * 1.1);
    shadow.addColorStop(0, "rgba(20, 70, 110, .12)");
    shadow.addColorStop(1, "rgba(20, 70, 110, 0)");
    g.fillStyle = shadow;
    g.fillRect(cx - radius * 1.3, cy - radius * 1.3, radius * 2.6, radius * 2.6);
    const spot = g.createRadialGradient(cx - radius * 0.38, cy - radius * 0.46, 0, cx - radius * 0.38, cy - radius * 0.46, radius * 0.6);
    spot.addColorStop(0, "rgba(255,255,255,.72)");
    spot.addColorStop(0.35, "rgba(255,255,255,.18)");
    spot.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = spot;
    g.fillRect(cx - radius * 1.3, cy - radius * 1.3, radius * 2.6, radius * 2.6);
    g.restore();
    g.beginPath();
    g.arc(cx, cy, radius + amp * 0.2, 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,255,255,.14)";
    g.lineWidth = 1;
    g.stroke();
  }

  return {
    setMode(next) { mode = next; },
    setLevel(value) { target = Math.max(0, Math.min(1, value)); },
    // Recolors the orb, swirling the new colors in from the middle; `instant` skips the blend.
    setPalette(colors, { instant = false } = {}) {
      tint = colors ? { a: colors.a, b: colors.b, c: colors.c, glow: colors.glow } : null;
      if (instant && tint) for (const key of ["a", "b", "c", "glow"]) mix[key] = [...tint[key]];
      else stir = 1;
    },
    start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } },
    stop() { cancelAnimationFrame(raf); raf = 0; }
  };
}

/* ---------- Live call ---------- */

const TICK_MS = 50;
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function recordingType() {
  if (typeof MediaRecorder === "undefined") return "";
  return RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function base64Bytes(value) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

/**
 * One tutor call. `api` provides turn(id, body, { signal, onEvent }), transcribe(id, blob, { signal })
 * and end(id, body). The call moves through: thinking (waiting on the tutor), speaking, listening,
 * paused, and finishing (writing the recap).
 */
export function createTutorCall({ session, api, escapeHtml, reducedMotion = false, onFinished, onToast }) {
  const style = tutorStyleOf(session.style);
  const steps = session.plan?.steps || [];
  const root = document.createElement("div");
  root.className = "tutor-call";
  root.dataset.phase = "idle";
  root.innerHTML = `
    <div class="tutor-call-top">
      <span class="tutor-chip">${svg(STYLE_ICONS[style.value], 14)}${escapeHtml(style.title)}</span>
      <span class="tutor-timer" title="Time left in this call"><span class="tutor-timer-bar"><i data-tutor-bar></i></span><b data-tutor-clock>${formatClock(TUTOR_MAX_SECONDS)}</b></span>
    </div>
    <div class="tutor-step" data-tutor-step>
      <span class="tutor-step-dots">${steps.map(() => "<i></i>").join("")}</span>
      <span class="tutor-step-label" data-tutor-step-label></span>
    </div>
    <div class="tutor-stage">
      <button class="tutor-orb" type="button" data-tutor-orb aria-label="Tutor"><canvas></canvas></button>
      <span class="tutor-status" data-tutor-status role="status"><i></i><span>Connecting…</span></span>
      <span class="tutor-hint" data-tutor-hint></span>
    </div>
    <div class="tutor-captions" data-tutor-captions aria-label="Live transcript"></div>
    <form class="tutor-type" data-tutor-type hidden>
      <input type="text" maxlength="1000" autocomplete="off" placeholder="Type your answer…" aria-label="Type your answer">
      <button type="submit" aria-label="Send">${ICONS.send}</button>
    </form>
    <div class="tutor-controls">
      <button class="tutor-btn is-ghost" type="button" data-tutor-keys aria-label="Type instead" title="Type instead" aria-pressed="false">${ICONS.keyboard}</button>
      <button class="tutor-btn is-pause" type="button" data-tutor-pause aria-label="Pause" title="Pause">${ICONS.pause}</button>
      <button class="tutor-btn is-end" type="button" data-tutor-end aria-label="End call" title="End call">${ICONS.hangup}</button>
    </div>`;
  const $ = (selector) => root.querySelector(selector);
  const canvas = $("canvas");
  const orb = createOrb(canvas, { calm: reducedMotion });
  const captions = $("[data-tutor-captions]");
  const typeForm = $("[data-tutor-type]");

  let phase = "idle";
  let started = false;
  let finished = false;
  let paused = false;
  let elapsedBase = 0;
  let runningSince = 0;
  let timeUp = false;
  let timeUpAt = 0;
  let closingSent = false;
  let tutorEnded = false;
  let step = 1;
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
  let turnAbort = null;
  let queue = [];
  let current = null;
  let decodeChain = Promise.resolve();
  let turnDone = false;
  let tutorLine = null;
  let asked = false;
  let listen = null;
  let held = null; // what was heard while the call got paused mid-transcription
  let typing = false;

  /* Timer */
  const elapsed = () => elapsedBase + (runningSince ? (performance.now() - runningSince) / 1000 : 0);
  function setRunning(on) {
    if (on && !runningSince) runningSince = performance.now();
    if (!on && runningSince) {
      elapsedBase = elapsed();
      runningSince = 0;
    }
  }
  function paintTimer() {
    const left = Math.max(0, TUTOR_MAX_SECONDS - elapsed());
    $("[data-tutor-clock]").textContent = formatClock(left);
    $("[data-tutor-bar]").style.transform = `scaleX(${(1 - left / TUTOR_MAX_SECONDS).toFixed(4)})`;
    root.classList.toggle("is-last-minutes", left <= 180);
    if (started && !timeUp && left <= 0) {
      timeUp = true;
      timeUpAt = performance.now();
      onTimeUp();
    }
  }

  /* Status */
  const LABELS = { connecting: "Connecting…", thinking: "Thinking…", speaking: "Speaking…", listening: "Listening…", paused: "Paused", finishing: "Writing your recap…" };
  function setPhase(next, label = LABELS[next]) {
    phase = next;
    root.dataset.phase = next;
    orb.setMode(next === "connecting" || next === "finishing" ? "thinking" : next);
    setStatus(label);
    const orbButton = $("[data-tutor-orb]");
    orbButton.setAttribute("aria-label", next === "speaking" || next === "thinking" ? "Tutor is talking. Tap to jump in."
      : next === "listening" ? "Listening. Tap when you're done."
        : next === "paused" ? "Paused. Tap to resume." : "Tutor");
    if (next !== "listening") setHint("");
  }
  function setStatus(text) {
    const node = $("[data-tutor-status] span");
    if (node && node.textContent !== text) node.textContent = text;
  }
  function setHint(text) {
    const node = $("[data-tutor-hint]");
    if (node.textContent !== text) node.textContent = text;
  }
  function paintStep() {
    const index = Math.min(Math.max(1, step), steps.length || 1);
    $("[data-tutor-step]").hidden = !steps.length;
    root.querySelectorAll(".tutor-step-dots i").forEach((dot, i) => {
      dot.classList.toggle("is-done", i < index - 1);
      dot.classList.toggle("is-now", i === index - 1);
    });
    const label = $("[data-tutor-step-label]");
    if (label && steps.length) label.textContent = `Step ${index} of ${steps.length} · ${steps[index - 1]?.title || ""}`;
  }

  /* Captions */
  function nearBottom() {
    return captions.scrollHeight - captions.scrollTop - captions.clientHeight < 40;
  }
  function addLine(role, text = "", live = false) {
    const stick = nearBottom();
    const node = document.createElement("div");
    node.className = `tutor-line is-${role}${live ? " is-live" : ""}`;
    node.innerHTML = `<span class="tutor-line-who">${role === "tutor" ? "Tutor" : "You"}</span><p></p>`;
    captions.append(node);
    while (captions.children.length > 60) captions.firstElementChild.remove();
    const line = { role, node, full: text, spoken: 0 };
    paintLine(line);
    if (stick) captions.scrollTop = captions.scrollHeight;
    return line;
  }
  function paintLine(line) {
    const stick = nearBottom();
    const p = line.node.querySelector("p");
    if (line.role === "student") {
      p.innerHTML = line.full ? escapeHtml(line.full) : '<span class="tutor-dots" aria-label="Listening"><i></i><i></i><i></i></span>';
    } else {
      const said = line.full.slice(0, line.spoken);
      const rest = line.full.slice(line.spoken);
      p.innerHTML = line.full
        ? `${escapeHtml(said)}<span class="tutor-pending">${escapeHtml(rest)}</span>${line.cut ? '<span class="tutor-cut">—</span>' : ""}`
        : '<span class="tutor-dots" aria-label="Thinking"><i></i><i></i><i></i></span>';
    }
    if (stick) captions.scrollTop = captions.scrollHeight;
  }
  function markSpoken(line, text) {
    if (!line) return;
    const at = line.full.indexOf(text, Math.max(0, line.spoken - 2));
    line.spoken = at >= 0 ? at + text.length : Math.min(line.full.length, line.spoken + text.length + 1);
    paintLine(line);
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
    try {
      if (!navigator.mediaDevices?.getUserMedia || !recordingType()) throw new Error("unsupported");
      const granted = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      // The call may have been hung up while the permission prompt was open.
      if (finished) {
        granted.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = granted;
      micAnalyser = ctx.createAnalyser();
      micAnalyser.fftSize = 1024;
      micAnalyser.smoothingTimeConstant = 0.2;
      ctx.createMediaStreamSource(stream).connect(micAnalyser);
    } catch {
      stream = null;
      setTyping(true);
      onToast?.("Microphone unavailable. You can type your answers instead.");
    }
  }
  function rms(analyser) {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }
  function stopPlayback() {
    current?.stop();
    current = null;
    queue = [];
  }
  function pump() {
    if (current || paused || !queue.length) return;
    const item = queue.shift();
    setPhase("speaking");
    markSpoken(tutorLine, item.text);
    const next = () => {
      current = null;
      pump();
      settleTutorTurn();
    };
    if (!item.buffer) {
      // No audio for this sentence: leave it on screen for a reading beat, then continue.
      const timer = setTimeout(next, Math.min(6000, 300 * item.text.split(/\s+/).length));
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
  async function sendTurn(mode, text = "") {
    if (finished) return;
    if (mode === "closing") closingSent = true;
    const seq = ++turnSeq;
    turnAbort?.abort();
    const controller = new AbortController();
    turnAbort = controller;
    stopPlayback();
    decodeChain = Promise.resolve();
    turnDone = false;
    asked = false;
    tutorLine = addLine("tutor", "", true);
    setPhase("thinking");
    const line = tutorLine;
    try {
      await api.turn(session.id, { mode, text, elapsed: Math.round(elapsed()) }, {
        signal: controller.signal,
        onEvent: (event) => {
          if (seq !== turnSeq) return;
          if (event.type === "error") {
            const error = new Error(event.error || "The tutor could not answer.");
            error.code = event.code;
            throw error;
          }
          if (event.type === "text") {
            line.full += event.delta;
            paintLine(line);
          } else if (event.type === "audio") {
            decodeChain = decodeChain.then(async () => {
              let buffer = null;
              if (event.audio) {
                try { buffer = await ctx.decodeAudioData(base64Bytes(event.audio)); } catch { buffer = null; }
              }
              if (seq !== turnSeq) return;
              queue.push({ buffer, text: event.text || "" });
              pump();
            });
          } else if (event.type === "done") {
            if (event.step) step = event.step;
            paintStep();
            if (event.ended) tutorEnded = true;
          }
        }
      });
      await decodeChain;
      if (seq !== turnSeq) return;
      turnDone = true;
      settleTutorTurn();
    } catch (error) {
      if (controller.signal.aborted || seq !== turnSeq || finished) return;
      if (error?.code === "tutor_time_up" || /time limit|has ended/i.test(error?.message || "")) {
        void finish();
        return;
      }
      line.node.remove();
      tutorLine = null;
      onToast?.(error?.message || "The tutor could not answer. Try again.");
      if (mode === "closing") { void finish(); return; }
      beginListening();
    }
  }

  // Called whenever playback or the stream advances; hands the floor back once all is spoken.
  function settleTutorTurn() {
    if (!turnDone || current || queue.length || finished) return;
    if (tutorLine) {
      tutorLine.spoken = tutorLine.full.length;
      tutorLine.node.classList.remove("is-live");
      paintLine(tutorLine);
      asked = /\?["')\]]*\s*$/.test(tutorLine.full.trim());
    }
    turnDone = false;
    if (tutorEnded || closingSent) {
      void finish();
      return;
    }
    if (timeUp) {
      void sendTurn("closing");
      return;
    }
    beginListening();
  }

  function interrupt(byVoice) {
    if (phase !== "speaking" && phase !== "thinking") return;
    turnSeq += 1;
    turnAbort?.abort();
    stopPlayback();
    if (tutorLine) {
      if (!tutorLine.spoken) tutorLine.node.remove();
      else {
        tutorLine.full = tutorLine.full.slice(0, tutorLine.spoken);
        tutorLine.cut = true;
        tutorLine.node.classList.remove("is-live");
        paintLine(tutorLine);
      }
      tutorLine = null;
    }
    beginListening();
    if (byVoice && listen) {
      const now = performance.now();
      listen.heard = true;
      listen.firstVoiceAt = now - 300;
      listen.lastVoiceAt = now;
      listen.voicedMs = 300;
      listen.line = addLine("student", "", true);
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
  function beginListening() {
    if (finished) return;
    setPhase("listening", typing || !stream ? "Your turn" : "Listening…");
    setRunning(!paused);
    if (!stream || typing) {
      listen = null;
      return;
    }
    const now = performance.now();
    listen = { startedAt: now, heard: false, voicedRun: 0, voicedMs: 0, firstVoiceAt: 0, lastVoiceAt: 0, spec: null, answering: asked, nudged: false, line: null };
    startRecorder(listen);
  }
  async function restartRecorder(state) {
    await stopRecorder(state);
    if (listen === state && !finished && !paused) startRecorder(state);
  }
  function speculate(state) {
    const at = state.lastVoiceAt;
    const spec = { at, done: false, text: "", complete: false };
    state.spec = spec;
    spec.promise = (async () => {
      try {
        const blob = await snapshot(state);
        const result = await api.transcribe(session.id, blob);
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
          state.line = addLine("student", "", true);
        }
        state.lastVoiceAt = now;
        state.voicedMs += TICK_MS;
        setStatus("Listening…");
        setHint("");
      }
    } else if (level < off) {
      state.voicedRun = 0;
    }
    if (!state.heard) {
      if (timeUp) {
        void endListening(null);
        return;
      }
      if (state.answering && !state.nudged && now - state.startedAt > 28_000) {
        state.nudged = true;
        void stopRecorder(state);
        listen = null;
        void sendTurn("nudge");
        return;
      }
      // Drop long silences from the recording so the eventual clip stays short.
      if (now - state.recordStart > 20_000) void restartRecorder(state);
      return;
    }
    const silence = now - state.lastVoiceAt;
    if (silence >= (state.answering ? 950 : 750) && state.spec?.at !== state.lastVoiceAt) speculate(state);
    const spec = state.spec?.at === state.lastVoiceAt && state.spec.done ? state.spec : null;
    if (spec && !spec.failed && !spec.text) {
      // Only noise so far: keep listening as if nothing was said.
      if (silence > 1200) {
        state.heard = false;
        state.voicedMs = 0;
        state.line?.node.remove();
        state.line = null;
        setStatus("Listening…");
        void restartRecorder(state);
      }
      return;
    }
    if (spec?.text && state.line && state.line.full !== spec.text) {
      state.line.full = spec.text;
      paintLine(state.line);
    }
    const wait = endOfTurnSilence({ answering: state.answering, complete: spec ? spec.complete : null, voicedMs: state.voicedMs });
    if (silence > 1700) {
      setStatus("Take your time…");
      setHint("Tap the orb when you're done");
    }
    const graceOver = timeUp && performance.now() - timeUpAt > 20_000;
    if (silence >= wait || graceOver || now - state.firstVoiceAt > 150_000) void endListening(state.spec?.at === state.lastVoiceAt ? state.spec : null);
  }
  async function endListening(spec) {
    const state = listen;
    if (!state) return;
    listen = null;
    setPhase("thinking");
    setRunning(!paused);
    if (!state.heard) {
      await stopRecorder(state);
      if (timeUp) void sendTurn("closing");
      else beginListening();
      return;
    }
    const line = state.line || addLine("student", "", true);
    let text = "";
    try {
      if (spec && !spec.done) await spec.promise;
      if (spec?.done && !spec.failed) {
        text = spec.text;
        await stopRecorder(state);
      } else {
        await stopRecorder(state);
        const result = await api.transcribe(session.id, new Blob(state.chunks, { type: state.type }));
        text = String(result?.text || "").trim();
      }
    } catch (error) {
      onToast?.(error?.message || "Could not catch that. Try again.");
    }
    if (finished) return;
    // Paused while transcribing: keep the answer and act on it when the call resumes.
    if (paused) held = () => heard(line, text);
    else heard(line, text);
  }
  function heard(line, text) {
    if (!text) {
      line.node.remove();
      if (timeUp) void sendTurn("closing");
      else beginListening();
      return;
    }
    line.full = text;
    line.node.classList.remove("is-live");
    paintLine(line);
    void sendTurn(timeUp ? "closing" : "reply", text);
  }
  function sendTyped(text) {
    const clean = String(text || "").trim();
    if (!clean || finished) return;
    if (phase === "speaking" || phase === "thinking") interrupt(false);
    if (listen) {
      const state = listen;
      listen = null;
      void stopRecorder(state);
      state.line?.node.remove();
    }
    addLine("student", clean);
    void sendTurn(timeUp ? "closing" : "reply", clean);
  }
  function setTyping(on) {
    typing = Boolean(on);
    typeForm.hidden = !typing;
    const keys = $("[data-tutor-keys]");
    keys.setAttribute("aria-pressed", String(typing));
    keys.hidden = !stream;
    root.classList.toggle("is-typing", typing);
    if (typing && listen) {
      const state = listen;
      listen = null;
      void stopRecorder(state);
      state.line?.node.remove();
      if (phase === "listening") setStatus("Your turn");
    } else if (!typing && phase === "listening" && !listen && !paused) beginListening();
    if (typing) requestAnimationFrame(() => typeForm.querySelector("input")?.focus());
  }

  /* Loop */
  const bargeThreshold = () => Math.max(0.035, floor * 5, echo * 2.6);
  function tick() {
    if (finished) return;
    const now = performance.now();
    const mic = rms(micAnalyser);
    const out = rms(outAnalyser);
    // Echo of the tutor's own voice: learn it only from frames quieter than a barge-in,
    // so the student talking over the tutor never raises the bar against themselves.
    if (phase === "speaking") { if (mic < bargeThreshold()) echo = echo * 0.95 + mic * 0.05; }
    else if (!listen?.heard && mic < floor * 2.5) floor = mic < floor ? floor * 0.85 + mic * 0.15 : floor * 0.995 + mic * 0.005;
    floor = Math.max(0.002, Math.min(0.05, floor));
    orb.setLevel(phase === "speaking" ? out * 5.5 : phase === "listening" && listen?.heard ? mic * 7 : phase === "listening" ? mic * 3 : 0);
    if (!paused) {
      paintTimer();
      if (phase === "listening") listenTick(mic, now);
      else if (phase === "speaking" && stream && !typing) {
        // Jumping in: clearly louder than the room and the tutor's own echo, for ~0.3 s.
        barge = mic > bargeThreshold() ? barge + TICK_MS : Math.max(0, barge - TICK_MS * 2);
        if (barge >= 300) {
          barge = 0;
          interrupt(true);
        }
      } else barge = 0;
    }
  }

  function onTimeUp() {
    // Mid-answer: listenTick allows up to 20 more seconds. While the tutor talks, it wraps up next.
    if (phase === "listening" && (!listen || !listen.heard)) {
      if (listen) {
        const state = listen;
        listen = null;
        void stopRecorder(state);
      }
      void sendTurn("closing");
    }
  }

  function pause() {
    if (!started || finished || paused) return;
    paused = true;
    setRunning(false);
    if (listen) {
      const state = listen;
      listen = null;
      void stopRecorder(state);
      state.line?.node.remove();
    }
    ctx?.suspend().catch(() => {});
    root.classList.add("is-paused");
    const button = $("[data-tutor-pause]");
    button.innerHTML = ICONS.play;
    button.setAttribute("aria-label", "Resume");
    button.title = "Resume";
    root.dataset.resumePhase = phase;
    setPhase("paused");
  }
  function resume() {
    if (!paused || finished) return;
    paused = false;
    root.classList.remove("is-paused");
    const button = $("[data-tutor-pause]");
    button.innerHTML = ICONS.pause;
    button.setAttribute("aria-label", "Pause");
    button.title = "Pause";
    ctx?.resume().catch(() => {});
    const was = root.dataset.resumePhase;
    if (held) {
      const next = held;
      held = null;
      setRunning(true);
      next();
    } else if (was === "speaking" || was === "thinking") {
      setRunning(true);
      setPhase(current || queue.length ? "speaking" : "thinking");
      pump();
      settleTutorTurn();
    } else beginListening();
  }

  async function finish() {
    if (finished) return;
    finished = true;
    const seconds = Math.round(elapsed());
    setRunning(false);
    turnAbort?.abort();
    stopPlayback();
    clearInterval(ticker);
    if (listen) {
      const state = listen;
      listen = null;
      await stopRecorder(state);
    }
    stream?.getTracks().forEach((track) => track.stop());
    setPhase("finishing");
    root.classList.add("is-finishing");
    let result = null;
    try {
      result = await api.end(session.id, { elapsed: seconds });
    } catch (error) {
      onToast?.(error?.message || "Could not save the recap.");
    }
    orb.stop();
    ctx?.close().catch(() => {});
    onFinished?.(result?.session || null);
  }

  /* Events */
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-tutor-end]")) { void finish(); return; }
    if (event.target.closest("[data-tutor-pause]")) { paused ? resume() : pause(); return; }
    if (event.target.closest("[data-tutor-keys]")) { setTyping(!typing); return; }
    if (event.target.closest("[data-tutor-orb]")) {
      if (paused) resume();
      else if (phase === "speaking" || phase === "thinking") interrupt(false);
      else if (phase === "listening" && listen?.heard) void endListening(listen.spec?.at === listen.lastVoiceAt ? listen.spec : null);
    }
  });
  typeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = typeForm.querySelector("input");
    sendTyped(input.value);
    input.value = "";
  });

  return {
    id: session.id,
    root,
    get active() { return !finished; },
    get paused() { return paused; },
    async start() {
      if (started) return;
      started = true;
      paintStep();
      setPhase("connecting");
      orb.start();
      await openAudio();
      if (finished) return;
      ticker = setInterval(tick, TICK_MS);
      setRunning(true);
      void sendTurn("start");
    },
    pause,
    resume,
    finish,
    // Re-attached after a repaint: restart drawing that stopped while detached.
    mounted() {
      if (finished) return;
      orb.start();
      captions.scrollTop = captions.scrollHeight;
    }
  };
}

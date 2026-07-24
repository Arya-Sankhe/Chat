import { slotText } from "../vendor/slot-text/dist/index.js";
import { escapeHtml } from "./render.js";

const PHRASES = {
  thinking: ["cooking…", "locking in…", "big brain time", "connecting the dots…"],
  reading: ["skimming the page…", "highlighting the good bits", "taking notes…", "speed-reading…"],
  searching: ["digging the web…", "down the rabbit hole", "hunting for sources…", "sifting results…"],
  writing: ["drafting…", "finding the words…", "typing it up…", "making it flow…"],
  generating: ["making magic…", "pixels are cooking", "almost there…", "rendering vibes…"],
  reviewing: ["double checking…", "receipts incoming", "sanity check…", "final polish…"],
};

const MOUTHS = {
  thinking: "M32 50 Q40 57 48 50",
  reading: "M33 51 Q40 54 47 51",
  searching: "M34 52 Q40 54 46 52",
  writing: "M33 50 Q40 54 47 50",
  generating: "M30 49 Q40 60 50 49",
  reviewing: "M29 49 Q40 61 51 49",
};

const GREETING_LINES = [
  { text: "how can i help you?", mood: "hello", mouth: "M32 50 Q40 57 48 50" },
  { text: "what's cooking?", mood: "curious", mouth: "M33 51 Q40 54 47 51" },
  { text: "spill the tea_", mood: "wink", mouth: "M32 50 Q40 56 48 50" },
  { text: "say less, i'm ready", mood: "spark", mouth: "M30 49 Q40 59 50 49" },
  { text: "what we working on?", mood: "curious", mouth: "M33 51 Q40 54 47 51" },
  { text: "drop it here", mood: "happy", mouth: "M29 49 Q40 61 51 49" },
  { text: "no pressure, just vibes", mood: "sleepy", mouth: "M34 52 Q40 52 46 52" },
  { text: "awaiting input...", mood: "sleepy", mouth: "M34 52 Q40 52 46 52" },
  { text: "got something on your mind?", mood: "think", mouth: "M33 51 Q40 55 47 51" },
  { text: "let's cook", mood: "spark", mouth: "M30 49 Q40 59 50 49" },
];

const GUEST_LINES = [
  { text: "what can i help you with?", mood: "hello", mouth: "M32 50 Q40 57 48 50" },
  ...GREETING_LINES.slice(1),
];

const TEMP_LINES = [
  { text: "staying lowkey", mood: "wink", mouth: "M32 50 Q40 56 48 50" },
  { text: "this never happened_", mood: "sleepy", mouth: "M34 52 Q40 52 46 52" },
  { text: "between us", mood: "curious", mouth: "M33 51 Q40 54 47 51" },
  { text: "leave no receipts", mood: "think", mouth: "M33 51 Q40 55 47 51" },
  { text: "ghost mode on", mood: "spark", mouth: "M30 49 Q40 59 50 49" },
  { text: "off the record", mood: "hello", mouth: "M32 50 Q40 57 48 50" },
  { text: "no cap, you're safe here", mood: "happy", mouth: "M29 49 Q40 61 51 49" },
  { text: "incognito vibes only", mood: "wink", mouth: "M32 50 Q40 56 48 50" },
];

const controllers = new WeakMap();
let greetingRun = 0;

/** Slot-text flash colors follow the user's selected Klui accent (`--accent`). */
function accentFlash() {
  const accent = (getComputedStyle(document.body).getPropertyValue("--accent") || "").trim() || "#6366f1";
  return (index, total) => {
    const t = total <= 1 ? 0.5 : index / (total - 1);
    const pct = Math.round(55 + t * 45);
    return `color-mix(in srgb, ${accent} ${pct}%, white)`;
  };
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function labelToKluiState(label) {
  const l = String(label || "").toLowerCase();
  if (l.includes("search")) return "searching";
  if (l.includes("read") || l.includes("table")) return "reading";
  if (l.includes("review") || l.startsWith("worked")) return "reviewing";
  if (l.includes("creat") || l.includes("edit") || l.includes("export") || l.includes("writ") || l.includes("check") || l.includes("wrap") || l === "working") {
    return "writing";
  }
  if (l.includes("generat")) return "generating";
  return "thinking";
}

function fedoraMarkup(prefix) {
  const felt = `${prefix}-felt`;
  const band = `${prefix}-band`;
  return `
    <defs>
      <linearGradient id="${felt}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3a3a42"/>
        <stop offset="55%" stop-color="#2a2a30"/>
        <stop offset="100%" stop-color="#1c1c22"/>
      </linearGradient>
      <linearGradient id="${band}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#6b1f2a"/>
        <stop offset="50%" stop-color="#9a2f3d"/>
        <stop offset="100%" stop-color="#6b1f2a"/>
      </linearGradient>
    </defs>
    <g class="klui-fedora" aria-hidden="true">
      <ellipse cx="40" cy="14.2" rx="34" ry="5.2" fill="#000" opacity=".18"/>
      <path d="M8 13.5 C12 10.2, 22 8.4, 40 8.4 C58 8.4, 68 10.2, 72 13.5 C68.5 16.2, 55 17.8, 40 17.8 C25 17.8, 11.5 16.2, 8 13.5 Z" fill="url(#${felt})"/>
      <path d="M8 13.5 C12 11.2, 22 9.6, 40 9.6 C58 9.6, 68 11.2, 72 13.5" fill="none" stroke="#4a4a55" stroke-width="1.1" opacity=".55"/>
      <path d="M24 10.2 C26 3.2, 32 -.2, 40 -.2 C48 -.2, 54 3.2, 56 10.2 L54.2 11.6 C52.2 6.2, 47.2 3.6, 40 3.6 C32.8 3.6, 27.8 6.2, 25.8 11.6 Z" fill="url(#${felt})"/>
      <path d="M26.2 9.4 C28.2 4.8, 33.2 2.4, 40 2.4 C46.8 2.4, 51.8 4.8, 53.8 9.4" fill="none" stroke="#555560" stroke-width="1" opacity=".4"/>
      <rect x="25.4" y="8.8" width="29.2" height="3.4" rx="1.2" fill="url(#${band})"/>
      <rect x="36.4" y="8.5" width="7.2" height="4" rx="0.9" fill="#c9a227" opacity=".92"/>
      <rect x="37.2" y="9.1" width="5.6" height="2.8" rx="0.6" fill="none" stroke="#f0d878" stroke-width="0.7" opacity=".65"/>
    </g>`;
}

function kluiSvgMarkup(prefix, { greeting = false, fedora = false } = {}) {
  const face = `${prefix}-face`;
  const rim = `${prefix}-rim`;
  const hi = `${prefix}-hi`;
  const shade = `${prefix}-shade`;
  const aura = `${prefix}-aura`;
  return `<svg class="klui-svg${fedora ? " has-fedora" : ""}" viewBox="${fedora ? "0 -6 80 86" : "0 0 80 80"}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <radialGradient id="${face}" cx="40%" cy="30%" r="68%">
        <stop offset="0%" stop-color="#ffffff"/><stop offset="62%" stop-color="#ffffff"/><stop offset="100%" stop-color="#e8f1fc"/>
      </radialGradient>
      <radialGradient id="${rim}" cx="50%" cy="48%" r="58%">
        <stop offset="54%" stop-color="#9ec0f0" stop-opacity="0"/>
        <stop offset="76%" stop-color="#9ec0f0" stop-opacity=".55"/>
        <stop offset="100%" stop-color="#7eacf0" stop-opacity=".95"/>
      </radialGradient>
      <radialGradient id="${hi}" cx="30%" cy="22%" r="42%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="${shade}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="55%" stop-color="#7eacf0" stop-opacity="0"/><stop offset="100%" stop-color="#7eacf0" stop-opacity=".18"/>
      </linearGradient>
      <filter id="${aura}" x="-35%" y="-35%" width="170%" height="170%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3.2" result="b"/>
        <feFlood flood-color="#8eb6f0" flood-opacity=".45" result="c"/>
        <feComposite in="c" in2="b" operator="in" result="g"/>
        <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <g filter="url(#${aura})">
      <rect x="8" y="8" width="64" height="64" rx="21" ry="21" fill="url(#${face})"/>
      <rect x="8" y="8" width="64" height="64" rx="21" ry="21" fill="url(#${rim})"/>
      <rect x="8" y="8" width="64" height="64" rx="21" ry="21" fill="url(#${hi})"/>
      <rect x="8" y="8" width="64" height="64" rx="21" ry="21" fill="url(#${shade})"/>
      <rect x="9.2" y="9.2" width="61.6" height="61.6" rx="19.8" ry="19.8" fill="none" stroke="#a8c4ef" stroke-width="2.6" opacity=".85"/>
    </g>
    ${fedora ? fedoraMarkup(prefix) : ""}
    <g class="face">
      <g class="eyes">
        <rect class="eye eye-l" x="26" y="24" width="8" height="18" rx="4" fill="#4f74b8"/>
        <rect class="eye eye-r" x="46" y="24" width="8" height="18" rx="4" fill="#4f74b8"/>
        <g class="fx fx-stars" fill="#4f74b8">
          <path d="M30 24.5 l1.9 4.6 4.6 1.9 -4.6 1.9 -1.9 4.6 -1.9 -4.6 -4.6 -1.9 4.6 -1.9z"/>
          <path d="M50 24.5 l1.9 4.6 4.6 1.9 -4.6 1.9 -1.9 4.6 -1.9 -4.6 -4.6 -1.9 4.6 -1.9z"/>
        </g>
        <g class="fx fx-happy" fill="none" stroke="#4f74b8" stroke-width="3.4" stroke-linecap="round">
          <path d="M24 34 Q30 26 36 34"/><path d="M44 34 Q50 26 56 34"/>
        </g>
        ${greeting ? "" : `<circle class="fx fx-search" cx="50" cy="32.5" r="9" fill="none" stroke="#4f74b8" stroke-width="2.6"/>`}
      </g>
      <path class="mouth mouth-normal" d="M32 50 Q40 57 48 50" fill="none" stroke="#4f74b8" stroke-width="3.4" stroke-linecap="round"/>
      ${greeting ? "" : `<path class="fx fx-tongue" d="M40 52.5 q2.8 0 2.8 2.8 q0 2.8 -2.8 2.8 q-2.8 0 -2.8 -2.8 q0 -2.8 2.8 -2.8z" fill="#f19ab6"/>`}
    </g>
    <g class="fx fx-think" fill="#a8c4ef">
      <circle cx="64" cy="14" r="2.2"/><circle cx="70" cy="7" r="3"/><circle cx="77" cy="-1" r="3.8"/>
    </g>
    ${greeting ? "" : `
    <g class="fx fx-pencil">
      <rect x="62" y="42" width="6" height="16" rx="1.5" fill="#f6b73c" transform="rotate(28 65 50)"/>
      <path d="M70 58.5 l4 6 -7 -1.2z" fill="#e9a06b"/>
    </g>
    <rect class="fx fx-sheen" x="10" y="10" width="14" height="60" rx="7" fill="#fff" transform="skewX(-18)"/>
    <g class="fx fx-check">
      <circle cx="66" cy="14" r="8" fill="#22c55e"/>
      <path d="M61.8 14 l2.9 3.1 5.6 -5.9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </g>`}
    <g class="fx fx-sparkles">
      <path d="M8 10 l1.5 3.6 3.6 1.5 -3.6 1.5 -1.5 3.6 -1.5 -3.6 -3.6 -1.5 3.6 -1.5z"/>
      <path d="M68 58 l1.3 3.2 3.2 1.3 -3.2 1.3 -1.3 3.2 -1.3 -3.2 -3.2 -1.3 3.2 -1.3z"/>
      <path d="M66 4 l1.1 2.8 2.8 1.1 -2.8 1.1 -1.1 2.8 -1.1 -2.8 -2.8 -1.1 2.8 -1.1z"/>
    </g>
  </svg>`;
}

function setFaceExtras(bar, state) {
  const on = (sel, yes) => bar.querySelector(sel)?.classList.toggle("is-on", !!yes);
  on(".fx-think", state === "thinking");
  on(".fx-search", state === "searching");
  on(".fx-tongue", state === "writing");
  on(".fx-pencil", state === "writing");
  on(".fx-stars", state === "generating");
  on(".fx-sparkles", state === "generating");
  on(".fx-sheen", state === "generating");
  on(".fx-happy", state === "reviewing");
  on(".fx-check", state === "reviewing");
  bar.querySelector(".mouth-normal")?.setAttribute("d", MOUTHS[state] || MOUTHS.thinking);
}

function idPrefixFromMessage(message) {
  const raw = String(message?.id || "x").replace(/[^a-zA-Z0-9_-]/g, "");
  return `k${raw.slice(0, 14) || "x"}`;
}

export function renderKluiThinkingStatus(message, { label, active }) {
  const state = labelToKluiState(label);
  const prefix = idPrefixFromMessage(message);
  const safeLabel = escapeHtml(label);
  return `<div class="thinking-status klui-bar ${active ? "is-active" : "is-done"}" data-state="${state}" data-label="${safeLabel}" role="status" aria-live="polite">
    <div class="klui" aria-hidden="true">${kluiSvgMarkup(prefix)}</div>
    <div class="klui-copy">
      <span class="klui-state">${safeLabel}</span>
      <span class="klui-phrase">${escapeHtml(PHRASES[state][0])}</span>
    </div>
  </div>`;
}

function mountBar(bar) {
  if (controllers.has(bar)) return controllers.get(bar);

  const stateEl = bar.querySelector(".klui-state");
  const phraseEl = bar.querySelector(".klui-phrase");
  if (!stateEl || !phraseEl) return null;

  const initialState = bar.dataset.state || "thinking";
  const initialLabel = bar.dataset.label || "Thinking";
  const firstPhrase = (PHRASES[initialState] || PHRASES.thinking)[0];
  const stateSlot = slotText(stateEl, initialLabel);
  const phraseSlot = slotText(phraseEl, firstPhrase);
  let phraseIdx = 0;
  let phraseTimer = null;
  let dirUp = true;
  let state = initialState;
  let pendingLabel = null;
  let coalesce = false;

  function rollPhrase(text, { flash = false } = {}) {
    dirUp = !dirUp;
    // interrupt:false — finish the current roll before starting the next so
    // rapid phrase/state updates can't snap glyphs mid-transform.
    phraseSlot.set(text, {
      direction: dirUp ? "up" : "down",
      skipUnchanged: true,
      interrupt: false,
      color: flash ? accentFlash() : undefined,
    });
  }

  function startPhraseCycle() {
    clearInterval(phraseTimer);
    phraseIdx = 0;
    const list = PHRASES[state] || PHRASES.thinking;
    rollPhrase(list[0], { flash: true });
    // 2.4s > typical roll (stagger*len + duration) so cycles don't overlap.
    phraseTimer = setInterval(() => {
      if (!bar.isConnected || bar.classList.contains("is-leaving")) {
        clearInterval(phraseTimer);
        return;
      }
      phraseIdx = (phraseIdx + 1) % list.length;
      rollPhrase(list[phraseIdx], { flash: true });
    }, 2400);
  }

  function applyNow(label, { active = true, animate = true } = {}) {
    const next = labelToKluiState(label);
    const labelChanged = label !== (bar.dataset.label || "");
    const stateChanged = next !== state;
    bar.dataset.state = next;
    bar.dataset.label = label;
    bar.classList.toggle("is-active", active);
    bar.classList.toggle("is-done", !active);
    setFaceExtras(bar, next);
    if (animate && labelChanged) {
      stateSlot.set(label, {
        direction: "up",
        skipUnchanged: true,
        interrupt: false,
        color: accentFlash(),
      });
    } else if (labelChanged) {
      stateSlot.set(label, { skipUnchanged: true, interrupt: false });
    }
    if (stateChanged || !phraseTimer) {
      state = next;
      startPhraseCycle();
    }
  }

  function apply(label, { active = true, animate = true } = {}) {
    pendingLabel = { label, active, animate };
    if (coalesce) return;
    coalesce = true;
    requestAnimationFrame(() => {
      coalesce = false;
      const next = pendingLabel;
      pendingLabel = null;
      if (next) applyNow(next.label, next);
    });
  }

  setFaceExtras(bar, state);
  // First paint: settle label, start phrase cycle once (via !phraseTimer).
  applyNow(initialLabel, { active: !bar.classList.contains("is-done"), animate: false });

  const api = {
    apply,
    stop() { clearInterval(phraseTimer); },
  };
  controllers.set(bar, api);
  return api;
}

export function updateKluiBar(bar, { label, active = true } = {}) {
  if (!bar || !label) return;
  const api = controllers.get(bar) || mountBar(bar);
  api?.apply(label, { active, animate: true });
}

export function hydrateKluiBars(root = document) {
  root.querySelectorAll?.(".klui-bar")?.forEach((bar) => {
    if (bar.classList.contains("is-leaving")) return;
    mountBar(bar);
  });
}

export function renderHomeGreetingHtml({ guest = false, temporary = false } = {}) {
  const lines = temporary ? TEMP_LINES : guest ? GUEST_LINES : GREETING_LINES;
  const first = lines[0];
  return `<div class="empty-state${temporary ? " is-temporary" : ""}">
    <div class="hero-line">
      <div class="klui" data-mood="${first.mood}" aria-hidden="true">${kluiSvgMarkup("home", { greeting: true, fedora: temporary })}</div>
      <h1 class="type-line"><span class="type-text"></span><span class="caret is-solid"></span></h1>
    </div>
  </div>`;
}

export function stopHomeGreeting() {
  greetingRun += 1;
}

export function startHomeGreeting({ guest = false, temporary = false } = {}) {
  const root = document.querySelector(".empty-state .hero-line");
  if (!root) return;
  const typeEl = root.querySelector(".type-text");
  const caret = root.querySelector(".caret");
  const klui = root.querySelector(".klui");
  const mouth = root.querySelector(".mouth-normal, .mouth");
  if (!typeEl || !caret || !klui) return;

  const pool = temporary ? TEMP_LINES : guest ? GUEST_LINES : GREETING_LINES;
  const run = ++greetingRun;
  let timer = null;

  const sleep = (ms) =>
    new Promise((resolve) => {
      clearTimeout(timer);
      timer = setTimeout(resolve, ms);
    });

  function setMood(mood, mouthPath) {
    klui.dataset.mood = mood;
    if (mouthPath) mouth?.setAttribute("d", mouthPath);
    if (mood === "hello") {
      klui.style.animation = "none";
      void klui.offsetWidth;
      klui.style.animation = "";
    }
  }

  async function typeText(text) {
    caret.classList.remove("is-hidden");
    caret.classList.add("is-solid");
    for (let n = 1; n <= text.length; n++) {
      if (run !== greetingRun || !root.isConnected) return;
      typeEl.textContent = text.slice(0, n);
      await sleep(42 + Math.random() * 28);
    }
    caret.classList.remove("is-solid");
  }

  async function deleteText() {
    caret.classList.remove("is-hidden");
    caret.classList.add("is-solid");
    let text = typeEl.textContent;
    while (text.length) {
      if (run !== greetingRun || !root.isConnected) return;
      text = text.slice(0, -1);
      typeEl.textContent = text;
      await sleep(28);
    }
  }

  async function playLine(line, { hold = 2600, erase = true } = {}) {
    setMood(line.mood, line.mouth);
    await typeText(line.text);
    if (run !== greetingRun) return;
    if (!erase) {
      caret.classList.add("is-hidden");
      return;
    }
    await sleep(hold);
    if (run !== greetingRun) return;
    await deleteText();
    if (run !== greetingRun) return;
    await sleep(420);
  }

  (async () => {
    if (temporary) {
      // One random incognito line — type once and stay.
      const line = pickOne(pool);
      await playLine(line, { hold: 0, erase: false });
      return;
    }

    // Fresh load: two type/delete cycles, then land on a different final line.
    const order = shuffle(pool);
    const first = order[0];
    const second = order[1 % order.length];
    await playLine(first);
    if (run !== greetingRun) return;
    await playLine(second);
    if (run !== greetingRun) return;
    const rest = pool.filter((line) => line !== first && line !== second);
    await playLine(pickOne(rest.length ? rest : pool), { hold: 0, erase: false });
  })();
}

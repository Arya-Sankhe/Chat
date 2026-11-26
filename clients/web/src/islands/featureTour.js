/* The feature tour: a pop-up shown once per account that shows off Dojo lecture recording,
   Compare and Council. After a student redeems a Pro pass from a link it opens on a ticket
   step first. The art is a canvas (the block-built Klui from betaWelcome.js, waveform,
   review arcs, sparks) under DOM cards kept in step with the same clock. Styles live in
   public/styles/feature-tour.css; state/featureTour.ts opens it and handles its buttons. */

const STEP_INFO = {
  pass: {
    label: "YOUR PRO PASS",
    pill: (pass) => (pass?.days ? `${pass.days} DAYS FREE` : "FREE PRO"),
    heading: "Your Pro pass is <em>on.</em>",
    copy: (pass) => `Klui Pro is yours free${pass?.until ? ` until ${pass.until}` : ""}. Here are three things worth trying first.`,
    cta: "Show me →",
    duration: 4.2
  },
  dojo: {
    label: "DOJO LECTURE RECORDING",
    pill: "NEW IN PRO",
    heading: "Hit record, <em>keep everything</em>",
    copy: () => "Record any live lecture. When class ends, Klui turns it into a transcript, summary notes, flashcards and a practice exam it grades for you.",
    cta: "Try Dojo",
    duration: 5.0
  },
  compare: {
    label: "COMPARE",
    pill: "2 MODELS",
    heading: "Ask once, <em>pick the best</em>",
    copy: () => "See two AI models answer the same question side by side. Pick the sharper answer and keep going.",
    cta: "Try Compare",
    duration: 4.6
  },
  council: {
    label: "AI COUNCIL",
    pill: "4 MODELS + CHAIRMAN",
    heading: "Four minds, <em>one verdict</em>",
    copy: () => "Four models answer on their own, review each other anonymously, and a chairman writes one clear final answer.",
    cta: "Try Council",
    duration: 5.0
  }
};

const TEXT_A = "Bayes' theorem updates what you believed using new evidence. Even with a 99% accurate test, a rare condition can produce lots of false positives.";
const TEXT_B = "Start with the base rate (1 in 100). Of 1,000 students, 10 have it and about 50 get false alarms, so a positive test means:";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function template(steps, pass) {
  const scene = (id, inner) => steps.includes(id) ? `<div class="scene-layer" data-scene-layer="${id}" aria-hidden="true">${inner}</div>` : "";
  return `
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="stage-frame" data-ref="stage">
      <div class="stage-grid" aria-hidden="true"></div>
      <button class="dialog-close" data-ref="close" type="button" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>
      </button>
      ${scene("pass", `
        <div class="pass-ticket" data-ref="ticket">
          <div class="pass-kicker">ADMIT ONE · KLUI PRO</div>
          <div class="pass-code">${escapeHtml(pass?.code || "PRO PASS")}</div>
          <div class="pass-until">${pass?.until ? `FREE UNTIL ${escapeHtml(pass.until.toUpperCase())}` : "PRO IS ON"}</div>
        </div>`)}
      ${scene("dojo", `
        <div class="ftd-rec-pill" data-ref="recPill"><span class="rec-dot" data-ref="recDot"></span><span data-ref="recText">REC · 42:18</span></div>
        <div class="ftd-course-pill">BIO 201 · LIVE</div>
        <div class="ftd-deck">
          <div class="ui-card ftd-sheet" data-ref="sheet">
            <div class="ftd-sheet-head"><span class="mono-tag ftd-badge-sky">Transcript + Notes</span><span class="mono-tag" style="color: var(--text-tertiary);">42m</span></div>
            <div class="tx-line"><span class="tx-time">14:08</span><span>ATP synthase runs on the <span class="tx-highlight">proton gradient</span>.</span></div>
            <div class="tx-line"><span class="tx-time">14:22</span><span>Chemiosmosis makes about 30 ATP per glucose.</span></div>
            <div class="summary-strip"><strong>Key takeaway:</strong> H⁺ flow across the inner membrane drives ATP synthesis.</div>
          </div>
          <div class="ftd-flashcard-wrap" data-ref="fcWrap">
            <div class="ftd-flashcard-inner" data-ref="fcInner">
              <div class="ftd-fc-face ftd-fc-front"><span class="mono-tag ftd-badge-pink">Flashcard · 1/18</span><div class="fc-q">Where does oxidative phosphorylation happen?</div><span class="mono-tag" style="color: var(--text-tertiary);">Tap to flip ↻</span></div>
              <div class="ftd-fc-face ftd-fc-back"><span class="mono-tag ftd-badge-sky">Answer</span><div class="fc-a">Across the inner mitochondrial membrane (cristae).</div><span class="mono-tag" style="color: var(--blue);">Got it ✓</span></div>
            </div>
          </div>
          <div class="ui-card ftd-exam" data-ref="exam">
            <div class="ftd-sheet-head" style="margin-bottom: 5px; justify-content: flex-start; gap: 6px;"><span class="mono-tag ftd-badge-yellow">Practice Exam</span><span class="mono-tag" style="color: var(--text-tertiary);">AI</span></div>
            <div class="exam-row"><span>1. Proton-motive force</span><span class="exam-check">✓ 10/10</span></div>
            <div class="exam-row"><span>2. NADH electron yield</span><span class="exam-check">✓ 9/10</span></div>
            <div class="exam-row"><span>3. Cristae surface area</span><span class="exam-check">✓ 10/10</span></div>
            <div class="grade-stamp" data-ref="stamp">96% · A+</div>
          </div>
        </div>`)}
      ${scene("compare", `
        <div class="cmp-prompt" data-ref="prompt"><span class="cmp-prompt-tag">&gt;_&lt;</span><span>"Explain Bayes' theorem with a medical test"</span></div>
        <div class="cmp-grid">
          <div class="ui-card cmp-card" data-ref="cardA"><div class="cmp-card-head"><span class="model-pill model-pill-a">MODEL A</span></div><div class="cmp-stream" data-ref="streamA"></div></div>
          <div class="ui-card cmp-card" data-ref="cardB">
            <div class="cmp-card-head"><span class="model-pill model-pill-b">MODEL B</span><span class="picked-badge" data-ref="picked">★ PICKED</span></div>
            <div class="cmp-stream" data-ref="streamB"></div>
            <div class="cmp-formula" data-ref="formula">P(D|+) = 0.99×0.01 / 0.0594 ≈ 16.7%</div>
          </div>
        </div>`)}
      ${scene("council", `
        <div class="council-phase-pill"><span class="council-phase-dot" data-ref="phaseDot"></span><span data-ref="phaseText">1 · FOUR MODELS ANSWER</span></div>
        <div class="council-verdict" data-ref="verdict">
          <div class="verdict-head"><span class="verdict-title">♛ CHAIRMAN VERDICT</span><span class="verdict-meta">4/4 REVIEWED</span></div>
          <div class="verdict-body">Takes the strongest points from #A and #C and fixes #B's edge case. One clear, checked answer.</div>
        </div>`)}
      <canvas class="stage-canvas" data-ref="canvas" aria-hidden="true"></canvas>
      <div class="stage-progress" aria-hidden="true"><div class="stage-progress-fill" data-ref="progress"></div></div>
    </div>
    <div class="dialog-body" data-ref="body">
      <div class="step-kicker"><span class="kaomoji">&gt;_&lt;</span><span data-ref="kicker"></span><span class="step-kicker-pill" data-ref="pill"></span></div>
      <h2 class="dialog-heading" data-ref="heading" id="featureTourTitle"></h2>
      <p class="dialog-copy" data-ref="copy"></p>
    </div>
    <footer class="dialog-footer">
      <div class="footer-left">
        <div class="step-dots" role="tablist" aria-label="Feature slides">
          ${steps.map((id, i) => `<button class="step-dot" type="button" data-goto="${i}" role="tab" aria-label="${escapeHtml(STEP_INFO[id].label.toLowerCase())}"></button>`).join("")}
        </div>
        <button class="btn-skip" data-ref="skip" type="button">Skip</button>
      </div>
      <div class="footer-actions">
        <button class="btn-secondary" data-ref="next" type="button">Next →</button>
        <button class="btn-primary" data-ref="try" type="button"></button>
      </div>
    </footer>`;
}

/* ─── The block-built Klui (same construction as betaWelcome.js) ─── */
const FONT_MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';
const BODY_KLUI = { f: "#8fd3fb", t: "#d3f2ff", s: "#4b97cf" };
const PAL_SKY = { f: "#79cfff", t: "#ccefff", s: "#3d94d6" };
const PAL_PINK = { f: "#f7c2d9", t: "#ffe3ef", s: "#cf83a4" };
const PAL_YELLOW = { f: "#ffd43b", t: "#ffef9e", s: "#d4a017" };
const PAL_CORAL = { f: "#ff7e5f", t: "#ffb7a3", s: "#c9492b" };
const EYE_COLOR = "#16202e";
const SPARK_COLORS = ["#ff623f", "#ffd43b", "#79cfff", "#f7c2d9", "#397fe6"];
const LEG = 1.4;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
const easeOutBack = (t) => {
  const x = clamp(t, 0, 1);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
const easeInOut = (t) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
const isBlinking = (t) => (t % 3.1) < 0.11;

/**
 * Fills `root` (the .feature-dialog element) and starts the animation.
 * `pass` ({ code, until, days }) adds the ticket step first. `onTry(step)` runs for a step's main
 * button ("dojo", "compare", "council"); `onClose()` for Skip, Done and the close button.
 * Returns stop(), which ends the animation and removes the listeners.
 * @param {HTMLElement} root
 * @param {{ pass?: { code: string, until: string, days: number } | null, onTry?: (step: string) => void, onClose?: () => void }} [options]
 * @returns {() => void}
 */
export function mountFeatureTour(root, { pass = null, onTry = () => {}, onClose = () => {} } = {}) {
  const steps = [...(pass ? ["pass"] : []), "dojo", "compare", "council"];
  root.innerHTML = template(steps, pass);
  const ref = (name) => root.querySelector(`[data-ref="${name}"]`);
  const stage = ref("stage");
  const canvas = ref("canvas");
  const g = canvas.getContext("2d");
  const layers = Object.fromEntries(steps.map((id) => [id, root.querySelector(`[data-scene-layer="${id}"]`)]));
  const dots = [...root.querySelectorAll(".step-dot")];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const S = { W: 1, H: 1, dpr: 1, u: 5 };
  const drawList = [];
  let particles = [];
  const firedMarks = new Set();
  let step = 0;
  let stepStart = performance.now();
  let lastLoopIdx = -1;
  let manualHop = 0;
  let frame = 0;
  let lastFrame = performance.now();

  const isPhone = () => root.classList.contains("is-phone");
  const isDark = () => document.body.dataset.mode === "dark";

  const box = (x, y, w, h, pal, d = 1) => drawList.push({ k: 0, x, y, w, h, pal, d });
  const flat = (x, y, w, h, colour) => drawList.push({ k: 1, x, y, w, h, colour });

  function renderBlocks(X, Y, sx = 1, sy = 1, customU) {
    const u = customU || S.u;
    const ex = -0.82 * u, ey = -0.58 * u;
    const n0 = Math.max(2, Math.round(Math.abs(ex)));
    g.save();
    g.setTransform(sx, 0, 0, sy, X * (1 - sx), Y * (1 - sy));
    const R = (x, y, w, h) => {
      const l = Math.round(X + x * u), t = Math.round(Y + y * u);
      return [l, t, Math.round(X + (x + w) * u) - l, Math.round(Y + (y + h) * u) - t];
    };
    for (const it of drawList) {
      if (it.k) continue;
      const [l, t, w, h] = R(it.x, it.y, it.w, it.h);
      const n = Math.max(1, Math.round(n0 * it.d));
      g.fillStyle = it.pal.s;
      for (let s = n; s >= 1; s--) g.fillRect(l + Math.round(ex * it.d * s / n), t + Math.round(ey * it.d * s / n), w, h);
      g.fillStyle = it.pal.t;
      const th = Math.max(1, Math.ceil(Math.abs(ey) / n0) + 1);
      for (let s = n; s >= 1; s--) g.fillRect(l + Math.round(ex * it.d * s / n), t + Math.round(ey * it.d * s / n), w, th);
    }
    for (const it of drawList) {
      g.fillStyle = it.k ? it.colour : it.pal.f;
      g.fillRect(...R(it.x, it.y, it.w, it.h));
    }
    g.restore();
    drawList.length = 0;
  }

  function buildKlui(ox, oy, opts = {}) {
    const pal = opts.pal || BODY_KLUI;
    const bot = oy - LEG - (opts.bob || 0);
    const lookX = opts.lookX || 0;
    for (const [lx, ly] of [[-3.3, opts.legA || 0], [1.8, opts.legB || 0]]) {
      box(ox + lx, bot - 0.5, 1.5, Math.max(0.5, oy - ly - bot + 0.5), pal, 0.5);
    }
    box(ox - 5, bot - 6, 10, 6, pal);
    box(ox - 7, bot - 4 + (opts.armBack || 0), 2, 2, pal, 0.6);
    box(ox + 5, bot - 4 + (opts.armFront || 0), 2, 2, pal, 0.6);
    if (opts.happy) {
      flat(ox - 1.5 + lookX, bot - 4.2, 1.8, 0.55, EYE_COLOR);
      flat(ox - 1.0 + lookX, bot - 4.7, 0.8, 0.5, EYE_COLOR);
      flat(ox + 2.5 + lookX, bot - 4.2, 1.8, 0.55, EYE_COLOR);
      flat(ox + 3.0 + lookX, bot - 4.7, 0.8, 0.5, EYE_COLOR);
      flat(ox - 3.1 + lookX, bot - 2.9, 1.1, 0.6, "#ff99b8");
      flat(ox + 4.3 + lookX, bot - 2.9, 1.1, 0.6, "#ff99b8");
    } else if (opts.blink) {
      flat(ox - 1.25 + lookX, bot - 4, 1.5, 0.5, EYE_COLOR);
      flat(ox + 2.75 + lookX, bot - 4, 1.5, 0.5, EYE_COLOR);
    } else {
      flat(ox - 1 + lookX, bot - 4.7, 1, 1.5, EYE_COLOR);
      flat(ox + 3 + lookX, bot - 4.7, 1, 1.5, EYE_COLOR);
    }
    if (opts.headphones) {
      box(ox - 5.3, bot - 7.5, 10.6, 0.85, PAL_CORAL, 0.45);
      box(ox - 6.3, bot - 6.7, 1.3, 2.3, PAL_PINK, 0.55);
      box(ox + 5.0, bot - 6.7, 1.3, 2.3, PAL_PINK, 0.55);
    }
    if (opts.crown) {
      box(ox - 3.6, bot - 7.3, 7.2, 1.3, PAL_YELLOW, 0.5);
      box(ox - 3.6, bot - 8.6, 1.6, 1.4, PAL_YELLOW, 0.5);
      box(ox - 0.8, bot - 9.0, 1.6, 1.8, PAL_YELLOW, 0.5);
      box(ox + 2.0, bot - 8.6, 1.6, 1.4, PAL_YELLOW, 0.5);
      flat(ox - 0.4, bot - 7.0, 0.8, 0.7, "#ff623f");
    }
  }

  function burstParticles(x, y, count = 10, glyphs = ["*", "+", "·", "♥"]) {
    if (reduceMotion) return;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.45;
      const sp = (55 + Math.random() * 65) * S.dpr;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 45 * S.dpr,
        gravity: 170 * S.dpr,
        life: 0.75 + Math.random() * 0.25,
        max: 0.95,
        glyph: glyphs[i % glyphs.length],
        colour: SPARK_COLORS[i % SPARK_COLORS.length]
      });
    }
  }

  function drawParticles(dt) {
    if (!particles.length) return;
    g.save();
    g.font = `700 ${Math.round(Math.max(10, S.u * 2.1))}px ${FONT_MONO}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.globalAlpha = clamp((p.life / p.max) * 1.3, 0, 1);
      g.fillStyle = p.colour;
      g.fillText(p.glyph, p.x, p.y);
    }
    g.restore();
  }

  function hopOffset(now) {
    const dt = (now - manualHop) / 1000;
    if (dt < 0 || dt > 0.42) return { dy: 0, cheer: false, sq: 0 };
    const p = dt / 0.42;
    return { dy: -Math.sin(p * Math.PI) * 5.2 * S.u, cheer: p < 0.85, sq: p > 0.82 ? (1 - (p - 0.82) / 0.18) * 0.14 : 0 };
  }

  function shadow(x, y, rx, ry, alpha = 1) {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = isDark() ? "rgba(0,0,0,0.45)" : "rgba(11,27,58,0.1)";
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /* ─── Pass: the ticket drops in, Klui cheers under confetti ─── */
  function renderPass(t, now) {
    const { W, H, u, dpr } = S;
    const ticket = ref("ticket");
    const drop = easeOutBack(clamp(t / 0.6, 0, 1));
    const float = Math.sin(t * 2.2) * 3;
    ticket.style.opacity = clamp(t / 0.25, 0, 1).toFixed(3);
    ticket.style.transform = `translate3d(0, ${((1 - drop) * -70 + float).toFixed(1)}px, 0) rotate(${lerp(-10, -3, drop).toFixed(2)}deg)`;
    if (t >= 0.5 && !firedMarks.has("pass-1")) {
      firedMarks.add("pass-1");
      burstParticles(W * 0.5, H * 0.32, 16, ["✦", "*", "+", "♥", "·"]);
    }
    if (t >= 2.4 && !firedMarks.has("pass-2")) {
      firedMarks.add("pass-2");
      burstParticles(W * 0.3, H * 0.3, 10, ["✦", "*", "+"]);
      burstParticles(W * 0.7, H * 0.3, 10, ["♥", "*", "·"]);
    }
    const hop = (start) => (t > start && t < start + 0.55 ? Math.sin(((t - start) / 0.55) * Math.PI) : 0);
    const cheer = Math.max(hop(0.55), hop(2.45), hop(2.95));
    const mHop = hopOffset(now);
    const kluiX = W * 0.5, kluiY = H * 0.9;
    shadow(kluiX, kluiY + 1.5 * dpr, (6 - cheer * 1.4) * u, 1.5 * u);
    buildKlui(0, 0, {
      happy: true,
      bob: Math.sin(t * 3.4) * 0.3,
      armFront: cheer > 0.05 || mHop.cheer ? -2.3 : -0.6,
      armBack: cheer > 0.05 || mHop.cheer ? -2.3 : -0.6
    });
    renderBlocks(kluiX, kluiY - cheer * 5 * u + mHop.dy, 1 + mHop.sq, 1 - mHop.sq);
  }

  /* ─── Dojo: a live waveform that becomes a transcript, flashcard and graded exam ─── */
  function renderDojo(t, now) {
    const { W, H, u, dpr } = S;
    const phone = isPhone();
    const kluiX = phone ? W * 0.14 : W * 0.13;
    const kluiY = H * 0.84;
    const morphPhase = clamp((t - 1.35) / 0.65, 0, 1);
    const sheetIn = clamp((t - 1.55) / 0.5, 0, 1);
    const fcIn = clamp((t - 2.15) / 0.45, 0, 1);
    const fcFlip = clamp((t - 2.68) / 0.5, 0, 1);
    const examIn = clamp((t - 3.12) / 0.45, 0, 1);
    const stampIn = clamp((t - 3.55) / 0.32, 0, 1);
    const fadeOut = t > 4.6 ? 1 - clamp((t - 4.6) / 0.36, 0, 1) : 1;

    const recText = ref("recText"), recDot = ref("recDot");
    if (t < 1.55) {
      recText.textContent = `REC · 42:${18 + Math.min(3, Math.floor(t * 2.1))}`;
      recDot.style.opacity = (0.45 + 0.55 * Math.sin(t * 10)).toFixed(2);
      recDot.style.background = "var(--coral)";
    } else {
      recText.textContent = "STUDY KIT READY";
      recDot.style.opacity = "1";
      recDot.style.background = "var(--blue)";
    }
    ref("recPill").style.opacity = (0.98 * fadeOut).toFixed(2);

    if (t < 2.05) {
      const waveAlpha = (1 - easeInOut(morphPhase)) * fadeOut;
      if (waveAlpha > 0.01) {
        const barCount = phone ? 24 : 34;
        const startX = phone ? W * 0.27 : W * 0.26;
        const spanW = W * 0.66;
        const centerY = H * 0.53;
        const barW = Math.max(3 * dpr, (spanW / barCount) * 0.52);
        g.save();
        g.globalAlpha = waveAlpha;
        for (let i = 0; i < barCount; i++) {
          const frac = i / (barCount - 1);
          const env = Math.sin(frac * Math.PI);
          const wave = 0.25 + 0.75 * Math.abs(Math.sin(t * 7.5 + i * 0.48) * Math.cos(t * 3.1 - i * 0.22));
          const bh = Math.max(6 * dpr, env * wave * (phone ? 58 : 78) * dpr * (1 - morphPhase * 0.55));
          const x = startX + frac * spanW + morphPhase * (18 * dpr * (0.5 - frac));
          g.fillStyle = i % 3 === 0 ? "#ff623f" : i % 3 === 1 ? "#f7c2d9" : (isDark() ? "#79cfff" : "#397fe6");
          g.beginPath();
          g.roundRect(x, centerY - bh / 2, barW, bh, barW / 2);
          g.fill();
        }
        g.font = `600 ${Math.round((phone ? 9.5 : 10.5) * dpr)}px ${FONT_MONO}`;
        g.fillStyle = isDark() ? "rgba(255,240,209,0.65)" : "rgba(11,27,58,0.55)";
        g.textAlign = "center";
        g.fillText("LISTENING TO LIVE LECTURE…", startX + spanW / 2, centerY + (phone ? 44 : 56) * dpr);
        g.restore();
      }
    }
    if (t >= 1.55 && !firedMarks.has("ftd-morph")) {
      firedMarks.add("ftd-morph");
      burstParticles(W * 0.45, H * 0.48, 9, ["*", "+", "·"]);
    }
    if (t >= 3.56 && !firedMarks.has("ftd-stamp")) {
      firedMarks.add("ftd-stamp");
      burstParticles(W * 0.87, H * 0.56, 12, ["*", "♥", "+"]);
    }

    const sheet = ref("sheet");
    const sDim = examIn > 0.1 ? lerp(1, 0.86, easeOut(examIn)) : 1;
    sheet.style.opacity = (clamp(sheetIn * 1.4, 0, 1) * fadeOut * sDim).toFixed(3);
    sheet.style.transform = `translate3d(0, ${((1 - easeOut(sheetIn)) * 18).toFixed(1)}px, 0) scale(${lerp(0.92, 1, easeOutBack(sheetIn)).toFixed(3)}) rotate(${(-1.2 * easeOut(fcIn)).toFixed(2)}deg)`;

    const fcWrap = ref("fcWrap");
    fcWrap.style.opacity = (clamp(fcIn * 1.5, 0, 1) * fadeOut).toFixed(3);
    fcWrap.style.transform = `translate3d(${((1 - easeOut(fcIn)) * 22).toFixed(1)}px, ${((1 - easeOut(fcIn)) * -10).toFixed(1)}px, 0) scale(${lerp(0.88, 1, easeOutBack(fcIn)).toFixed(3)}) rotate(1.6deg)`;
    ref("fcInner").style.transform = `rotateY(${(easeInOut(fcFlip) * 180).toFixed(1)}deg)`;

    const exam = ref("exam");
    exam.style.opacity = (clamp(examIn * 1.5, 0, 1) * fadeOut).toFixed(3);
    exam.style.transform = `translate3d(0, ${((1 - easeOut(examIn)) * 24).toFixed(1)}px, 0) scale(${lerp(0.9, 1, easeOutBack(examIn)).toFixed(3)})`;

    const stamp = ref("stamp");
    stamp.style.opacity = (clamp(stampIn * 2.2, 0, 1) * fadeOut).toFixed(3);
    stamp.style.transform = `scale(${lerp(2.1, 1, easeOutBack(stampIn)).toFixed(3)}) rotate(${lerp(-22, -8, easeOut(stampIn)).toFixed(1)}deg)`;

    const cheerHop = t > 3.55 && t < 4.15 ? Math.sin(((t - 3.55) / 0.6) * Math.PI) : 0;
    const mHop = hopOffset(now);
    const armWave = cheerHop > 0.05 || mHop.cheer ? -2.3 : (t < 1.55 ? Math.sin(t * 7.5) * 0.6 - 0.5 : 0);
    shadow(kluiX, kluiY + 1.5 * dpr, (6.2 - cheerHop * 1.4) * u, 1.5 * u);
    buildKlui(0, 0, {
      headphones: true,
      blink: isBlinking(t),
      happy: cheerHop > 0.05 || t > 3.58 || mHop.cheer,
      bob: t < 1.55 ? Math.sin(t * 7.5) * 0.45 : Math.sin(t * 3.2) * 0.2,
      armFront: armWave,
      armBack: cheerHop > 0.05 || mHop.cheer ? -2.3 : -armWave * 0.4,
      lookX: t > 1.5 ? 0.5 : 0
    });
    renderBlocks(kluiX, kluiY - cheerHop * 5.2 * u + mHop.dy, 1 + mHop.sq, 1 - mHop.sq);
  }

  /* ─── Compare: two answers stream side by side and Klui picks one ─── */
  function renderCompare(t, now) {
    const { W, H, u, dpr } = S;
    const promptIn = clamp(t / 0.45, 0, 1);
    const cardsIn = clamp((t - 0.28) / 0.4, 0, 1);
    const streamP = clamp((t - 0.55) / 1.55, 0, 1);
    const pickIn = clamp((t - 2.32) / 0.4, 0, 1);
    const fadeOut = t > 4.2 ? 1 - clamp((t - 4.2) / 0.36, 0, 1) : 1;

    const prompt = ref("prompt");
    prompt.style.opacity = (easeOut(promptIn) * fadeOut).toFixed(3);
    prompt.style.transform = `translate3d(-50%, ${((1 - easeOut(promptIn)) * -10).toFixed(1)}px, 0)`;

    const lenA = Math.floor(TEXT_A.length * clamp(streamP * 1.05, 0, 1));
    const lenB = Math.floor(TEXT_B.length * clamp(streamP * 1.12, 0, 1));
    const caret = '<span class="stream-caret"></span>';
    ref("streamA").innerHTML = escapeHtml(TEXT_A.slice(0, lenA)) + (streamP > 0.01 && lenA < TEXT_A.length ? caret : "");
    ref("streamB").innerHTML = escapeHtml(TEXT_B.slice(0, lenB)) + (streamP > 0.01 && lenB < TEXT_B.length ? caret : "");

    const formulaIn = clamp((t - 1.68) / 0.35, 0, 1);
    const formula = ref("formula");
    formula.style.opacity = (easeOut(formulaIn) * fadeOut).toFixed(3);
    formula.style.transform = `translateY(${((1 - easeOut(formulaIn)) * 5).toFixed(1)}px)`;

    const pickEase = easeOutBack(pickIn);
    const cardA = ref("cardA"), cardB = ref("cardB");
    cardB.classList.toggle("is-picked", pickIn > 0.15);
    const baseOp = easeOut(cardsIn) * fadeOut;
    cardA.style.opacity = (baseOp * lerp(1, 0.46, easeOut(pickIn))).toFixed(3);
    cardA.style.transform = `translateY(${((1 - easeOut(cardsIn)) * 12).toFixed(1)}px) scale(${(lerp(0.95, 1, easeOut(cardsIn)) * lerp(1, 0.965, easeOut(pickIn))).toFixed(3)})`;
    cardB.style.opacity = baseOp.toFixed(3);
    cardB.style.transform = `translateY(${((1 - easeOut(cardsIn)) * 12 - easeOut(pickIn) * 3).toFixed(1)}px) scale(${(lerp(0.95, 1, easeOut(cardsIn)) * lerp(1, 1.03, clamp(pickEase, 0, 1.08))).toFixed(3)})`;
    const picked = ref("picked");
    picked.style.opacity = (clamp(pickIn * 2, 0, 1) * fadeOut).toFixed(3);
    picked.style.transform = `scale(${lerp(0.5, 1, pickEase).toFixed(3)})`;

    if (t >= 2.34 && !firedMarks.has("compare-pick")) {
      firedMarks.add("compare-pick");
      burstParticles(W * 0.74, H * 0.35, 12, ["★", "*", "+", "·"]);
    }

    const kluiX = lerp(W * 0.5, W * 0.67, easeInOut(pickIn));
    const kluiY = H * 0.92;
    const hopP = t > 2.32 && t < 2.9 ? Math.sin(((t - 2.32) / 0.58) * Math.PI) : 0;
    const mHop = hopOffset(now);
    const lookX = t < 2.2 ? Math.sin(t * 4.4) * 0.95 : 0.7;
    const smallU = isPhone() ? u * 0.85 : u * 0.92;
    shadow(kluiX, kluiY + 1.5 * dpr, (5.5 - hopP * 1.2) * u, 1.3 * u);
    buildKlui(0, 0, {
      blink: isBlinking(t),
      happy: pickIn > 0.2 || mHop.cheer,
      lookX,
      bob: Math.sin(t * 4) * 0.2,
      armFront: hopP > 0.05 || mHop.cheer ? -2.3 : (lookX > 0.3 ? -1.1 : 0),
      armBack: hopP > 0.05 || mHop.cheer ? -2.3 : (lookX < -0.3 ? -1.1 : 0)
    });
    renderBlocks(kluiX, kluiY - hopP * 4.5 * smallU + mHop.dy, 1 + mHop.sq, 1 - mHop.sq, smallU);
  }

  /* ─── Council: four models answer, review each other, and a crowned chairman decides ─── */
  const MEMBERS = [
    { id: "α", anon: "#A", pal: PAL_SKY, x: 0.16, y: 0.48, score: "9.4" },
    { id: "β", anon: "#B", pal: PAL_PINK, x: 0.38, y: 0.43, score: "8.8" },
    { id: "γ", anon: "#C", pal: PAL_YELLOW, x: 0.62, y: 0.43, score: "9.6" },
    { id: "δ", anon: "#D", pal: PAL_CORAL, x: 0.84, y: 0.48, score: "9.1" }
  ];

  function renderCouncil(t, now) {
    const { W, H, u, dpr } = S;
    const phone = isPhone();
    const dark = isDark();
    const fadeOut = t > 4.62 ? 1 - clamp((t - 4.62) / 0.34, 0, 1) : 1;
    const phaseText = ref("phaseText"), phaseDot = ref("phaseDot");
    if (t < 1.3) {
      phaseText.textContent = "1 · FOUR MODELS ANSWER";
      phaseDot.style.background = "var(--sky)";
    } else if (t < 2.65) {
      phaseText.textContent = "2 · ANONYMOUS PEER REVIEW";
      phaseDot.style.background = "var(--pink)";
    } else {
      phaseText.textContent = "3 · CHAIRMAN DECIDES";
      phaseDot.style.background = "var(--yellow)";
    }
    const mergeP = clamp((t - 2.6) / 0.55, 0, 1);
    const verdictIn = clamp((t - 2.95) / 0.45, 0, 1);
    const miniU = (phone ? 0.6 : 0.72) * u;
    const chairX = W * 0.5;
    const chairY = H * 0.55;

    if (t < 3.05) {
      const collapse = clamp((t - 2.48) / 0.42, 0, 1);
      const cardAlpha = (1 - easeInOut(collapse)) * fadeOut;
      if (cardAlpha > 0.02) {
        const cw = (phone ? 68 : 104) * dpr;
        const ch = (phone ? 36 : 48) * dpr;
        MEMBERS.forEach((m, idx) => {
          const cIn = easeOutBack(clamp((t - 0.18 - idx * 0.11) / 0.34, 0, 1));
          if (cIn <= 0.02) return;
          const cx = lerp(W * m.x, chairX, easeInOut(collapse));
          const cy = lerp(H * 0.72, H * 0.78, easeInOut(collapse));
          const sc = cIn * lerp(1, 0.7, easeInOut(collapse));
          g.save();
          g.globalAlpha = cardAlpha * clamp(cIn, 0, 1);
          g.translate(cx, cy);
          g.scale(sc, sc);
          g.fillStyle = dark ? "#25252a" : "#ffffff";
          g.strokeStyle = t >= 1.3 ? m.pal.f : (dark ? "rgba(255,240,209,0.12)" : "rgba(11,27,58,0.1)");
          g.lineWidth = (t >= 1.3 ? 1.5 : 1) * dpr;
          g.beginPath();
          g.roundRect(-cw / 2, -ch / 2, cw, ch, 8 * dpr);
          g.fill();
          g.stroke();
          g.fillStyle = m.pal.f;
          g.beginPath();
          g.roundRect(-cw / 2 + 7 * dpr, -ch / 2 + 7 * dpr, 16 * dpr, 4 * dpr, 2 * dpr);
          g.fill();
          g.fillStyle = dark ? "rgba(255,248,233,0.22)" : "rgba(11,27,58,0.15)";
          g.beginPath();
          g.roundRect(-cw / 2 + 7 * dpr, -ch / 2 + 16 * dpr, cw - 14 * dpr, 3.5 * dpr, 2 * dpr);
          g.roundRect(-cw / 2 + 7 * dpr, -ch / 2 + 23 * dpr, (cw - 14 * dpr) * 0.72, 3.5 * dpr, 2 * dpr);
          g.fill();
          if (t >= 1.45) {
            g.globalAlpha = cardAlpha * easeOut(clamp((t - 1.45 - idx * 0.08) / 0.25, 0, 1));
            g.fillStyle = dark ? "rgba(255,212,59,0.18)" : "#fff6cf";
            g.beginPath();
            g.roundRect(cw / 2 - 30 * dpr, -ch / 2 + 5 * dpr, 24 * dpr, 11 * dpr, 4 * dpr);
            g.fill();
            g.fillStyle = dark ? "#ffd43b" : "#8a5c00";
            g.font = `700 ${Math.round(7 * dpr)}px ${FONT_MONO}`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText(`★${m.score}`, cw / 2 - 18 * dpr, -ch / 2 + 10.8 * dpr);
          }
          g.restore();
        });
      }
    }

    if (t >= 1.25 && t < 2.85) {
      const arcAlpha = Math.sin(clamp((t - 1.25) / 1.5, 0, 1) * Math.PI) * fadeOut;
      g.save();
      g.globalAlpha = arcAlpha * 0.85;
      [[0, 2], [1, 3], [2, 0], [3, 1], [0, 1], [2, 3]].forEach(([a, b], idx) => {
        const p0 = MEMBERS[a], p1 = MEMBERS[b];
        const x0 = W * p0.x, y0 = H * p0.y - 4 * miniU;
        const x1 = W * p1.x, y1 = H * p1.y - 4 * miniU;
        const mx = (x0 + x1) / 2;
        const my = Math.min(y0, y1) - (16 + (idx % 2) * 14) * dpr;
        g.strokeStyle = dark ? "rgba(255,240,209,0.28)" : "rgba(11,27,58,0.18)";
        g.lineWidth = 1.4 * dpr;
        g.setLineDash([4 * dpr, 4 * dpr]);
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(mx, my, x1, y1);
        g.stroke();
        const prog = (t * 1.45 + idx * 0.23) % 1;
        const inv = 1 - prog;
        const bx = inv * inv * x0 + 2 * inv * prog * mx + prog * prog * x1;
        const by = inv * inv * y0 + 2 * inv * prog * my + prog * prog * y1;
        g.setLineDash([]);
        g.fillStyle = idx % 2 === 0 ? "#ffd43b" : "#f7c2d9";
        g.beginPath();
        g.roundRect(bx - 8 * dpr, by - 6 * dpr, 16 * dpr, 12 * dpr, 4 * dpr);
        g.fill();
        g.fillStyle = "#0b1b3a";
        g.font = `700 ${Math.round(7.5 * dpr)}px ${FONT_MONO}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(idx % 2 === 0 ? "★" : "+1", bx, by + 0.5 * dpr);
      });
      g.restore();
    }

    if (t >= 2.55) {
      const beamAlpha = clamp((t - 2.55) / 0.35, 0, 1) * (1 - clamp((t - 3.6) / 0.5, 0, 1)) * fadeOut;
      if (beamAlpha > 0.01) {
        g.save();
        g.globalAlpha = beamAlpha * 0.75;
        MEMBERS.forEach((m) => {
          const x0 = W * m.x, y0 = H * m.y - 2 * miniU;
          const grad = g.createLinearGradient(x0, y0, chairX, chairY - 4 * u);
          grad.addColorStop(0, m.pal.f);
          grad.addColorStop(1, "#ffd43b");
          g.strokeStyle = grad;
          g.lineWidth = 2.4 * dpr;
          g.beginPath();
          g.moveTo(x0, y0);
          g.quadraticCurveTo((x0 + chairX) / 2, chairY - 16 * dpr, chairX, chairY - 4 * u);
          g.stroke();
        });
        g.restore();
      }
    }

    MEMBERS.forEach((m, idx) => {
      const popIn = easeOutBack(clamp((t - idx * 0.1) / 0.35, 0, 1));
      const mx = W * m.x;
      const my = H * m.y - easeInOut(mergeP) * (phone ? 4 : 6) * dpr;
      const arm = t < 1.3 ? Math.sin(t * 9 + idx) * 0.7 - 0.6 : (t >= 2.8 ? -1.8 : 0);
      g.save();
      g.globalAlpha = clamp(popIn, 0, 1) * fadeOut;
      g.fillStyle = dark ? "rgba(0,0,0,0.4)" : "rgba(11,27,58,0.09)";
      g.beginPath();
      g.ellipse(mx, my + 1.5 * dpr, 4.8 * miniU, 1.2 * miniU, 0, 0, Math.PI * 2);
      g.fill();
      const reviewing = t >= 1.3 && t < 2.65;
      const badgeY = my - 11.5 * miniU;
      const bw = (reviewing ? 28 : 24) * dpr, bh = 15 * dpr;
      g.fillStyle = dark ? "#29292e" : "#ffffff";
      g.strokeStyle = dark ? "rgba(255,240,209,0.16)" : "rgba(11,27,58,0.1)";
      g.lineWidth = dpr;
      g.beginPath();
      g.roundRect(mx - bw / 2, badgeY - bh / 2, bw, bh, 6 * dpr);
      g.fill();
      g.stroke();
      g.fillStyle = dark ? "#f3f1ec" : "#0b1b3a";
      g.font = `700 ${Math.round(8.5 * dpr)}px ${FONT_MONO}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(reviewing ? m.anon : m.id, mx, badgeY + 0.5 * dpr);
      g.restore();
      if (popIn > 0.05) {
        buildKlui(0, 0, {
          pal: m.pal,
          blink: isBlinking(t + idx * 0.7),
          happy: t >= 3.05,
          bob: Math.sin(t * 5.2 + idx * 1.4) * 0.35,
          armFront: arm,
          armBack: -arm * 0.3,
          lookX: idx < 2 ? 0.55 : -0.55
        });
        renderBlocks(mx, my, popIn, popIn, miniU);
      }
    });

    if (t >= 2.96 && !firedMarks.has("council-chair")) {
      firedMarks.add("council-chair");
      burstParticles(chairX, chairY - 6 * u, 14, ["*", "+", "♥", "✦"]);
    }
    if (mergeP > 0.02) {
      const cPop = easeOutBack(mergeP);
      const mHop = hopOffset(now);
      const chairU = (phone ? 0.82 : 0.96) * u;
      const cy = chairY + (1 - easeOut(mergeP)) * 18 * dpr + mHop.dy;
      shadow(chairX, chairY + 1.5 * dpr, 5.8 * chairU, 1.4 * chairU, clamp(mergeP * 1.4, 0, 1) * fadeOut);
      const cheer = t > 3.05 || mHop.cheer;
      buildKlui(0, 0, {
        crown: true,
        blink: isBlinking(t),
        happy: cheer,
        bob: Math.sin(t * 4.5) * 0.25,
        armFront: cheer ? -2.2 : -0.8,
        armBack: cheer ? -2.2 : -0.8
      });
      renderBlocks(chairX, cy, cPop * (1 + mHop.sq), cPop * (1 - mHop.sq), chairU);
    }

    const verdict = ref("verdict");
    verdict.style.opacity = (clamp(verdictIn * 1.6, 0, 1) * fadeOut).toFixed(3);
    verdict.style.transform = `translate3d(-50%, ${((1 - easeOut(verdictIn)) * 18).toFixed(1)}px, 0) scale(${lerp(0.92, 1, easeOutBack(verdictIn)).toFixed(3)})`;
  }

  const RENDER = { pass: renderPass, dojo: renderDojo, compare: renderCompare, council: renderCouncil };
  // With reduced motion each step holds still on its finished frame.
  const SETTLED = { pass: 1.2, dojo: 4.3, compare: 3.6, council: 4.2 };

  function measure() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    S.dpr = dpr;
    S.W = canvas.width = Math.round(Math.max(1, rect.width) * dpr);
    S.H = canvas.height = Math.round(Math.max(1, rect.height) * dpr);
    S.u = Math.round(clamp(Math.min(rect.width / 108, rect.height / 48), 3.6, 6.2) * dpr);
  }

  function tick(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    const id = steps[step];
    const dur = STEP_INFO[id].duration;
    const elapsed = (now - stepStart) / 1000;
    const loopIdx = Math.floor(elapsed / dur);
    if (loopIdx !== lastLoopIdx) {
      lastLoopIdx = loopIdx;
      firedMarks.clear();
    }
    const t = reduceMotion ? SETTLED[id] : elapsed % dur;
    ref("progress").style.width = `${((t / dur) * 100).toFixed(2)}%`;
    g.clearRect(0, 0, S.W, S.H);
    RENDER[id](t, now);
    drawParticles(dt);
    frame = requestAnimationFrame(tick);
  }

  function setStep(index) {
    step = clamp(index, 0, steps.length - 1);
    stepStart = performance.now();
    lastLoopIdx = -1;
    firedMarks.clear();
    particles = [];
    const id = steps[step];
    const info = STEP_INFO[id];
    stage.dataset.scene = id;
    for (const [key, layer] of Object.entries(layers)) {
      layer.classList.toggle("active", key === id);
      layer.setAttribute("aria-hidden", key === id ? "false" : "true");
    }
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === step);
      dot.setAttribute("aria-selected", i === step ? "true" : "false");
    });
    const last = step === steps.length - 1;
    ref("kicker").textContent = `${String(step + 1).padStart(2, "0")} / ${String(steps.length).padStart(2, "0")} · ${info.label}`;
    ref("pill").textContent = typeof info.pill === "function" ? info.pill(pass) : info.pill;
    ref("heading").innerHTML = info.heading;
    ref("copy").textContent = info.copy(pass);
    ref("try").textContent = info.cta;
    // The pass step's main button already moves on, so it has no Next.
    ref("next").hidden = id === "pass";
    ref("next").textContent = last ? "Done" : "Next →";
    ref("skip").hidden = last;
    const body = ref("body");
    body.classList.remove("copy-swap");
    void body.offsetWidth;
    body.classList.add("copy-swap");
  }

  const listeners = [];
  const on = (el, type, fn) => {
    el.addEventListener(type, fn);
    listeners.push(() => el.removeEventListener(type, fn));
  };

  dots.forEach((dot) => on(dot, "click", () => setStep(Number(dot.dataset.goto))));
  on(ref("next"), "click", () => (step === steps.length - 1 ? onClose() : setStep(step + 1)));
  on(ref("try"), "click", () => (steps[step] === "pass" ? setStep(step + 1) : onTry(steps[step])));
  on(ref("skip"), "click", () => onClose());
  on(ref("close"), "click", () => onClose());
  on(canvas, "click", (event) => {
    const rect = canvas.getBoundingClientRect();
    manualHop = performance.now();
    burstParticles((event.clientX - rect.left) * S.dpr, (event.clientY - rect.top) * S.dpr, 8, ["♥", "*", "+"]);
  });
  on(root, "keydown", (event) => {
    if (event.key === "ArrowRight") setStep(step + 1);
    else if (event.key === "ArrowLeft") setStep(step - 1);
    else if (event.key === "Tab") {
      // A modal: Tab cycles through the tour's own buttons.
      const items = [...root.querySelectorAll("button")].filter((el) => !el.hidden && el.offsetParent !== null);
      if (!items.length) return;
      const at = items.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
      const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at === -1 || at === items.length - 1 ? 0 : at + 1);
      event.preventDefault();
      items[next].focus();
    }
  });
  let swipeX = null;
  on(stage, "pointerdown", (event) => { swipeX = event.clientX; });
  on(stage, "pointerup", (event) => {
    if (swipeX === null) return;
    const dx = event.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) > 48) setStep(step + (dx < 0 ? 1 : -1));
  });

  const resize = new ResizeObserver(measure);
  resize.observe(stage);
  measure();
  setStep(0);
  frame = requestAnimationFrame(tick);
  // Focus to hand back on close; a replaced tour's own button doesn't count.
  const returnFocus = root.contains(document.activeElement) ? null : document.activeElement;
  ref("try").focus({ preventScroll: true });

  /** @param {boolean} [restoreFocus] false when another tour replaces this one */
  return function stop(restoreFocus = true) {
    cancelAnimationFrame(frame);
    resize.disconnect();
    listeners.forEach((off) => off());
    // Hand focus back unless something else (a feature the tour opened) has taken it.
    const active = document.activeElement;
    const free = !active || active === document.body || root.contains(active);
    if (restoreFocus && free && returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  };
}

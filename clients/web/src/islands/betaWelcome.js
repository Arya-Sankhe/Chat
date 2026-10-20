// The beta thank-you scene, on the home page's night sky. Klui flies in towing a THANK YOU banner,
// bails out on a parachute, stomps the three beta bugs into hearts and celebrates under fireworks.
// After that it idles: blinks, waves, hops now and then, and the plane loops past with the banner.
// Klui, its plane and the bugs are drawn as extruded blocks the way home/hero.js draws them.

const FONT = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const SKY = "#1c1c1f";
const GREY = { far: "#3f3f43", mid: "#6c6b6f", near: "#a9a7a0", ink: "#efede6" };
const BODY = { f: "#8fd3fb", t: "#d3f2ff", s: "#4b97cf" };
const EYE = "#16202e";
const CORAL = { f: "#ff623f", t: "#ff9a7a", s: "#b8401f" };
const CREAM = { f: "#fff0d1", t: "#ffffff", s: "#cdb38a" };
const INK = { f: "#16202e", t: "#3a4a66", s: "#0b111c" };
const BUG = { f: "#b07cff", t: "#d6b8ff", s: "#6c3fc0" };
const CORD = { f: "#9aa4b8", s: "rgba(0,0,0,0)" };
const SPARKS = ["#ff623f", "#ffd43b", "#8fd3fb", "#fff0d1", "#ff9a7a"];
const LEG = 1.4;
const PLANE_SECS = 3.6;
const PLANE_EVERY = 11;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const hash = (n) => {
  n |= 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

export function mountBetaWelcome(canvas, { banner = "THANK YOU ♥" } = {}) {
  const g = canvas.getContext("2d", { alpha: false });
  const S = { W: 1, H: 1, dpr: 1, u: 6, ground: 1 };
  let backdrop = null;
  let bannerArt = null;
  let plan = null;
  let parts = [];
  let fired = new Set();
  let nextFirework = 0;
  let start = 0;
  let frame = 0;

  // ---------- block drawing (as in home/hero.js) ----------
  const list = [];
  const box = (x, y, w, h, pal, d = 1) => list.push({ k: 0, x, y, w, h, pal, d });
  const flat = (x, y, w, h, colour) => list.push({ k: 1, x, y, w, h, colour });

  function render(X, Y, sx = 1, sy = 1) {
    const u = S.u;
    const ex = -0.85 * u, ey = -0.6 * u;
    const steps = Math.max(2, Math.round(Math.abs(ex)));
    g.setTransform(sx, 0, 0, sy, X * (1 - sx), Y * (1 - sy));
    const R = (x, y, w, h) => {
      const l = Math.round(X + x * u), t = Math.round(Y + y * u);
      return [l, t, Math.round(X + (x + w) * u) - l, Math.round(Y + (y + h) * u) - t];
    };
    for (const it of list) {
      if (it.k) continue;
      const [l, t, w, h] = R(it.x, it.y, it.w, it.h);
      const n = Math.round(steps * it.d);
      g.fillStyle = it.pal.s;
      for (let s = n; s >= 1; s--) g.fillRect(l + Math.round(ex * it.d * s / n), t + Math.round(ey * it.d * s / n), w, h);
      g.fillStyle = it.pal.t;
      const th = Math.max(1, Math.ceil(Math.abs(ey) / steps) + 1);
      for (let s = n; s >= 1; s--) g.fillRect(l + Math.round(ex * it.d * s / n), t + Math.round(ey * it.d * s / n), w, th);
    }
    for (const it of list) {
      g.fillStyle = it.k ? it.colour : it.pal.f;
      g.fillRect(...R(it.x, it.y, it.w, it.h));
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    list.length = 0;
  }

  // Klui with legs stands with its feet on (ox, oy); without, its body sits 2.5 blocks above oy.
  function klui(ox, oy, k) {
    const bot = oy - (k.legs ? LEG : 2.5) - (k.bob || 0);
    if (k.legs) {
      for (const [lx, ly] of [[-3.3, k.legA || 0], [1.8, k.legB || 0]]) {
        box(ox + lx, bot - 0.5, 1.5, Math.max(0.5, oy - ly - bot + 0.5), BODY, 0.5);
      }
    }
    box(ox - 5, bot - 6, 10, 6, BODY);
    box(ox - 7, bot - 4 + (k.armBack || 0), 2, 2, BODY, 0.6);
    box(ox + 5, bot - 4 + (k.armFront || 0), 2, 2, BODY, 0.6);
    if (k.blink) {
      flat(ox - 1.25, bot - 4, 1.5, 0.5, EYE);
      flat(ox + 2.75, bot - 4, 1.5, 0.5, EYE);
    } else {
      flat(ox - 1, bot - 4.7, 1, 1.5, EYE);
      flat(ox + 3, bot - 4.7, 1, 1.5, EYE);
    }
    if (k.goggles) {
      flat(ox - 5, bot - 6.1, 10, 0.7, "#6b3e26");
      box(ox - 1.8, bot - 7.5, 2.2, 1.6, { f: "#79cfff", t: "#c9efff", s: "#7a4a2a" }, 0.4);
      box(ox + 2.2, bot - 7.5, 2.2, 1.6, { f: "#79cfff", t: "#c9efff", s: "#7a4a2a" }, 0.4);
    }
  }

  // A striped canopy whose bottom edge sits at y = by.
  function chute(cx, by, open) {
    const rows = [6.5, 10.5, 13.5, 15, 16];
    const h = 1.05 * Math.min(1, open * 1.5);
    for (let r = 0; r < rows.length; r++) {
      const w = rows[r] * open, y = by - (rows.length - r) * h;
      for (let s = 0; s < 5; s++) box(cx - w / 2 + (s * w) / 5, y, w / 5 + 0.04, h + 0.04, s % 2 ? CREAM : CORAL, 0.6);
    }
    return rows[rows.length - 1] * open;
  }

  function plane(X, Y, t, rider) {
    const bob = Math.sin(t * 1.3) * 1.2;
    const y = (v) => v + bob;
    if (rider) {
      for (let i = 0; i < 6; i++) flat(-6.5 - i * 1.5, y(-5.4 + Math.sin(t * 11 - i * 0.9) * 0.25 * i), 1.6, 1, i % 2 ? "#ff623f" : "#ff8a6a");
    }
    box(-13, y(-4.2), 6, 1.2, CORAL);
    box(-12, y(-9), 2.8, 5, CORAL);
    if (rider) klui(-1, y(-2.2), { armFront: -0.6, blink: blinking(t), goggles: true });
    box(-11, y(-4.6), 23, 4.6, CREAM);
    flat(-11, y(-2.8), 23, 0.9, "#ff623f");
    box(12, y(-5.2), 2.6, 6, CORAL);
    box(-5, y(0.2), 15, 1.4, CORAL);
    box(-2, y(-14.6), 15, 1.3, CORAL);
    flat(5, y(-13.3), 0.6, 8.7, INK.f);
    flat(10, y(-13.3), 0.6, 8.7, INK.f);
    flat(1, y(3.2), 2.2, 1.4, INK.f);
    const blade = Math.floor(t * 30) % 2 ? 9 : 4;
    flat(15, y(-2.2 - blade / 2), 0.8, blade, "rgba(22,32,46,.75)");
    flat(14.6, y(-2.8), 1.4, 1.4, "#ffd43b");
    render(X, Y);
    return Y + bob * S.u;
  }

  // The banner flaps more the further it is from the tow rope.
  function towedBanner(tailX, tailY, t) {
    const { u } = S;
    const right = Math.round(tailX - 6 * u), top = Math.round(tailY - bannerArt.height / 2);
    g.strokeStyle = CORD.f;
    g.lineWidth = Math.max(1, S.dpr);
    g.beginPath();
    g.moveTo(tailX, tailY);
    g.lineTo(right, tailY);
    g.stroke();
    const strip = Math.max(2, Math.round(u / 2));
    const n = Math.ceil(bannerArt.width / strip);
    for (let i = 0; i < n; i++) {
      const sx = bannerArt.width - (i + 1) * strip;
      const w = Math.min(strip, bannerArt.width - i * strip);
      const dy = Math.sin(t * 7 - i * 0.35) * 0.45 * u * Math.min(1, i / n * 2.5);
      g.drawImage(bannerArt, Math.max(0, sx), 0, w, bannerArt.height, right - (i + 1) * strip, Math.round(top + dy), w, bannerArt.height);
    }
  }

  function bug(X, Y, t, facing) {
    const step = Math.floor(t * 12) % 2;
    flat(-1.8, -0.6 - step * 0.3, 0.6, 0.6, BUG.s);
    flat(0, -0.6 - (1 - step) * 0.3, 0.6, 0.6, BUG.s);
    flat(1.4, -0.6 - step * 0.3, 0.6, 0.6, BUG.s);
    box(-2.2, -2.8, 4.4, 2.3, BUG, 0.5);
    flat(-1.4, -2.6, 0.8, 0.8, "#6c3fc0");
    flat(0.4, -2.0, 0.8, 0.8, "#6c3fc0");
    const hx = facing > 0 ? 2.2 : -3.6;
    box(hx, -2.4, 1.4, 1.5, INK, 0.4);
    flat(hx + (facing > 0 ? 0.7 : 0.2), -2.1, 0.5, 0.5, "#ffffff");
    flat(hx + (facing > 0 ? 1.1 : -0.1), -3.4 + step * 0.2, 0.3, 1.1, INK.t);
    render(X, Y, facing, 1);
  }

  // ---------- the backdrop: stars, a far ridge and the ASCII ground, painted once per size ----------
  function paintBackdrop() {
    const { W, H, dpr } = S;
    const cw = Math.max(4, Math.round(7 * dpr)), ch = Math.max(8, Math.round(13 * dpr));
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const b = cv.getContext("2d");
    b.fillStyle = SKY;
    b.fillRect(0, 0, W, H);
    b.font = `${Math.round(11 * dpr)}px ${FONT}`;
    b.textAlign = "center";
    b.textBaseline = "middle";
    const groundRow = Math.floor(S.ground / ch);
    const cols = Math.ceil(W / cw);
    const ridge = (c) => Math.round(3 + 2.2 * Math.sin(c * 0.09 + 1.3) + 1.4 * Math.sin(c * 0.23));
    for (let c = 0; c < cols; c++) {
      const top = groundRow - ridge(c);
      const next = groundRow - ridge(c + 1), prev = groundRow - ridge(c - 1);
      const x = c * cw + cw / 2;
      b.fillStyle = GREY.far;
      b.fillText(next < top ? "/" : prev < top ? "\\" : "_", x, (top + 0.5) * ch);
      for (let r = top + 1; r < groundRow; r++) {
        if (hash(c * 131 + r * 7) < 0.14) b.fillText(hash(c + r * 17) < 0.5 ? "." : ":", x, (r + 0.5) * ch);
      }
      for (let r = groundRow; r * ch < H; r++) {
        const h = hash(c * 977 + r * 31);
        if (r === groundRow) {
          b.fillStyle = GREY.near;
          b.fillText(h < 0.75 ? "_" : "-", x, (r + 0.2) * ch);
          continue;
        }
        const depth = (r - groundRow) / 6;
        if (h > 0.55 - depth * 0.15) continue;
        b.fillStyle = h < 0.12 ? GREY.mid : GREY.far;
        b.fillText("/.,'`"[Math.floor(hash(c * 13 + r) * 5)], x, (r + 0.5) * ch);
      }
    }
    return cv;
  }

  const stars = Array.from({ length: 64 }, (_, i) => ({
    x: hash(i * 3 + 1), y: hash(i * 5 + 2), g: "*+..·"[Math.floor(hash(i * 7 + 3) * 5)],
    speed: 0.6 + hash(i * 11) * 1.8, phase: hash(i * 13) * 6.3
  }));

  function paintBanner() {
    const { u } = S;
    const size = Math.round(2.3 * u);
    const font = `700 ${size}px ${FONT}`;
    g.font = font;
    const w = Math.round(g.measureText(banner).width + 5 * u), h = Math.round(4 * u);
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const b = cv.getContext("2d");
    b.fillStyle = CREAM.f;
    b.fillRect(0, 0, w, h);
    b.fillStyle = CREAM.t;
    b.fillRect(0, 0, w, Math.round(u * 0.4));
    b.fillStyle = CREAM.s;
    b.fillRect(0, h - Math.round(u * 0.4), w, Math.round(u * 0.4));
    b.fillStyle = CORAL.f;
    b.fillRect(0, 0, Math.round(u), h);
    b.fillRect(w - Math.round(u), 0, Math.round(u), h);
    b.font = font;
    b.textAlign = "center";
    b.textBaseline = "middle";
    b.fillStyle = INK.f;
    b.fillText(banner, w / 2, h / 2 + Math.round(u * 0.15));
    return cv;
  }

  // ---------- the script ----------
  // Every position is a function of the time, so a dropped frame never leaves Klui behind.
  function makePlan() {
    const { W, u } = S;
    const planeX = (p) => lerp(-34 * u, W + 30 * u + bannerArt.width, p);
    const bail = PLANE_SECS * (W * 0.42 - planeX(0)) / (planeX(1) - planeX(0));
    const land = bail + 2.3;
    const bugs = [0.64, 0.8, 0.33].map((at, i) => ({ x: W * at, from: at < 0.5 ? -8 * u : W + 8 * u, start: land - 1.6 + i * 0.25 }));
    const hops = [];
    let x = W * 0.5, at = land + 0.55;
    bugs.forEach((b, i) => {
      hops.push({ t0: at, d: 0.55, from: x, to: b.x, h: 7 + Math.abs(b.x - x) / u * 0.08, bug: i });
      b.squash = at + 0.55;
      x = b.x;
      at += 0.85;
    });
    hops.push({ t0: at, d: 0.6, from: x, to: W * 0.5, h: 8 });
    const cheer = at + 0.75;
    for (let k = 0; k < 3; k++) hops.push({ t0: cheer + k * 0.5, d: 0.42, from: W * 0.5, to: W * 0.5, h: 5, cheer: true });
    return { planeX, bail, land, bugs, hops, cheer, idle: cheer + 1.6, planeAgain: cheer + 2.4 };
  }

  function planeProgress(t) {
    if (t < PLANE_SECS) return t / PLANE_SECS;
    const since = t - plan.planeAgain;
    if (since < 0) return -1;
    const p = (since % PLANE_EVERY) / PLANE_SECS;
    return p <= 1 ? p : -1;
  }

  function blinking(t) {
    return (t % 3.7) < 0.12 || (t % 9.1) < 0.12;
  }

  function kluiPose(t) {
    const { u } = S;
    const ground = S.ground;
    if (t < plan.bail) return null;
    const out = plan.bail + 0.35;
    if (t < plan.land) {
      const bob = Math.sin(plan.bail * 1.3) * 1.2;
      const x0 = plan.planeX(plan.bail / PLANE_SECS) - u, y0 = S.H * 0.3 + (bob - 3.3) * u;
      if (t < out) {
        const p = (t - plan.bail) / 0.35;
        return { x: x0 + p * 2 * u, y: y0 - Math.sin(p * Math.PI) * 4 * u, mode: "hop" };
      }
      const p = (t - out) / (plan.land - out);
      return {
        x: lerp(x0 + 2 * u, S.W * 0.5, ease(p)) + Math.sin(t * 2.4) * 1.2 * u * (1 - p),
        y: lerp(y0, ground, p),
        mode: "fall",
        open: clamp((t - out) / 0.4, 0, 1)
      };
    }
    let x = S.W * 0.5;
    let landedAt = plan.land;
    for (const hop of plan.hops) {
      if (t < hop.t0) break;
      const p = (t - hop.t0) / hop.d;
      if (p < 1) {
        return { x: lerp(hop.from, hop.to, p), y: ground - Math.sin(p * Math.PI) * hop.h * u, mode: "hop", cheer: hop.cheer };
      }
      x = hop.to;
      landedAt = hop.t0 + hop.d;
    }
    const pose = { x, y: ground, mode: "stand", squash: clamp(1 - (t - landedAt) / 0.18, 0, 1) };
    if (t > plan.land && t < plan.land + 0.35) pose.chute = 1 - (t - plan.land) / 0.35;
    if (t >= plan.idle) {
      const phase = (t - plan.idle) % 3.6;
      if (phase < 0.4) return { x, y: ground - Math.sin(phase / 0.4 * Math.PI) * 3 * u, mode: "hop", cheer: true };
      if (phase > 1.4 && phase < 2.6) pose.wave = Math.sin((phase - 1.4) * 14);
    }
    return pose;
  }

  function drawKlui(pose, t) {
    const { x, y } = pose;
    const blink = blinking(t);
    if (pose.mode === "fall") {
      const w = chute(0, -12.2, pose.open);
      if (pose.open > 0.05) {
        for (const [a, b] of [[-w / 2 + 0.4, -6], [-w / 6, -5.6], [w / 6, 5.6], [w / 2 - 0.4, 6]]) {
          const n = 10;
          for (let s = 0; s <= n; s++) flat(lerp(a, b, s / n) - 0.15, lerp(-12.2, -7.4, s / n), 0.3, 0.3, CORD.f);
        }
      }
      const kick = Math.sin(t * 5) * 0.35;
      klui(0, 0, { legs: true, blink, armFront: -2.2, armBack: -2.2, goggles: true, legA: kick, legB: -kick });
      render(x, y);
      return;
    }
    if (pose.chute > 0) {
      chute(-3, -1.5, pose.chute * 0.9);
      render(x, y);
    }
    const sq = (pose.squash || 0) * 0.14;
    if (pose.mode === "hop") {
      const arms = pose.cheer ? -2.4 : -1.8;
      klui(0, 0, { legs: true, blink, armFront: arms, armBack: arms, goggles: true, legA: 0.6, legB: 0.6 });
    } else {
      klui(0, 0, { legs: true, blink, goggles: true, armFront: pose.wave ? -1.8 + pose.wave * 0.7 : 0 });
    }
    render(x, y, 1 + sq, 1 - sq);
  }

  // ---------- particles ----------
  function burst(x, y, { count, glyphs, colours, speed, lift = 0, gravity, life }) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const v = speed * (0.55 + Math.random() * 0.45) * S.dpr;
      parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - lift * S.dpr, gravity: gravity * S.dpr,
        life, max: life, glyph: glyphs[i % glyphs.length], colour: colours[i % colours.length]
      });
    }
  }

  function firework(x, y) {
    burst(x, y, { count: 18, glyphs: ["*", "+", "·", "*"], colours: SPARKS, speed: 120, gravity: 60, life: 1.1 });
  }

  function events(t) {
    const fire = (key, at, fn) => {
      if (t < at || fired.has(key)) return;
      fired.add(key);
      if (t - at < 1) fn();
    };
    plan.bugs.forEach((b, i) => fire(`bug${i}`, b.squash, () => {
      burst(b.x, S.ground - 2 * S.u, { count: 7, glyphs: ["♥", "♥", "*"], colours: ["#ff623f", "#ff9a7a", "#ffd43b"], speed: 70, lift: 120, gravity: 260, life: 0.9 });
    }));
    for (let k = 0; k < 3; k++) {
      fire(`cheer${k}`, plan.cheer + k * 0.45, () => {
        firework(S.W * (0.25 + 0.25 * k + (Math.random() - 0.5) * 0.08), S.H * (0.18 + Math.random() * 0.16));
      });
    }
    if (t >= plan.idle + 1.2 && t >= nextFirework) {
      nextFirework = t + 2.4 + Math.random() * 1.6;
      firework(S.W * (0.12 + Math.random() * 0.76), S.H * (0.12 + Math.random() * 0.22));
    }
  }

  function drawParts(dt) {
    g.font = `700 ${Math.round(S.u * 1.9)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    parts = parts.filter((p) => (p.life -= dt) > 0);
    for (const p of parts) {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.globalAlpha = clamp(p.life / p.max * 1.4, 0, 1);
      g.fillStyle = p.colour;
      g.fillText(p.glyph, p.x, p.y);
    }
    g.globalAlpha = 1;
  }

  // ---------- frames ----------
  function measure() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(1, rect.width), cssH = Math.max(1, rect.height);
    S.dpr = dpr;
    S.W = canvas.width = Math.round(cssW * dpr);
    S.H = canvas.height = Math.round(cssH * dpr);
    S.u = Math.round(clamp(Math.min(cssW / 120, cssH / 58), 3.5, 8) * dpr);
    S.ground = Math.round(S.H * 0.82);
    backdrop = paintBackdrop();
    bannerArt = paintBanner();
    plan = makePlan();
  }

  let last = 0;
  function draw(now) {
    const t = (now - start) / 1000;
    const dt = Math.min(0.05, Math.max(0, t - last));
    last = t;
    g.drawImage(backdrop, 0, 0);
    g.font = `${Math.round(11 * S.dpr)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const s of stars) {
      g.globalAlpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      g.fillStyle = GREY.ink;
      g.fillText(s.g, s.x * S.W, s.y * (S.ground - 7 * 13 * S.dpr));
    }
    g.globalAlpha = 1;
    const p = planeProgress(t);
    if (p >= 0) {
      const X = plan.planeX(p);
      const Y = plane(X, Math.round(S.H * 0.3), t, t < plan.bail);
      towedBanner(X - 13 * S.u, Y - 3.6 * S.u, t);
    }
    for (const b of plan.bugs) {
      if (t < b.start || t >= b.squash) continue;
      const p = clamp((t - b.start) / 1.6, 0, 1);
      const wiggle = p >= 1 ? Math.sin(t * 5 + b.x) * 0.8 * S.u : 0;
      const facing = p < 1 ? Math.sign(b.x - b.from) : Math.cos(t * 5 + b.x) >= 0 ? 1 : -1;
      bug(lerp(b.from, b.x, ease(p)) + wiggle, S.ground, t, facing);
    }
    events(t);
    const pose = kluiPose(t);
    if (pose) drawKlui(pose, t);
    drawParts(dt);
    frame = requestAnimationFrame(draw);
  }

  const resize = new ResizeObserver(measure);
  measure();
  resize.observe(canvas);
  start = performance.now();
  frame = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    parts = [];
    fired = new Set();
  };
}

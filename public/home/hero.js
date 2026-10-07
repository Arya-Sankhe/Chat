// The home hero: Klui travels through a loop of ASCII scenes, one for each part of the day. It flies
// over a cloud sea at night, parachutes into a sunrise meadow, hops on a bike across campus, rides
// to a lakeshore and sails off at golden hour, then the night wipes back in. Each scene is a few
// parallax layers of monochrome glyphs drawn once into small canvas chunks and reused, so a frame
// is mostly drawImage calls. Klui and its rides are the only things in colour.
// Each hand-off is a little scripted beat (see TRANSITIONS) under a character-cell dissolve that
// sweeps the next scene in from the right.
(() => {
  "use strict";

  const canvas = document.querySelector(".hero-canvas");
  const ctx = canvas && canvas.getContext && canvas.getContext("2d", { alpha: false });
  if (!ctx) return;
  const hero = canvas.closest(".hero");
  const reduceQuery = matchMedia("(prefers-reduced-motion: reduce)");

  const FONT = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
  const CHUNK = 24; // columns per cached chunk
  const SCRAMBLE = "01<>/\\{}[]#$%&*+=~?";

  // ---------- small maths ----------
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (t) => t * t * (3 - 2 * t);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const hash = (n) => {
    n |= 0;
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const hash2 = (a, b) => hash(Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x9e3779b1));
  const noise = (x, seed = 0) => {
    const i = Math.floor(x);
    return lerp(hash(i * 7919 + seed * 104729), hash((i + 1) * 7919 + seed * 104729), smooth(x - i));
  };
  const fbm = (x, seed) => noise(x, seed) * 0.6 + noise(x * 2.3, seed + 3) * 0.28 + noise(x * 5.1, seed + 7) * 0.12;
  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t, alpha = 1) => {
    const A = rgb(a), B = rgb(b);
    const c = A.map((v, i) => Math.round(lerp(v, B[i], t)));
    return alpha < 1 ? `rgba(${c[0]},${c[1]},${c[2]},${alpha})` : `rgb(${c[0]},${c[1]},${c[2]})`;
  };
  const fade = (hex, alpha) => mix(hex, hex, 0, alpha);

  // ---------- geometry ----------
  // Everything is in device pixels. cw/ch are the glyph cell, u is one block of the mascot.
  const G = { W: 1, H: 1, dpr: 1, cw: 8, ch: 15, fs: 12, u: 8, font: "", cols: 1, rows: 1, portrait: false };

  function measure() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(1, rect.width), cssH = Math.max(1, rect.height);
    const fs = clamp(Math.round(cssW / 116), 9, 13);
    G.dpr = dpr;
    G.W = Math.round(cssW * dpr);
    G.H = Math.round(cssH * dpr);
    G.fs = fs * dpr;
    G.cw = Math.max(4, Math.round(fs * 0.62 * dpr));
    G.ch = Math.max(8, Math.round(fs * 1.24 * dpr));
    G.font = `${G.fs}px ${FONT}`;
    G.u = Math.round(clamp(Math.min(cssW / 165, cssH / 95), 4.2, 8.5) * dpr);
    G.cols = Math.ceil(G.W / G.cw);
    G.rows = Math.ceil(G.H / G.ch);
    G.portrait = cssH > cssW * 1.05;
    canvas.width = G.W;
    canvas.height = G.H;
  }

  // ---------- glyph grids ----------
  // A cell function fills `o` with a glyph (g, colour c, optional scale s and row offset dy) and/or
  // a background fill f. Fills go down first so glyphs can spill over neighbouring cells.
  const o = { g: "", c: "", f: "", s: 0, dy: 0 };
  const glyphs = [];

  function paintGrid(cv, cols, rows, cell) {
    const { cw, ch } = G;
    cv.width = cols * cw;
    cv.height = rows * ch;
    const g = cv.getContext("2d");
    glyphs.length = 0;
    for (let i = 0; i < cols; i++) {
      for (let r = 0; r < rows; r++) {
        o.g = ""; o.f = ""; o.s = 0; o.dy = 0;
        if (!cell(i, r)) continue;
        if (o.f) {
          g.fillStyle = o.f;
          g.fillRect(i * cw, r * ch, cw, ch);
        }
        if (o.g) glyphs.push(i * cw + cw / 2, (r + 0.54 + o.dy) * ch, o.g, o.c, o.s);
      }
    }
    g.textAlign = "center";
    g.textBaseline = "middle";
    let font = "";
    for (let j = 0; j < glyphs.length; j += 5) {
      const f = glyphs[j + 4] ? `700 ${Math.round(G.fs * glyphs[j + 4])}px ${FONT}` : G.font;
      if (f !== font) g.font = font = f;
      g.fillStyle = glyphs[j + 3];
      g.fillText(glyphs[j + 2], glyphs[j], glyphs[j + 1]);
    }
    return cv;
  }

  // A parallax band of the world. col(c, R) is computed once per column; cell(o, info, c, r, R,
  // frame) decides each glyph. Chunks are cached per frame and recycled once they scroll away.
  function layer(spec) {
    return { frames: 1, fps: 0, ...spec, cache: new Map(), pool: [], y: 0, R: 1 };
  }

  function placeLayer(L) {
    L.y = Math.round(G.H * L.top);
    L.R = Math.max(2, Math.ceil((G.H * (L.bottom ?? 1) - L.y) / G.ch));
    L.cache.clear();
    L.pool.length = 0;
  }

  function chunk(L, k, frame) {
    const key = k * 8 + frame;
    let cv = L.cache.get(key);
    if (cv) return cv;
    const infos = [];
    for (let i = 0; i < CHUNK; i++) infos.push(L.col(k * CHUNK + i, L.R));
    cv = paintGrid(L.pool.pop() || document.createElement("canvas"), CHUNK, L.R,
      (i, r) => L.cell(o, infos[i], k * CHUNK + i, r, L.R, frame));
    L.cache.set(key, cv);
    return cv;
  }

  function drawLayer(g, L, camX, t, shiftY = 0) {
    const off = Math.round(camX * L.p);
    const w = CHUNK * G.cw;
    const k0 = Math.floor(off / w), k1 = Math.floor((off + G.W) / w);
    const frame = L.frames > 1 ? Math.floor(t * L.fps) % L.frames : 0;
    for (let k = k0; k <= k1; k++) g.drawImage(chunk(L, k, frame), k * w - off, L.y + shiftY);
    L.next = k1 + 1;
    L.frame = frame;
    if (L.cache.size > (k1 - k0 + 3) * L.frames) {
      for (const [key, cv] of L.cache) {
        const k = Math.floor(key / 8);
        if (k < k0 - 1 || k > k1 + 1) {
          L.cache.delete(key);
          if (L.pool.length < 6) L.pool.push(cv);
        }
      }
    }
  }

  // Render the chunk that's about to scroll in, so it never costs a frame of its own.
  function prefetch(scene) {
    for (const L of scene.layers) {
      if (L.next === undefined) continue;
      for (let f = 0; f < L.frames; f++) {
        if (!L.cache.has(L.next * 8 + f)) { chunk(L, L.next, f); return; }
      }
    }
  }

  // Surface glyph from the neighbouring heights: peaks, slopes, flats.
  function edge(i) {
    if (i.l > i.s && i.r > i.s) return "^";
    if (i.r < i.s) return "/";
    if (i.l < i.s) return "\\";
    return "-";
  }

  // ---------- ink ----------
  // The world is monochrome, like a terminal printout: day scenes are dark glyphs on paper, night
  // scenes are pale glyphs on near-black. Depth comes from how dense and how dark the glyphs are.
  // Only Klui and whatever it's riding get colour.
  const DAY = { bg: "#ecebe4", far: "#bdbbb2", mid: "#93918a", near: "#55544f", ink: "#1c1c1f" };
  const NIGHT = { bg: "#1c1c1f", far: "#3f3f43", mid: "#6c6b6f", near: "#a9a7a0", ink: "#efede6" };

  // A glyph for a patch of the given darkness (0..1); n is a per-cell random number.
  const RAMP = ".:-=+*xo#%@";
  const shade = (d, n) => RAMP[clamp(Math.floor((d * 0.8 + n * 0.3) * RAMP.length), 0, RAMP.length - 1)];

  // ---------- sprites ----------
  // A sun drawn in horizontal strokes, or a moon in a diagonal hatch, with a scatter of dots for glow.
  function orb(radius, kind, bright, dim) {
    const { cw, ch } = G;
    const glow = radius * 1.4;
    const cols = Math.ceil((glow * 2) / cw), rows = Math.ceil((glow * 2) / ch);
    return paintGrid(document.createElement("canvas"), cols, rows, (i, r) => {
      const dx = (i + 0.5) * cw - cols * cw / 2, dy = (r + 0.5) * ch - rows * ch / 2;
      const d = Math.hypot(dx, dy) / radius;
      const n = hash2(i * 3 + 1, r * 5 + 2);
      if (d < 1) {
        if (kind === "moon") {
          if (Math.hypot(dx + radius * 0.45, dy + radius * 0.2) / radius < 0.86) {
            if (n < 0.06) { o.g = "."; o.c = dim; return true; }
            return false;
          }
          if (d > 0.9) { o.g = dx < 0 ? "(" : ")"; o.c = bright; return true; }
          if (n < 0.1) { o.g = "o"; o.c = dim; return true; }
          o.g = (i + r) % 3 ? "/" : "V"; o.c = bright;
          return true;
        }
        if (n < 0.07 + d * 0.12) return false;
        o.g = d > 0.9 ? "-" : r % 2 ? "=" : "≡"; o.c = d > 0.75 ? dim : bright;
        return true;
      }
      const g = (glow / radius - d) / (glow / radius - 1);
      if (g > 0 && n < g * 0.3) { o.g = n < g * 0.1 ? "+" : "."; o.c = dim; return true; }
      return false;
    });
  }

  // A scribbled outline cloud. The shape is worked out at half-row resolution so the puffs stay
  // round, then only its outline and a few dots inside are inked.
  function cloud(seed, colour, wide) {
    const cols = wide ? 34 + Math.floor(hash(seed) * 30) : 18 + Math.floor(hash(seed) * 20);
    const rows = wide ? 3 : 3 + Math.floor(hash(seed + 1) * 3);
    const sub = rows * 2;
    const puffs = [];
    const n = wide ? 5 : 3 + Math.floor(hash(seed + 2) * 3);
    for (let i = 0; i < n; i++) {
      const big = i === 1 || i === n - 2;
      const rad = wide ? sub * lerp(0.3, 0.5, hash(seed + 10 + i)) : sub * lerp(0.5, 0.95, hash(seed + 10 + i)) * (big ? 1 : 0.72);
      const x = lerp(rad + 1, cols - rad - 1, i / (n - 1)) + (hash(seed + 20 + i) - 0.5) * 2;
      puffs.push([x, sub - 1, rad]);
    }
    const inside = (c, h) => {
      if (c < 0 || c >= cols || h < 0 || h >= sub - 0.5) return false;
      const X = c + 0.5, Y = h + 0.5;
      if (wide && Math.abs(X - cols / 2) < cols / 2 - 3 && Y > sub - 2.5) return true;
      return puffs.some(([x, y, rad]) => (X - x) ** 2 + (Y - y) ** 2 < rad * rad);
    };
    const cell = (c, r) => inside(c, r * 2) || inside(c, r * 2 + 1);
    return paintGrid(document.createElement("canvas"), cols, rows, (c, r) => {
      if (!cell(c, r)) return false;
      const n = hash2(c + seed * 7, r + seed);
      const left = !cell(c - 1, r), right = !cell(c + 1, r), top = !cell(c, r - 1);
      o.c = colour;
      if (r === rows - 1) o.g = left ? "(" : right ? ")" : n < 0.7 ? "_" : ".";
      else if (left) o.g = top ? "/" : "(";
      else if (right) o.g = top ? "\\" : ")";
      else if (top) o.g = n < 0.55 ? "-" : n < 0.8 ? "~" : "'";
      else if (n < (wide ? 0.3 : 0.12)) o.g = wide ? "-" : n < 0.06 ? ":" : ".";
      else return false;
      return true;
    });
  }

  function makeClouds(scene) {
    const spec = scene.clouds;
    scene.cloudSprites = Array.from({ length: 6 }, (_, i) => cloud(scene.seed * 50 + i * 7, spec.colour, spec.wide));
  }

  function drawClouds(g, scene, camX, t) {
    const spec = scene.clouds;
    const off = camX * spec.p + t * G.dpr * spec.drift;
    const gap = G.W * spec.gap;
    const k0 = Math.floor((off - G.W * 0.4) / gap), k1 = Math.floor((off + G.W) / gap);
    for (let k = k0; k <= k1; k++) {
      if (hash(k * 13 + scene.seed) < 0.22) continue;
      const cv = scene.cloudSprites[Math.floor(hash(k * 29 + scene.seed) * 6)];
      const y = G.H * lerp(spec.y0, spec.y1, hash(k * 37 + scene.seed));
      g.drawImage(cv, Math.round(k * gap + hash(k * 3) * gap * 0.5 - off), Math.round(y));
    }
  }

  function makeStars(scene) {
    const spec = scene.stars;
    const n = Math.round((G.W * G.H) / (G.dpr * G.dpr) / spec.per);
    scene.starList = Array.from({ length: n }, (_, i) => ({
      x: hash(i * 3 + scene.seed), y: hash(i * 5 + 7) ** 1.4 * spec.below,
      g: hash(i * 7) < 0.1 ? "+" : hash(i * 7) < 0.25 ? "*" : hash(i * 7) < 0.6 ? "." : "·",
      c: hash(i * 11) < 0.3 ? NIGHT.ink : NIGHT.near,
      ph: hash(i * 13) * 6.28, sp: 0.6 + hash(i * 17) * 2.4
    }));
  }

  function drawStars(g, scene, t, camX) {
    g.font = G.font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const drift = camX * 0.004;
    for (const s of scene.starList) {
      g.globalAlpha = clamp(0.3 + 0.7 * Math.sin(t * s.sp + s.ph) ** 2, 0, 1) * scene.stars.alpha;
      g.fillStyle = s.c;
      g.fillText(s.g, ((s.x * G.W - drift) % G.W + G.W) % G.W, s.y * G.H);
    }
    g.globalAlpha = 1;
  }

  function sky(g, scene) {
    g.fillStyle = scene.ink.bg;
    g.fillRect(0, 0, G.W, G.H);
  }

  // Paper showing through where a far layer meets the next, for depth.
  function haze(g, top, bottom, colour, strength = 0.7) {
    const y0 = G.H * top, y1 = G.H * bottom;
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, fade(colour, 0));
    grad.addColorStop(1, fade(colour, strength));
    g.fillStyle = grad;
    g.fillRect(0, y0, G.W, y1 - y0);
  }

  function sprite(g, cv, fx, fy) {
    g.drawImage(cv, Math.round(G.W * fx - cv.width / 2), Math.round(G.H * fy - cv.height / 2));
  }

  // ---------- scenes ----------
  function mountains(m) {
    const height = (x) => {
      const a = noise(x / m.scale, m.seed);
      return 0.72 * (1 - Math.abs(a * 2 - 1)) ** 1.5 + 0.28 * noise(x / (m.scale * 0.32), m.seed + 9);
    };
    const surf = (x, R) => Math.floor(R * (m.base + m.amp * (1 - height(x))));
    return layer({ p: m.p, top: m.top, bottom: m.bottom,
      col(c, R) { return { s: surf(c, R), l: surf(c - 1, R), r: surf(c + 1, R) }; },
      cell(o, i, c, r, R) {
        const d = r - i.s;
        if (d < 0) return false;
        const n = hash2(c, r);
        if (d === 0) { o.g = i.l > i.s && i.r > i.s ? "▲" : edge(i); o.c = m.edge; return true; }
        // Snow is bare paper under the ridge line.
        if (m.snowLine && i.s < R * m.snowLine && d < 3) { if (n < 0.08) { o.g = "."; o.c = m.edge; return true; } return false; }
        if (n > m.density * (0.55 + 0.6 * r / R)) return false;
        o.g = m.glyphs ? m.glyphs[Math.floor(hash2(r, c) * m.glyphs.length)] : i.r < i.l ? "/" : "\\";
        o.c = m.hatch;
        return true;
      } });
  }

  const meadow = (() => {
    const K = DAY;
    const peaks = mountains({ p: 0.1, top: 0.36, bottom: 0.82, seed: 3, scale: 26, base: 0.1, amp: 0.62, density: 0.4,
      edge: K.mid, hatch: K.far, snowLine: 0.34 });

    const hillSurf = (x, R) => Math.floor(R * (0.08 + 0.5 * fbm(x / 30, 11)));
    const hills = layer({ p: 0.3, top: 0.55, bottom: 0.86,
      col(c, R) {
        const i = { s: hillSurf(c, R), l: hillSurf(c - 1, R), r: hillSurf(c + 1, R), tree: null, pipe: null };
        const k = Math.floor(c / 9), dx = c - (k * 9 + 4), roll = hash(k * 131 + 7);
        if (roll < 0.4 && Math.abs(dx) <= 2) i.tree = { dx, base: hillSurf(k * 9 + 4, R), h: 3 + Math.floor(hash(k * 17 + 3) * 3) };
        else if (roll > 0.88 && dx >= -2 && dx <= 1) i.pipe = { dx, top: Math.min(hillSurf(k * 9 + 2, R), hillSurf(k * 9 + 5, R)) - 3 };
        return i;
      },
      cell(o, i, c, r, R) {
        if (i.pipe && r >= i.pipe.top && r < i.s + 1) {
          const { dx } = i.pipe, cap = r <= i.pipe.top + 1;
          o.c = K.near;
          if (cap) o.g = dx === -2 ? "[" : dx === 1 ? "]" : r === i.pipe.top ? "=" : "_";
          else if (dx === -2 || dx === 1) o.g = "|";
          else if (hash2(c, r) < 0.5) o.g = dx ? "/" : ":";
          else return false;
          return true;
        }
        if (i.tree) {
          const { dx, base, h } = i.tree, top = base - h;
          if (r >= top && r < base) {
            if (r === base - 1) {
              if (dx !== 0) return r >= i.s ? hillCell(o, i, c, r, R) : false;
              o.g = "|"; o.c = K.near; return true;
            }
            const rr = r - top, half = rr === 0 || r === base - 2 ? 1 : 2;
            if (Math.abs(dx) > half) return r >= i.s ? hillCell(o, i, c, r, R) : false;
            o.c = K.near;
            o.g = Math.abs(dx) === half ? (dx < 0 ? "(" : ")") : "@#%&"[Math.floor(hash2(c, r) * 4)];
            return true;
          }
        }
        return hillCell(o, i, c, r, R);
      } });
    function hillCell(o, i, c, r, R) {
      const d = r - i.s;
      if (d < 0) return false;
      if (d === 0) { o.g = edge(i); o.c = K.near; return true; }
      // Chevron hatching that fills in toward the bottom of the hills.
      if (hash2(c, r) > 0.3 + 0.45 * (r / R)) return false;
      o.g = (c + r) % 4 < 2 ? "\\" : "/"; o.c = K.mid;
      return true;
    }

    // A row of bushes between the hills and the path, kept mid-grey so Klui stands out in front.
    const bushSurf = (x, R) => Math.floor(R * (0.15 + 0.5 * (1 - Math.abs(Math.sin(x * 0.23 + noise(x / 12, 17) * 3)))));
    const bushes = layer({ p: 0.6, top: 0.67, bottom: 0.8,
      col(c, R) { return { s: bushSurf(c, R), l: bushSurf(c - 1, R), r: bushSurf(c + 1, R) }; },
      cell(o, i, c, r, R) {
        const d = r - i.s;
        if (d < 0) return false;
        o.c = K.near;
        if (d === 0) { o.g = i.r < i.s ? "(" : i.l < i.s ? ")" : "~"; return true; }
        const n = hash2(c, r);
        if (n > 0.6) return false;
        o.g = shade(0.3 + 0.4 * (r / R), hash2(r, c));
        o.c = K.mid;
        return true;
      } });

    // Floating ? blocks, brick rows and coins, high enough to clear Klui's head.
    const props = layer({ p: 1, top: 0.47, bottom: 0.63, frames: 4, fps: 6,
      col(c) {
        const k = Math.floor(c / 44), roll = hash(k * 97 + 1);
        const start = k * 44 + 8 + Math.floor(hash(k * 5) * 18);
        if (roll < 0.55) {
          const n = 1 + Math.floor(hash(k * 3) * 3), bx = c - start;
          if (bx < 0 || bx >= n * 3) return null;
          const block = Math.floor(bx / 3);
          return { kind: hash(k * 11 + block) < 0.6 ? "q" : "brick", bx: bx % 3, row: 1 + Math.floor(hash(k * 19) * 2) };
        }
        if (roll < 0.85) {
          const bx = c - start;
          if (bx < 0 || bx > 12 || bx % 3) return null;
          return { kind: "coin", row: 3 - Math.round(Math.sin((bx / 12) * Math.PI) * 2), bx };
        }
        return null;
      },
      cell(o, i, c, r, R, f) {
        if (!i) return false;
        o.c = K.ink;
        if (i.kind === "coin") {
          if (r !== i.row) return false;
          o.g = ["0", "o", "|", "o"][(f + i.bx) % 4]; o.s = 1.2; return true;
        }
        if (r !== i.row && r !== i.row + 1) return false;
        const top = r === i.row;
        if (i.bx !== 1) o.g = top ? (i.bx ? "┐" : "┌") : (i.bx ? "┘" : "└");
        else if (i.kind === "q") { o.g = top ? (f % 4 === 3 ? "!" : "?") : "─"; if (top) { o.s = 1.4; o.dy = 0.45; } }
        else o.g = top ? "#" : "─";
        return true;
      } });

    const groundSurf = (x) => 2 + Math.round(noise(x / 22, 5) * 2);
    const ground = layer({ p: 1, top: 0.76, bottom: 1,
      col(c) { return { s: groundSurf(c), l: groundSurf(c - 1), r: groundSurf(c + 1) }; },
      cell(o, i, c, r, R) {
        const d = r - i.s;
        const n = hash2(c, r);
        if (d === -1) {
          if (n < 0.3) { o.g = n < 0.1 ? '"' : n < 0.2 ? "," : "w"; o.c = K.near; return true; }
          if (n < 0.36) { o.g = "*"; o.c = K.ink; return true; }
          return false;
        }
        if (d < 0) return false;
        o.c = K.ink;
        if (d === 0) { o.g = c % 2 ? "^" : "w"; return true; }
        // Packed earth: rows of dashes that thin out as they go down.
        if (n > 0.75 - 0.35 * (d / R)) return false;
        const m = hash2(r, c);
        o.g = m < 0.06 ? "0" : m < 0.4 ? "-" : m < 0.6 ? "=" : m < 0.8 ? "_" : "·";
        o.c = d < 3 ? K.near : K.mid;
        return true;
      } });

    return {
      id: "meadow", seed: 1, tone: "ink", mode: "walk", speed: 100, ink: K,
      hold: 1.6, out: "mount",
      clouds: { p: 0.05, drift: 4, y0: 0.08, y1: 0.34, gap: 0.3, colour: K.mid },
      layers: [peaks, hills, bushes, props, ground],
      ground: { layer: ground, offset: 0.3, smooth: (x) => 2 + noise(x / 22, 5) * 2 },
      setup() {
        this.sun = orb(Math.min(G.W, G.H) * 0.09, "sun", K.mid, K.far);
      },
      paint(g, t, x) {
        sky(g, this);
        sprite(g, this.sun, G.portrait ? 0.74 : 0.79, G.portrait ? 0.5 : 0.44);
        drawClouds(g, this, x, t);
        drawLayer(g, peaks, x, t);
        haze(g, 0.52, 0.8, K.bg, 0.6);
        drawLayer(g, hills, x, t);
        drawLayer(g, bushes, x, t);
        drawLayer(g, props, x, t);
        drawLayer(g, ground, x, t);
      }
    };
  })();

  const campus = (() => {
    const K = DAY;
    const tower = (c, w, off, seed, R) => {
      const k = Math.floor((c + off) / w), lx = c + off - k * w, pad = Math.floor(hash(k * 13 + seed) * 2);
      if (hash(k * 7 + seed) < 0.15 || lx < pad || lx >= w - 1) return null;
      return { s: Math.floor(R * (0.12 + 0.52 * hash(k * 31 + seed))), lx: lx - pad, w: w - 1 - pad,
        ant: hash(k * 17 + seed) > 0.72 };
    };
    // Far towers: outlines with a scatter of lit windows.
    const skyline = layer({ p: 0.1, top: 0.4, bottom: 0.8,
      col(c, R) {
        const a = tower(c, 9, 0, 1, R), b = tower(c, 13, 5, 2, R);
        return (a && b ? (a.s < b.s ? a : b) : a || b) || { s: R + 2 };
      },
      cell(o, i, c, r) {
        o.c = K.far;
        if (i.ant && r < i.s && r >= i.s - 3 && i.lx === Math.floor(i.w / 2)) { o.g = r === i.s - 3 ? "*" : "|"; return true; }
        const d = r - i.s;
        if (d < 0) return false;
        if (d === 0) { o.g = "_"; return true; }
        if (i.lx === 0 || i.lx === i.w - 1) { o.g = "|"; return true; }
        const n = hash2(c, r);
        if (i.lx % 2 === 1 && d % 2 === 0 && n < 0.7) { o.g = n < 0.2 ? "#" : n < 0.4 ? "o" : "="; return true; }
        if (n > 0.9) { o.g = "."; return true; }
        return false;
      } });

    const SLOT = 24;
    const buildings = layer({ p: 0.3, top: 0.46, bottom: 0.79,
      col(c) {
        const k = Math.floor(c / SLOT);
        return { lx: c - k * SLOT, type: Math.floor(hash(k * 41 + 3) * 4), k };
      },
      cell(o, i, c, r, R) {
        const { lx, type } = i;
        const n = hash2(c, r);
        o.c = K.near;
        const tree = (cx, h) => {
          const dx = lx - cx, top = R - h;
          if (r >= R - 2 && dx === 0) { o.g = "|"; return true; }
          const half = r === top || r === R - 3 ? 1 : 2;
          if (r >= top && r < R - 2 && Math.abs(dx) <= half) {
            o.g = Math.abs(dx) === half ? (dx < 0 ? "(" : ")") : "@#%&"[Math.floor(n * 4)];
            return true;
          }
          return false;
        };
        if (type === 0) { // library: pediment, frieze, columns
          const t = Math.floor(R * 0.42), dxc = Math.abs(lx - 10.5);
          if (lx < 2 || lx > 19) return tree(lx < 2 ? 0 : 22, 6);
          const pt = t - Math.max(1, 4 - Math.floor(dxc / 2.7));
          if (r < pt) return false;
          if (r < t) {
            if (r === pt) o.g = lx < 10.5 ? "/" : "\\";
            else if (r === t - 2 && dxc < 1) o.g = "◆";
            else return false;
            return true;
          }
          if (r === t) { o.g = "="; o.c = K.ink; return true; }
          if (r >= R - 1) { o.g = "▀"; return true; }
          if (dxc < 1.5 && r >= R - 3) { o.g = "█"; o.c = K.ink; return true; }
          if (lx % 3 === 2) { o.g = "‖"; o.c = K.ink; return true; }
          if (n < 0.35) { o.g = ":"; o.c = K.mid; return true; }
          return false;
        }
        if (type === 1) { // dorm: a grid of windows
          const t = Math.floor(R * 0.32);
          if (lx < 3 || lx > 18) return tree(lx < 3 ? 1 : 21, 5);
          if (r < t) return false;
          if (r === t) { o.g = "="; o.c = K.ink; return true; }
          if (lx === 3 || lx === 18) { o.g = "|"; o.c = K.ink; return true; }
          if (lx === 10 && r >= R - 2) { o.g = "█"; o.c = K.ink; return true; }
          if ((r - t) % 2 === 0 && r < R - 1) {
            const w = lx % 3;
            if (w === 1) { o.g = "["; return true; }
            if (w === 2) { o.g = hash2(Math.floor(c / 3), r) < 0.4 ? "■" : "]"; o.c = K.ink; return true; }
            return false;
          }
          if (n < 0.3) { o.g = "·"; o.c = K.mid; return true; }
          return false;
        }
        if (type === 2) { // clock tower
          const t = Math.floor(R * 0.18), dx = lx - 10;
          if (Math.abs(dx) > 3) return tree(dx < 0 ? 3 : 17, 4);
          if (r < t - 4 + Math.abs(dx)) return false;
          o.c = K.ink;
          if (r < t) { if (r === t - 4 + Math.abs(dx)) { o.g = dx < 0 ? "/" : dx > 0 ? "\\" : "^"; return true; } return false; }
          if (r === t + 2 && Math.abs(dx) <= 1) { o.g = dx === 0 ? "O" : dx < 0 ? "(" : ")"; if (!dx) o.s = 1.3; return true; }
          if (Math.abs(dx) === 3) { o.g = "|"; return true; }
          if (n < 0.45) { o.g = shade(0.55, hash2(r, c)); o.c = K.near; return true; }
          return false;
        }
        return tree(4, 6) || tree(12, 8) || tree(20, 5) || (r === R - 1 && lx > 6 && lx < 10 && ((o.g = "‾"), true));
      } });

    const props = layer({ p: 1, top: 0.56, bottom: 0.775,
      col(c) { const k = Math.floor(c / 38); return { dx: c - (k * 38 + 19), bush: hash(k * 7) < 0.5 ? c - (k * 38 + 6) : 99 }; },
      cell(o, i, c, r, R) {
        o.c = K.ink;
        if (Math.abs(i.bush) <= 2 && r >= R - 2) { o.g = r === R - 2 && Math.abs(i.bush) === 2 ? (i.bush < 0 ? "(" : ")") : "@#%&"[Math.floor(hash2(c, r) * 4)]; return true; }
        if (Math.abs(i.dx) > 1 || r < 1) return false;
        if (r === 1) { o.g = i.dx === 0 ? "o" : i.dx < 0 ? "[" : "]"; return true; }
        if (i.dx !== 0) return r === R - 1 && ((o.g = "▄"), true);
        o.g = "|"; o.s = 1.1;
        return true;
      } });

    const road = layer({ p: 1, top: 0.77, bottom: 1,
      col() { return { s: 0 }; },
      cell(o, i, c, r, R) {
        o.c = K.ink;
        if (r === 0) { o.g = c % 5 ? "_" : "|"; return true; }
        if (r === 1) { if (c % 5 === 0) { o.g = "|"; o.c = K.mid; return true; } return false; }
        if (r === 2) { o.g = "="; return true; }
        if (r === 3 + Math.floor((R - 3) / 2) && c % 10 < 5) { o.g = "="; return true; }
        // Asphalt: broken dash rows, like the reference road.
        const n = hash2(c, r);
        if (n > 0.42) return false;
        const m = hash2(r, c);
        o.g = m < 0.08 ? String(Math.floor(m * 100) % 10) : m < 0.5 ? "-" : m < 0.75 ? "—" : "·";
        o.c = K.mid;
        return true;
      } });

    return {
      id: "campus", seed: 2, tone: "ink", mode: "bike", speed: 170, ink: K,
      hold: 4.5, out: "shore",
      clouds: { p: 0.06, drift: 6, y0: 0.06, y1: 0.32, gap: 0.26, colour: K.mid },
      layers: [skyline, buildings, props, road],
      ground: { layer: road, offset: 4.2 },
      setup() {},
      paint(g, t, x) {
        sky(g, this);
        drawClouds(g, this, x, t);
        drawLayer(g, skyline, x, t);
        haze(g, 0.58, 0.8, K.bg, 0.6);
        drawLayer(g, buildings, x, t);
        drawLayer(g, props, x, t);
        drawLayer(g, road, x, t);
      }
    };
  })();

  const lake = (() => {
    const K = NIGHT;
    const HZ = 0.64;
    const hills = (() => {
      const surf = (x, R) => Math.floor(R * (0.25 + 0.55 * fbm(x / 30, 21)));
      return layer({ p: 0.04, top: 0.5, bottom: HZ + 0.004,
        col(c, R) { return { s: surf(c, R), l: surf(c - 1, R), r: surf(c + 1, R) }; },
        cell(o, i, c, r) {
          const d = r - i.s;
          if (d < 0) return false;
          o.c = K.far;
          if (d === 0) { o.g = edge(i); return true; }
          if (hash2(c, r) < 0.4) { o.g = "."; return true; }
          return false;
        } });
    })();

    // Pines read as columns of dots, the way the reference treeline does.
    const pineSurf = (c, R) => {
      let s = R - 1 - (hash2(c, 3) < 0.4 ? 1 : 0);
      for (let k = Math.floor(c / 7) - 2; k <= Math.floor(c / 7) + 2; k++) {
        if (hash(k * 61 + 5) < 0.32) continue;
        const h = Math.floor(R * lerp(0.22, 0.8, hash(k * 23 + 1) ** 1.6)), cx = k * 7 + 3;
        s = Math.min(s, R - h + Math.abs(c - cx) * 2);
      }
      return s;
    };
    const pines = layer({ p: 0.13, top: 0.43, bottom: HZ + 0.004,
      col(c, R) { return { s: pineSurf(c, R), l: pineSurf(c - 1, R), r: pineSurf(c + 1, R) }; },
      cell(o, i, c, r) {
        const d = r - i.s;
        if (d < 0) return false;
        o.c = d < 4 ? K.near : K.mid;
        if (d === 0) { o.g = i.l > i.s && i.r > i.s ? "A" : edge(i); return true; }
        if (hash2(c, r) > 0.85) return false;
        o.g = c % 2 ? ":" : ".";
        return true;
      } });

    // Water in three bands that slide at their own pace, nearer ones faster, so the surface moves
    // the way the cloud sea does under the plane: by parallax, never by re-rolling glyphs.
    const band = (p, top, bottom, seed) => layer({ p, top, bottom,
      col() { return null; },
      cell(o, i, c, r, R) {
        const t = (top - HZ + (bottom - top) * (r / R)) / (1 - HZ);
        const crest = hash2(Math.floor((c + r * 5) / 3), r + seed);
        if (crest > 0.8 - t * 0.2) { o.g = crest > 0.94 ? "=" : "-"; o.c = t > 0.5 ? K.near : K.mid; return true; }
        if (hash2(c, r * 7 + seed) > 0.9 - t * 0.1) { o.g = "·"; o.c = K.far; return true; }
        return false;
      } });
    const water = [band(0.18, HZ, HZ + 0.07, 1), band(0.4, HZ + 0.07, 0.83, 40), band(0.75, 0.83, 1, 80)];

    // The sun's path on the water: wider near the shore, broken up as it shimmers.
    // Each row of the path is a fixed pattern that sways on its own slow wave and breathes in
    // brightness, so it shimmers without any glyph popping in or out.
    function reflection(g, t) {
      const { cw, ch } = G;
      const sx = G.W * this.sunX, top = Math.round(G.H * HZ);
      const rows = Math.ceil((G.H - top) / ch);
      g.font = G.font; g.textAlign = "center"; g.textBaseline = "middle";
      for (let r = 0; r < rows; r++) {
        const half = (this.sunR * (0.55 + r * 0.05)) / cw;
        const sway = Math.sin(t * 0.9 + r * 0.55) * cw * (0.6 + r * 0.04);
        for (let i = -Math.ceil(half); i <= Math.ceil(half); i++) {
          const n = hash2(i * 3 + 1, r * 7 + 2);
          const falloff = 1 - Math.abs(i) / half;
          if (n > falloff * (1 - r / rows * 0.5)) continue;
          g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 1.4 + i * 0.6 + r * 1.1);
          g.fillStyle = falloff > 0.45 ? K.ink : K.near;
          g.fillText(n < 0.15 ? "=" : "-", sx + i * cw + sway, top + (r + 0.55) * ch);
        }
      }
      g.globalAlpha = 1;
    }

    function birds(g, t) {
      g.font = G.font; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = K.near;
      for (let b = 0; b < 5; b++) {
        const x = ((t * (0.025 + b * 0.004) + hash(b) * 1.2) % 1.3 - 0.15) * G.W;
        const y = G.H * (0.2 + hash(b * 7) * 0.16) + Math.sin(t * 0.8 + b) * G.ch * 0.6;
        g.fillText(Math.floor(t * 4 + b) % 2 ? "v" : "-", x, y);
      }
    }

    return {
      id: "lake", seed: 3, tone: "cream", mode: "boat", speed: 70, walk: 100, ink: K,
      hold: 7, out: "warp",
      clouds: { p: 0.04, drift: 3, y0: 0.1, y1: 0.36, gap: 0.34, wide: true, colour: K.far },
      stars: { per: 9000, below: 0.3, alpha: 0.5 },
      layers: [hills, pines, ...water],
      ground: { fixed: HZ + (1 - HZ) * 0.42 },
      setup() {
        this.sunR = Math.min(G.W, G.H) * 0.15;
        this.sunX = G.portrait ? 0.7 : 0.62;
        this.sun = orb(this.sunR, "sun", K.ink, K.mid);
      },
      paint(g, t, x) {
        sky(g, this);
        drawStars(g, this, t, x);
        drawClouds(g, this, x, t);
        sprite(g, this.sun, this.sunX, HZ - 0.1);
        drawLayer(g, hills, x, t);
        drawLayer(g, pines, x, t);
        birds(g, t);
        for (const L of water) drawLayer(g, L, x, t);
        reflection.call(this, g, t);
      }
    };
  })();

  const night = (() => {
    const K = NIGHT;
    const peaks = mountains({ p: 0.04, top: 0.42, bottom: 0.72, seed: 31, scale: 18, base: 0.08, amp: 0.8, density: 0.5,
      edge: K.near, hatch: K.mid, glyphs: "/\\/\\=Xo#" });
    // A deck of round puffs seen side-on: each slot holds one puff, and the surface is the
    // highest puff over the column. Rows are about twice as tall as columns are wide.
    const billow = (c, seed, R, spec) => {
      let s = R;
      const k0 = Math.floor(c / 8);
      for (let k = k0 - 2; k <= k0 + 2; k++) {
        const rad = lerp(5, 11, hash(k * 17 + seed)), dx = c - (k * 8 + 4 + hash(k * 5 + seed) * 3);
        if (Math.abs(dx) >= rad) continue;
        const cy = R * (spec.base + spec.amp * hash(k * 29 + seed)) + rad / 2;
        s = Math.min(s, cy - Math.sqrt(rad * rad - dx * dx) / 2);
      }
      return Math.floor(s);
    };
    const sea = (spec) => {
      const surf = (x, R) => billow(x, spec.seed, R, spec);
      return layer({ p: spec.p, top: spec.top, bottom: spec.bottom,
        col(c, R) { return { s: surf(c, R), l: surf(c - 1, R), r: surf(c + 1, R) }; },
        cell(o, i, c, r, R) {
          const d = r - i.s;
          if (d < 0) return false;
          if (d === 0) { o.g = i.r < i.s ? "(" : i.l < i.s ? ")" : "-"; o.c = spec.edge; return true; }
          const n = hash2(c, r);
          if (n > spec.density * (0.6 + 0.5 * r / R)) return false;
          o.g = n < 0.08 ? "'" : (c + r) % 3 ? "/" : "."; o.c = spec.dots;
          return true;
        } });
    };
    const back = sea({ p: 0.15, top: 0.58, bottom: 0.86, seed: 41, base: 0.1, amp: 0.35, density: 0.32, edge: K.mid, dots: K.far });
    const front = sea({ p: 0.5, top: 0.73, bottom: 1, seed: 47, base: 0.08, amp: 0.3, density: 0.42, edge: K.near, dots: K.mid });

    function shootingStar(g, t) {
      const cycle = 5.5, k = Math.floor(t / cycle), q = (t % cycle) / 0.9;
      if (q > 1) return;
      const x0 = G.W * (0.15 + hash(k * 3) * 0.6), y0 = G.H * (0.05 + hash(k * 5) * 0.15);
      g.font = G.font; g.textAlign = "center"; g.textBaseline = "middle";
      for (let i = 0; i < 9; i++) {
        const p = q - i * 0.035;
        if (p < 0) break;
        g.fillStyle = fade(K.ink, (1 - i / 9) * (1 - q));
        g.fillText(i ? "-" : "*", x0 + p * G.W * 0.22, y0 + p * G.H * 0.12);
      }
    }

    return {
      id: "night", seed: 4, tone: "cream", mode: "plane", speed: 205, ink: K,
      hold: 5, out: "chute",
      clouds: { p: 0.03, drift: 2, y0: 0.2, y1: 0.4, gap: 0.5, colour: K.far },
      stars: { per: 2600, below: 0.62, alpha: 1 },
      layers: [peaks, back, front],
      ground: { fixed: 0.635 },
      setup() {
        this.moon = orb(Math.min(G.W, G.H) * 0.11, "moon", K.near, K.far);
      },
      paint(g, t, x) {
        sky(g, this);
        drawStars(g, this, t, x);
        shootingStar(g, t);
        sprite(g, this.moon, 0.78, G.portrait ? 0.13 : 0.26);
        drawClouds(g, this, x, t);
        drawLayer(g, peaks, x, t);
        haze(g, 0.55, 0.72, K.bg, 0.7);
        drawLayer(g, back, x, t);
        drawLayer(g, front, x, t);
      }
    };
  })();

  const SCENES = [night, meadow, campus, lake];

  function groundY(scene, camX, sx = G.W * KLUI_X) {
    const gr = scene.ground;
    if (gr.fixed) return G.H * gr.fixed;
    const L = gr.layer, x = (camX * L.p + sx) / G.cw;
    if (gr.smooth) return L.y + (gr.smooth(x) + gr.offset) * G.ch;
    return L.y + (L.col(Math.floor(x), L.R).s + gr.offset) * G.ch;
  }

  // ---------- Klui ----------
  // The composer mascot, rebuilt as extruded blocks: a front face, a lit top and a shaded side
  // that recedes to the left, so it reads as a little voxel figure turned toward where it's going.
  const KLUI_X = 0.5;
  const LEG = 1.4; // stubby
  const BODY = { f: "#8fd3fb", t: "#d3f2ff", s: "#4b97cf" };
  const EYE = "#16202e";
  const CORAL = { f: "#ff623f", t: "#ff9a7a", s: "#b8401f" };
  const CREAM = { f: "#fff0d1", t: "#ffffff", s: "#cdb38a" };
  const WOOD = { f: "#d9824a", t: "#f4ad6c", s: "#94491f" };
  const INK = { f: "#16202e", t: "#3a4a66", s: "#0b111c" };
  const SUN = { f: "#ffd43b", t: "#ffe98a", s: "#b8901a" };
  const PERCH = 4.6; // how far above the ground a hop lands Klui on the saddle
  const CORD = { f: "#9aa4b8", s: "rgba(0,0,0,0)" };
  // The demo case Klui hauls through every scene: an amber suitcase with a play button on the front.
  const CASE = { f: "#ffb02e", t: "#ffd27a", s: "#a8650c" };
  const BAG_W = 7, BAG_H = 5;
  const CANOPY = -15.8; // bottom edge of the open parachute, high enough to clear the case
  const list = [];
  let bagAt = null;

  const box = (x, y, w, h, pal, d = 1) => list.push({ k: 0, x, y, w, h, pal, d });
  const flat = (x, y, w, h, colour) => list.push({ k: 1, x, y, w, h, colour });
  // A thick pixel line, stepped in half blocks.
  const line = (ax, ay, bx, by, pal, w = 1) => list.push({ k: 2, ax, ay, bx, by, pal, w });

  function render(g, X, Y, sx = 1, sy = 1) {
    const u = G.u;
    const ex = -0.85 * u, ey = -0.6 * u;
    const steps = Math.max(2, Math.round(Math.abs(ex)));
    g.setTransform(sx, 0, 0, sy, X * (1 - sx), Y * (1 - sy));
    const R = (x, y, w, h) => {
      const l = Math.round(X + x * u), t = Math.round(Y + y * u);
      return [l, t, Math.round(X + (x + w) * u) - l, Math.round(Y + (y + h) * u) - t];
    };
    const dots = (it, fn) => {
      const n = Math.max(1, Math.ceil(Math.hypot(it.bx - it.ax, it.by - it.ay) * 2));
      for (let s = 0; s <= n; s++) fn(lerp(it.ax, it.bx, s / n) - it.w / 2, lerp(it.ay, it.by, s / n) - it.w / 2);
    };
    // Sides and tops first, so every front face sits over every extrusion.
    for (const it of list) {
      if (it.k === 1) continue;
      if (it.k === 2) {
        g.fillStyle = it.pal.s;
        dots(it, (x, y) => { const [l, t, w, h] = R(x, y, it.w, it.w); g.fillRect(l + ex * 0.45, t + ey * 0.45, w, h); });
        continue;
      }
      const [l, t, w, h] = R(it.x, it.y, it.w, it.h);
      const n = Math.round(steps * it.d);
      g.fillStyle = it.pal.s;
      for (let s = n; s >= 1; s--) g.fillRect(l + Math.round(ex * it.d * s / n), t + Math.round(ey * it.d * s / n), w, h);
      g.fillStyle = it.pal.t;
      const th = Math.max(1, Math.ceil(Math.abs(ey) / steps) + 1);
      for (let s = n; s >= 1; s--) g.fillRect(l + Math.round(ex * it.d * s / n), t + Math.round(ey * it.d * s / n), w, th);
    }
    for (const it of list) {
      if (it.k === 0) { g.fillStyle = it.pal.f; g.fillRect(...R(it.x, it.y, it.w, it.h)); }
      else if (it.k === 1) { g.fillStyle = it.colour; g.fillRect(...R(it.x, it.y, it.w, it.h)); }
      else { g.fillStyle = it.pal.f; dots(it, (x, y) => g.fillRect(...R(x, y, it.w, it.w))); }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    list.length = 0;
  }

  // The suitcase with its top-left corner at (x, y) and the handle above. It notes where it went so
  // the play button laid over the canvas can follow it.
  // side says where its "Play demo" tag goes: above, below or right.
  function suitcase(x, y, side = "above") {
    const hx = x + BAG_W / 2 - 1.1;
    box(hx, y - 1.1, 2.2, 0.5, INK, 0.4);
    box(hx, y - 1.1, 0.5, 1.1, INK, 0.4);
    box(hx + 1.7, y - 1.1, 0.5, 1.1, INK, 0.4);
    box(x, y, BAG_W, BAG_H, CASE, 0.8);
    flat(x + 0.7, y, 0.5, BAG_H, CASE.s);
    flat(x + BAG_W - 1.2, y, 0.5, BAG_H, CASE.s);
    const cx = x + BAG_W / 2, cy = y + BAG_H / 2;
    flat(cx - 1.2, cy - 1.9, 2.4, 3.8, CREAM.f);
    flat(cx - 1.9, cy - 1.2, 3.8, 2.4, CREAM.f);
    for (let i = 0; i < 7; i++) {
      const h = 1.15 * (1 - i / 7);
      flat(cx - 0.8 + i * 0.3, cy - h, 0.32, h * 2, INK.f);
    }
    bagAt = { x, y: y - 1.1, w: BAG_W, h: BAG_H + 1.1, side };
  }

  // Klui in sprite blocks. With legs, (ox, oy) is where its feet touch down; without, the body's
  // bottom sits 2.5 blocks above oy. The body is 10 x 6 blocks.
  function klui(ox, oy, k) {
    const bot = oy - (k.legs ? LEG : 2.5) - k.bob;
    if (k.legs) {
      for (const [lx, L] of [[-3.3, k.legA], [1.8, k.legB]]) {
        const top = bot - 0.5, foot = oy - L.y;
        box(ox + lx + L.x, top, 1.5, Math.max(0.5, foot - top), BODY, 0.5);
      }
    }
    box(ox - 5, bot - 6, 10, 6, BODY);
    box(ox - 7, bot - 4 + k.armBack, 2, 2, BODY, 0.6);
    box(ox + 5, bot - 4 + k.armFront, 2, 2, BODY, 0.6);
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
    // On foot, the case rides on Klui's head.
    if (k.bag) suitcase(ox - BAG_W / 2, bot - 6 - (k.goggles ? 1.5 : 0.1) - BAG_H, k.bag);
  }

  // A striped canopy whose bottom edge sits at y = by. Returns its width in blocks.
  function chute(cx, by, open, flatten = 0) {
    const rows = [6.5, 10.5, 13.5, 15, 16];
    const h = 1.05 * Math.min(1, open * 1.5) * (1 - flatten * 0.75);
    for (let r = 0; r < rows.length; r++) {
      const w = rows[r] * open, y = by - (rows.length - r) * h;
      for (let s = 0; s < 5; s++) box(cx - w / 2 + (s * w) / 5, y, w / 5 + 0.04, h + 0.04, s % 2 ? CREAM : CORAL, 0.6);
    }
    return rows[rows.length - 1] * open;
  }

  const state = { idx: 0, t: 0, sceneT: 0, trans: null, camX: 0, speed: 0, walkPh: 0, walkAmp: 1,
    blinkAt: 2, blinkUntil: 0, lastStep: 0, emit: 0, flash: 0, props: [] };
  const parts = [];

  function spawn(p) { if (parts.length < 140) parts.push(p); }

  // Draw one pose. o.rider = false draws a ride on its own (parked bike, moored boat, empty plane).
  function drawMode(g, mode, X, Y, t, o = {}) {
    const u = G.u;
    const blink = t < state.blinkUntil, rider = o.rider !== false;
    bagAt = null;
    let sx = o.sx || 1, sy = o.sy || 1;
    if (mode === "walk") {
      // Quick little steps: a hop of the body on every footfall and a squash as each foot lands.
      const s = Math.sin(state.walkPh), c = Math.cos(state.walkPh), a = state.walkAmp;
      const sq = 0.06 * a * c ** 4;
      sx *= 1 + sq; sy *= 1 - sq;
      klui(0, 0, { legs: true, blink, bag: "above", bob: Math.abs(s) * 0.75 * a, armFront: -1.5 + c * 0.35 * a, armBack: -1.5 - c * 0.35 * a,
        legA: { x: c * 0.75 * a, y: Math.max(0, s) * 0.85 * a }, legB: { x: -c * 0.75 * a, y: Math.max(0, -s) * 0.85 * a } });
    } else if (mode === "hop") {
      klui(0, 0, { legs: true, blink, bag: "above", bob: 0, armFront: -1.8, armBack: -1.8, goggles: o.goggles,
        legA: { x: -0.3, y: 0.6 }, legB: { x: 0.3, y: 0.6 } });
    } else if (mode === "fall") {
      const sw = o.sway || 0, open = o.open ?? 1;
      if (open > 0.02) {
        const w = chute(-sw * 0.3, CANOPY, open);
        // Cords from the canopy's rim to Klui's raised hands.
        line(-sw * 0.3 - w / 2 + 0.4, CANOPY, sw - 6, -7.4, CORD, 0.3);
        line(-sw * 0.3 - w / 6, CANOPY, sw - 5.6, -7.4, CORD, 0.3);
        line(-sw * 0.3 + w / 6, CANOPY, sw + 5.6, -7.4, CORD, 0.3);
        line(-sw * 0.3 + w / 2 - 0.4, CANOPY, sw + 6, -7.4, CORD, 0.3);
      }
      const kick = Math.sin(t * 5) * 0.35;
      klui(sw, 0, { legs: true, blink, bag: "right", bob: 0, armFront: -2.2, armBack: -2.2, goggles: o.goggles,
        legA: { x: kick, y: 0.1 }, legB: { x: -kick, y: 0.3 } });
    } else if (mode === "bike") {
      // A small bike, so Klui sits low on it with the same stubby legs it walks on.
      const ph = o.ph ?? state.camX / (u * 5);
      const bump = rider ? Math.abs(Math.sin(ph * 0.7)) * 0.2 : 0;
      const bx = 0.6, by = -3.7;
      wheel(-6, -3, 3, ph);
      wheel(7, -3, 3, ph);
      line(-6, -3, bx, by, CORAL);
      line(bx, by, -1.6, -7.4, CORAL);
      line(-6, -3, -1.6, -7.4, CORAL);
      line(-1.4, -7.2, 5, -7.6, CORAL);
      line(bx, by, 5, -7.6, CORAL);
      line(5, -7.6, 7, -3, CORAL, 0.9);
      line(5, -7.6, 5.6, -9.6, CREAM, 0.8);
      box(4.6, -10.3, 2.8, 0.9, SUN, 0.5);
      box(-3.4, -8.3 - bump, 3.6, 1, SUN, 0.6);
      // A rear rack over the back wheel, with the case strapped on when Klui is riding.
      line(-6, -3, -9.2, -7.3, CORD, 0.4);
      box(-15.2, -7.5, 8, 0.5, INK, 0.4);
      if (rider) suitcase(-14.8, -7.5 - BAG_H);
      const p1 = { x: bx + Math.cos(ph * 1.4) * 0.9, y: by + Math.sin(ph * 1.4) * 0.9 };
      const p2 = { x: bx - Math.cos(ph * 1.4) * 0.9, y: by - Math.sin(ph * 1.4) * 0.9 };
      if (rider) {
        const bot = -6 - bump;
        box(p2.x - 0.75, bot - 0.5, 1.5, p2.y - bot + 0.5, BODY, 0.5);
        klui(-0.6, bot + 2.5, { bob: 0, armFront: 0, armBack: 0.6, legs: false, blink });
        box(p1.x - 0.75, bot - 0.5, 1.5, p1.y - bot + 0.5, BODY, 0.5);
      }
      box(p1.x - 0.8, p1.y - 0.3, 1.6, 0.6, SUN, 0.3);
    } else if (mode === "boat") {
      const bob = Math.sin(t * 1.9) * 0.45;
      const y = (v) => v + bob;
      const sway = Math.sin(t * 1.3) * 0.5;
      // Mast and sail, behind Klui.
      flat(-7.6, y(-21), 0.8, 18, "#7a4a2a");
      for (let row = 0; row < 15; row++) {
        const w = 1.2 + row * 0.62 + sway * row / 15;
        box(-6.8, y(-20.5 + row), w, 1, row % 5 === 4 ? { f: "#ffd2c4", t: "#fff", s: "#d9a090" } : CREAM, 0.35);
      }
      flat(-6.8, y(-20.5 + 7), 7.5 + sway / 2, 0.8, "#ff623f");
      box(-7.4, y(-23), 3 + Math.sin(t * 6) * 0.4, 1.4, CORAL, 0.3);
      if (rider) {
        klui(1, y(-1.6), { bob: 0, armFront: -0.4, armBack: 0.6, legs: false, blink });
        // The book: a coral cover, two cream pages, and a page that turns now and then.
        box(4.6, y(-8.2), 6, 3.6, CORAL, 0.4);
        box(4.9, y(-8.6), 2.6, 3.4, CREAM, 0.3);
        box(7.7, y(-8.6), 2.6, 3.4, CREAM, 0.3);
        for (let l = 0; l < 3; l++) { flat(5.3, y(-7.9 + l * 0.9), 1.8, 0.3, "#9fb2cf"); flat(8.1, y(-7.9 + l * 0.9), 1.8, 0.3, "#9fb2cf"); }
        const turn = (t % 4.5) / 0.5;
        if (turn < 1) box(7.6 - turn * 2.4, y(-8.9), 2.4 * (1 - Math.abs(turn * 2 - 1)) + 0.2, 3.4, { f: "#ffffff", t: "#fff", s: "#e7d6b5" }, 0.2);
      }
      box(-12, y(-4.3), 3, 1.2, WOOD, 0.6);
      box(10, y(-4.5), 3, 1.4, WOOD, 0.6);
      box(-11, y(-3.2), 23, 1.2, { f: "#f2b06e", t: "#ffd49a", s: "#a55a26" });
      box(-10, y(-2), 21, 1.1, WOOD);
      box(-8.5, y(-0.9), 18, 1.1, WOOD);
      box(-6, y(0.2), 13, 0.9, WOOD, 0.6);
      flat(-9.5, y(-1.45), 20, 0.25, "#9b5226");
      flat(-3, y(-2.6), 1, 1, "#ffd43b");
      if (rider) suitcase(-14.2, y(-4.3) - BAG_H);
    } else if (mode === "plane") {
      const bob = Math.sin(t * 1.3) * 1.2;
      const y = (v) => v + bob;
      if (rider) {
        // Scarf, trailing behind.
        for (let i = 0; i < 6; i++) flat(-6.5 - i * 1.5, y(-5.4 + Math.sin(t * 11 - i * 0.9) * 0.25 * i), 1.6, 1, i % 2 ? "#ff623f" : "#ff8a6a");
      }
      box(-13, y(-4.2), 6, 1.2, CORAL);
      box(-12, y(-9), 2.8, 5, CORAL);
      if (rider) klui(-1, y(-2.2), { bob: 0, armFront: -0.6, armBack: 0, legs: false, blink, goggles: true });
      box(-11, y(-4.6), 23, 4.6, CREAM);
      flat(-11, y(-2.8), 23, 0.9, "#ff623f");
      box(12, y(-5.2), 2.6, 6, CORAL);
      box(-5, y(0.2), 15, 1.4, CORAL);
      box(-2, y(-14.6), 15, 1.3, CORAL);
      flat(5, y(-13.3), 0.6, 8.7, INK.f);
      flat(10, y(-13.3), 0.6, 8.7, INK.f);
      line(3, y(1.4), 2, y(3.4), INK, 0.6);
      flat(1, y(3.2), 2.2, 1.4, INK.f);
      const blade = Math.floor(t * 30) % 2 ? 9 : 4;
      flat(15, y(-2.2 - blade / 2), 0.8, blade, "rgba(22,32,46,.75)");
      flat(14.6, y(-2.8), 1.4, 1.4, "#ffd43b");
      if (rider) {
        // The case, airlifted on a line under the plane and swinging a little behind it.
        const sw = Math.sin(t * 1.7) * 0.5 - 0.4;
        line(-2.5, y(1.6), -2.5 + sw, y(4.7), CORD, 0.3);
        suitcase(-2.5 + sw - BAG_W / 2, y(5.8), "below");
      }
    }
    // Where the case landed on screen, padded for its extruded side and top.
    if (bagAt) state.bag = { x: X + (bagAt.x - 1) * u * sx, y: Y + (bagAt.y - 0.8) * u * sy, w: (bagAt.w + 1.2) * u * sx, h: (bagAt.h + 0.9) * u * sy, side: bagAt.side };
    render(g, X, Y, sx, sy);
  }

  // A dark tyre around a cream rim, so the wheel reads on the day scenes and the night ones.
  function wheel(cx, cy, r, ph) {
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      flat(cx + Math.cos(a) * r - 0.5, cy + Math.sin(a) * r - 0.5, 1, 1, INK.f);
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      flat(cx + Math.cos(a) * (r - 0.75) - 0.3, cy + Math.sin(a) * (r - 0.75) - 0.3, 0.6, 0.6, CREAM.f);
    }
    for (let s = 0; s < 2; s++) {
      const a = -ph + s * Math.PI / 2;
      line(cx - Math.cos(a) * (r - 1), cy - Math.sin(a) * (r - 1), cx + Math.cos(a) * (r - 1), cy + Math.sin(a) * (r - 1), CORD, 0.35);
    }
    flat(cx - 0.5, cy - 0.5, 1, 1, "#ffd43b");
  }

  // Dust, speed lines, wake and contrail, depending on how Klui is getting around.
  function emit(pose, dt, t) {
    const u = G.u, { mode, x: X, y: Y } = pose, v = state.speed;
    state.emit -= dt;
    if (mode === "walk") {
      const step = Math.floor(state.walkPh / Math.PI);
      if (step !== state.lastStep) {
        state.lastStep = step;
        if (state.walkAmp > 0.5) {
          for (let i = 0; i < 2; i++) spawn({ x: X - u * (2.5 + i * 1.5), y: Y - u * 0.3, vx: -G.dpr * (30 + i * 16), vy: -G.dpr * (8 + i * 8), life: 0.4, max: 0.4, glyph: i ? "." : "o", colour: DAY.mid });
        }
      }
    } else if (state.emit <= 0) {
      if (mode === "bike" && v > 110) {
        state.emit = 0.07;
        spawn({ x: X - u * 12, y: Y - u * (2 + Math.random() * 12), vx: -G.dpr * 420, vy: 0, life: 0.35, max: 0.35, glyph: "-", colour: DAY.mid });
      } else if (mode === "boat" && v > 20) {
        state.emit = 0.16;
        spawn({ x: X - u * 12, y: Y + u * 0.8, vx: -G.dpr * 40, vy: G.dpr * 6, life: 1.4, max: 1.4, glyph: Math.random() < 0.5 ? "~" : "-", colour: NIGHT.near });
      } else if (mode === "plane") {
        state.emit = 0.045;
        contrail(X, Y, t);
      }
    }
  }

  function contrail(X, Y, t) {
    spawn({ x: X - G.u * 13, y: Y - G.u * (3.6 - Math.sin(t * 1.3) * 1.2), vx: -G.dpr * 260, vy: 0, life: 0.9, max: 0.9, glyph: Math.random() < 0.5 ? "=" : "-", colour: NIGHT.near });
  }

  function puff(X, Y, colour) {
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      spawn({ x: X + side * G.u * (3 + (i >> 1)), y: Y - G.u * 0.4, vx: side * G.dpr * (40 + i * 10), vy: -G.dpr * (14 + (i >> 1) * 9),
        life: 0.55, max: 0.55, glyph: i < 4 ? "o" : ".", colour });
    }
  }

  function drawParts(g, dt) {
    g.font = G.font; g.textAlign = "center"; g.textBaseline = "middle";
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.grav) p.vy += p.grav * dt;
      g.globalAlpha = clamp(p.life / p.max, 0, 1) * (p.alpha ?? 0.85);
      g.fillStyle = p.colour;
      if (p.glyph) {
        if (p.scale) g.font = `700 ${Math.round(G.fs * p.scale)}px ${FONT}`;
        g.fillText(p.glyph, p.x, p.y);
        if (p.scale) g.font = G.font;
      } else {
        const s = p.size * (0.4 + 0.6 * p.life / p.max);
        g.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), Math.round(s), Math.round(s));
      }
    }
    g.globalAlpha = 1;
  }

  function burst(X, Y, n = 18, flash = true) {
    const colours = ["#ffd43b", "#fff8e9", "#ff623f", "#8fd3fb"];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const v = G.dpr * (90 + Math.random() * 160) * (flash ? 1 : 0.6);
      spawn({ x: X, y: Y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - G.dpr * 40, grav: G.dpr * 260, life: 0.8, max: 0.8,
        glyph: i % 3 ? "*" : "+", scale: 1.3, colour: colours[i % 4], alpha: 1 });
    }
    if (flash) state.flash = 0.22;
  }

  // ---------- dissolve ----------
  const buf = document.createElement("canvas");
  const bufCtx = buf.getContext("2d");
  const mask = document.createElement("canvas");
  const maskCtx = mask.getContext("2d");
  let maskData = null, maskNoise = null;

  function setupMask() {
    buf.width = G.W; buf.height = G.H;
    mask.width = G.cols; mask.height = G.rows;
    maskData = maskCtx.createImageData(G.cols, G.rows);
    maskNoise = new Float32Array(G.cols * G.rows);
    for (let r = 0; r < G.rows; r++) {
      for (let c = 0; c < G.cols; c++) {
        // New scene arrives from the right, ragged at the front.
        maskNoise[r * G.cols + c] = 0.62 * (1 - c / G.cols) + 0.38 * hash2(c * 3 + 1, r * 7 + 2);
      }
    }
  }

  // A scene plus whatever props are standing in it, optionally slid up or down (for the parachute
  // descent, where the night sky lifts away and the meadow rises to meet Klui).
  function paintScene(g, scene, t, x, dy = 0) {
    if (dy) {
      g.fillStyle = scene.ink.bg;
      g.fillRect(0, 0, G.W, G.H);
      g.save();
      g.translate(0, Math.round(dy));
    }
    scene.paint(g, t, x);
    for (const p of state.props) if (p.scene === scene) p.draw(g, t);
    if (dy) g.restore();
  }

  function dissolve(g, from, to, q, t, dyFrom, dyTo) {
    const th = lerp(-0.06, 1.06, ease(q));
    paintScene(g, to, t, state.camX, dyTo);
    paintScene(bufCtx, from, t, state.camX, dyFrom);
    const px = maskData.data;
    for (let i = 0; i < maskNoise.length; i++) px[i * 4 + 3] = maskNoise[i] >= th ? 255 : 0;
    maskCtx.putImageData(maskData, 0, 0);
    bufCtx.globalCompositeOperation = "destination-in";
    bufCtx.imageSmoothingEnabled = false;
    bufCtx.drawImage(mask, 0, 0, G.cols * G.cw, G.rows * G.ch);
    bufCtx.globalCompositeOperation = "source-over";
    g.drawImage(buf, 0, 0);
    // A scramble of code glyphs rides the front of the wipe.
    const { cw, ch } = G;
    g.font = G.font; g.textAlign = "center"; g.textBaseline = "middle";
    const tick = Math.floor(t * 20);
    for (let r = 0; r < G.rows; r++) {
      for (let c = 0; c < G.cols; c++) {
        const v = maskNoise[r * G.cols + c] - th;
        if (v < 0 || v > 0.05) continue;
        const n = hash2(c + tick, r);
        g.fillStyle = to.ink.bg;
        g.fillRect(c * cw, r * ch, cw, ch);
        g.fillStyle = v < 0.018 ? to.ink.ink : n < 0.5 ? to.ink.near : to.ink.mid;
        g.fillText(SCRAMBLE[Math.floor(hash2(r, c + tick) * SCRAMBLE.length)], c * cw + cw / 2, (r + 0.54) * ch);
      }
    }
  }

  // ---------- props ----------
  // Things standing in a scene at a fixed spot in the world: they scroll with the ground.
  const screenX = (wx) => wx - state.camX;

  function dock(scene, endW, deckY, waterY) {
    return {
      scene,
      gone: () => screenX(endW) < -G.cw * 4,
      draw(g) {
        const { cw, ch } = G, off = Math.round(state.camX);
        const c1 = Math.floor(endW / cw), posts = Math.max(1, Math.round((waterY - deckY) / ch));
        g.font = G.font; g.textAlign = "center"; g.textBaseline = "middle";
        for (let c = Math.floor(off / cw) - 1; c <= c1; c++) {
          const x = c * cw - off;
          if (x > G.W) break;
          g.fillStyle = NIGHT.bg;
          g.fillRect(x, deckY, cw, ch);
          g.fillStyle = NIGHT.ink;
          g.fillText(c === c1 ? "]" : c % 6 === 0 ? "+" : "=", x + cw / 2, deckY + ch * 0.5);
          if (c % 6 === 0 || c === c1) {
            g.fillStyle = NIGHT.mid;
            for (let r = 1; r <= posts; r++) g.fillText(r === posts ? "~" : "|", x + cw / 2, deckY + ch * (r + 0.5));
          }
        }
      }
    };
  }

  // A bike standing at world x wx. With no y it sits on the scene's ground; pop scales it in. Its
  // wheel phase matches the ridden bike once it's under Klui, so getting on or off doesn't jump.
  function parkedBike(scene, wx, y, { pop = false, taken = () => false } = {}) {
    const born = state.t;
    return {
      scene,
      gone: () => taken() || screenX(wx) < -G.u * 25,
      draw(g, t) {
        const x = screenX(wx), gy = y ?? groundY(scene, state.camX, x);
        const k = pop ? Math.max(0.01, backOut(clamp((t - born) / 0.4, 0, 1))) : 1;
        g.fillStyle = "rgba(28,28,31,.12)";
        g.fillRect(Math.round(x - G.u * 9.5 * k), Math.round(gy - G.u * 0.3), Math.round(G.u * 19 * k), Math.round(G.u * 0.7));
        drawMode(g, "bike", x, gy, t, { rider: false, ph: (wx - G.W * KLUI_X) / (G.u * 5), sx: k, sy: k });
      }
    };
  }

  function mooredBoat(scene, wx, y, gone) {
    return {
      scene, gone,
      draw(g, t) {
        const x = screenX(wx);
        drawMode(g, "boat", x, y, t, { rider: false });
        waterline(g, x, y, t);
      }
    };
  }

  // The canopy after landing: it sinks onto the grass behind Klui, flattens and fades.
  function droppedChute(scene, wx) {
    const born = state.t;
    return {
      scene,
      gone: () => state.t - born > 1.3,
      draw(g, t) {
        const e = clamp((t - born) / 1.2, 0, 1);
        const x = screenX(wx);
        chute(-e * 4, lerp(CANOPY, -0.2, e * e), 1 + e * 0.25, e);
        g.globalAlpha = 1 - e * e;
        render(g, x, groundY(scene, state.camX, x));
        g.globalAlpha = 1;
      }
    };
  }

  // ---------- transitions ----------
  // Distance (css px) and speed after t seconds of a run of eased speed ramps [seconds, from, to].
  function travel(segs, t) {
    let d = 0;
    for (const [T, a, b] of segs) {
      if (t <= T) {
        const p = t / T;
        return { d: d + T * (a * p + (b - a) * (p * p * p - p * p * p * p / 2)), v: lerp(a, b, smooth(p)) };
      }
      d += T * (a + b) / 2;
      t -= T;
    }
    const v = segs[segs.length - 1][2];
    return { d: d + t * v, v };
  }
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const backOut = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
  const arc = (a, b, p, h) => lerp(a, b, p) - h * 4 * p * (1 - p);
  const land = (k, amount = 0.14) => {
    const s = k > 0 && k < 1 ? Math.sin(k * Math.PI) * amount : 0;
    return { sx: 1 + s, sy: 1 - s };
  };

  const TRANSITIONS = {
    // Klui bails out of the plane, floats down on a parachute while the night lifts away and the
    // meadow rises up, then lands and walks on.
    chute(from, to) {
      const LAND = 4.4;
      const lift = (tt) => -G.H * 0.16 * smooth(clamp((tt - 0.4) / 3.2, 0, 1));
      const rise = (tt) => G.H * 0.16 * (1 - smooth(clamp((tt - 1) / (LAND - 1), 0, 1)));
      const b0 = Math.sin(state.t * 1.3) * 1.2;
      return {
        dur: LAND + 0.5, segs: [[2.4, from.speed, to.speed]], wipe: [1.3, 2.1], fromDy: lift, toDy: rise,
        pose(tt) {
          const X = G.W * KLUI_X, u = G.u;
          const gy = groundY(to, state.camX) + rise(tt);
          // A little hop out of the seat, a drop clear of the plane, then the canopy catches.
          const seat = groundY(from, state.camX) + (b0 - 3.3) * u, peak = seat - 1.5 * u, drop = seat + 7 * u;
          const open = backOut(clamp((tt - 0.5) / 0.35, 0, 1));
          if (tt < 0.25) return { mode: "hop", x: X - u, y: lerp(seat, peak, easeOut(tt / 0.25)), o: { goggles: true } };
          if (tt < 0.75) return { mode: "fall", x: X - u, y: lerp(peak, drop, ((tt - 0.25) / 0.5) ** 2), o: { open, goggles: true } };
          if (tt < LAND) {
            const p = (tt - 0.75) / (LAND - 0.75);
            const sway = Math.sin((tt - 0.75) * 2.3) * 1.4 * (1 - smooth(p));
            return { mode: "fall", x: X - u * (1 - smooth(clamp(p * 2, 0, 1))), y: lerp(drop, gy, smooth(p)),
              o: { open, sway, goggles: true }, shadow: p > 0.5 ? gy : undefined, shadowK: clamp((p - 0.5) * 2, 0, 1) };
          }
          if (!this.landed) {
            this.landed = true;
            puff(X, gy, DAY.mid);
            state.props.push(droppedChute(to, state.camX + X));
          }
          return { mode: "walk", x: X, y: gy, o: land((tt - LAND) / 0.25), shadow: gy };
        },
        over(g, tt) {
          // The empty plane opens the throttle and climbs away to the right.
          if (tt > 2.4) return;
          const e = (tt / 2.4) ** 2;
          const x = G.W * KLUI_X + e * (G.W * (1 - KLUI_X) + G.u * 32);
          const y = groundY(from, state.camX) + lift(tt) - e * G.H * 0.1;
          drawMode(g, "plane", x, y, state.t, { rider: false });
          if (Math.floor(tt * 22) !== Math.floor((tt - 1 / 60) * 22)) contrail(x, y, state.t);
        }
      };
    },

    // A bike pops up on the path ahead. Klui walks over to it, stops, hops on and pedals off into
    // campus: the jetty beat from the other end of the loop, played forwards.
    mount(from, to) {
      const u = G.u, X = G.W * KLUI_X, v = from.speed;
      const D = Math.min(28 * u, G.W - X - 11 * u);
      const walk = Math.max(0.3, (D / G.dpr - 0.3 * v) / v);
      const T1 = walk + 0.6, T2 = T1 + 0.15, T3 = T2 + 0.45;
      const segs = [[walk, v, v], [0.6, v, 0], [T3 - T1 + 0.05, 0, 0], [1.6, 0, to.speed]];
      const tr = {
        dur: T3 + 0.5 + 2.1, segs, wipe: [T3 + 0.5, 2.1],
        pose(tt, q) {
          const gy = groundY(from, state.camX);
          if (tt < T2) return { mode: "walk", x: X, y: gy, shadow: gy };
          if (tt < T3) {
            const p = (tt - T2) / (T3 - T2);
            return { mode: "hop", x: lerp(X, X - 0.6 * u, p), y: arc(gy, gy - PERCH * u, p, 3 * u), shadow: gy };
          }
          if (!this.mounted) { this.mounted = true; burst(X, gy - 10 * u, 10, false); }
          const y = lerp(gy, groundY(to, state.camX), smooth(q));
          return { mode: "bike", x: X, y, o: land((tt - T3) / 0.25, 0.08), shadow: y };
        }
      };
      const gy = groundY(from, state.camX, X + D);
      state.props.push(parkedBike(from, state.camX + X + D, null, { pop: true, taken: () => tr.mounted }));
      puff(X + D, gy, DAY.mid);
      burst(X + D, gy - 6 * u, 12, false);
      return tr;
    },

    // Campus gives way to a lakeshore. Klui rides onto a jetty, stops, hops off, walks to the
    // moored boat and climbs in, then casts off.
    shore(from, to) {
      const u = G.u;
      const walk = Math.max(0.4, (24 * u / G.dpr - 30) / to.walk);
      const T1 = 3.2, T2 = T1 + 0.35, T3 = T2 + 0.6 + walk, T4 = T3 + 0.45;
      const segs = [[1.4, from.speed, from.speed], [1.8, from.speed, 0], [0.35, 0, 0], [0.3, 0, to.walk],
        [walk, to.walk, to.walk], [0.3, to.walk, 0], [0.45, 0, 0], [1.6, 0, to.speed]];
      const X = G.W * KLUI_X;
      const boatY = groundY(to, state.camX), deckY = boatY - 5 * u;
      const boatW = state.camX + travel(segs, T3).d * G.dpr + X;
      const tr = {
        dur: T4 + 1.6, segs, wipe: [0.2, 2],
        pose(tt, q) {
          if (tt < T1) {
            const y = lerp(groundY(from, state.camX), deckY, smooth(q));
            return { mode: "bike", x: X, y, shadow: y };
          }
          if (tt < T2) {
            if (!this.parked) { this.parked = true; state.props.push(parkedBike(to, state.camX + X, deckY)); }
            const p = (tt - T1) / (T2 - T1);
            return { mode: "hop", x: lerp(X - 0.6 * u, X, p), y: arc(deckY - PERCH * u, deckY, p, 2.5 * u) };
          }
          if (tt < T3) return { mode: "walk", x: X, y: deckY, o: land((tt - T2) / 0.2, 0.1) };
          const seat = boatY + (Math.sin(state.t * 1.9) * 0.45 - 2.7) * u;
          if (tt < T4) {
            const p = (tt - T3) / (T4 - T3);
            return { mode: "hop", x: lerp(X, X + u, p), y: arc(deckY, seat, p, 3 * u) };
          }
          this.boarded = true;
          return { mode: "boat", x: X, y: boatY, o: land((tt - T4) / 0.3, 0.06) };
        }
      };
      state.props.push(dock(to, boatW + 15 * u, deckY, boatY), mooredBoat(to, boatW, boatY, () => tr.boarded));
      return tr;
    },

    // Back to the top of the loop: the pixel wipe carries the night in and the boat becomes the plane.
    warp(from, to) {
      return {
        dur: 2.4, segs: [[2.4, from.speed, to.speed]], wipe: [0, 2.4],
        pose(tt, q) {
          const X = G.W * KLUI_X;
          const y = lerp(groundY(from, state.camX), groundY(to, state.camX), smooth(clamp((q - 0.2) / 0.6, 0, 1)));
          if (!this.swapped && q >= 0.5) { this.swapped = true; burst(X, y - G.u * 6); }
          let mode = q >= 0.5 ? to.mode : from.mode;
          // Flicker between forms right after the swap, like a power-up.
          if (q >= 0.5 && q < 0.62 && Math.floor(state.t * 18) % 2) mode = from.mode;
          return { mode, x: X, y };
        }
      };
    }
  };

  // ---------- tone ----------
  function tone(scene) {
    hero.dataset.tone = scene.tone;
    document.documentElement.dataset.heroTone = scene.tone;
  }

  // ---------- frame ----------
  function begin() {
    const s = state, from = SCENES[s.idx], to = SCENES[(s.idx + 1) % SCENES.length];
    s.trans = Object.assign(TRANSITIONS[from.out](from, to), { from, to, t: 0, camX0: s.camX });
  }

  function finish() {
    const s = state, tr = s.trans;
    tone(tr.to);
    for (const L of tr.from.layers) { L.cache.clear(); L.pool.length = 0; }
    s.idx = SCENES.indexOf(tr.to);
    s.trans = null;
    s.sceneT = 0;
    s.props = s.props.filter((p) => p.scene === tr.to);
  }

  function step(dt) {
    const s = state;
    s.t += dt;
    s.sceneT += dt;
    const cur = SCENES[s.idx];
    if (!s.trans && s.sceneT >= cur.hold) begin();
    const tr = s.trans;
    if (tr) {
      tr.t += dt;
      const m = travel(tr.segs, tr.t);
      s.camX = tr.camX0 + m.d * G.dpr;
      s.speed = m.v;
      const q = (tr.t - tr.wipe[0]) / tr.wipe[1];
      if (!tr.toned && q > 0.5) { tr.toned = true; tone(tr.to); }
      if (tr.t >= tr.dur) finish();
    } else {
      s.speed = cur.speed;
      s.camX += s.speed * G.dpr * dt;
    }
    s.walkPh += (s.speed * G.dpr * dt) / (G.u * 1.15);
    s.walkAmp = lerp(s.walkAmp, clamp(s.speed / 60, 0, 1), Math.min(1, dt * 10));
    s.props = s.props.filter((p) => !p.gone());
    if (s.t > s.blinkAt) {
      s.blinkUntil = s.t + 0.12;
      s.blinkAt = s.t + 2 + Math.random() * 3.5 + (Math.random() < 0.2 ? -1.8 : 0);
    }
  }

  function draw(dt) {
    const s = state, tr = s.trans, cur = SCENES[s.idx];
    let pose;
    if (tr) {
      const q = clamp((tr.t - tr.wipe[0]) / tr.wipe[1], 0, 1);
      const dyFrom = tr.fromDy ? tr.fromDy(tr.t) : 0, dyTo = tr.toDy ? tr.toDy(tr.t) : 0;
      if (q <= 0) paintScene(ctx, tr.from, s.t, s.camX, dyFrom);
      else if (q >= 1) paintScene(ctx, tr.to, s.t, s.camX, dyTo);
      else dissolve(ctx, tr.from, tr.to, q, s.t, dyFrom, dyTo);
      prefetch(tr.to);
      pose = tr.pose(tr.t, q);
    } else {
      paintScene(ctx, cur, s.t, s.camX);
      if (s.sceneT > cur.hold - 2) prefetch(SCENES[(s.idx + 1) % SCENES.length]);
      const y = groundY(cur, s.camX);
      pose = { mode: cur.mode, x: G.W * KLUI_X, y, shadow: cur.mode === "walk" || cur.mode === "bike" ? y : undefined };
    }
    prefetch(cur);
    if (pose.shadow !== undefined) {
      const k = pose.shadowK ?? 1;
      ctx.fillStyle = `rgba(28,28,31,${0.12 * k})`;
      const w = G.u * (pose.mode === "bike" ? 20 : 11) * (0.5 + 0.5 * k);
      ctx.fillRect(Math.round(pose.x - w / 2), Math.round(pose.shadow - G.u * 0.3), Math.round(w), Math.round(G.u * 0.7));
    }
    drawParts(ctx, dt);
    if (tr && tr.under) tr.under(ctx, tr.t);
    drawMode(ctx, pose.mode, pose.x, pose.y, s.t, pose.o);
    placeBag();
    if (pose.mode === "boat") waterline(ctx, pose.x, pose.y, s.t);
    if (tr && tr.over) tr.over(ctx, tr.t);
    if (dt) emit(pose, dt, s.t);
    if (s.flash > 0) {
      s.flash -= dt;
      ctx.fillStyle = `rgba(255,248,233,${clamp(s.flash / 0.22, 0, 1) * 0.35})`;
      ctx.fillRect(0, 0, G.W, G.H);
    }
  }

  // The real button for the case sits over the canvas and follows it around, so the demo is one
  // click (or tab) away in every scene.
  const bagBtn = hero.querySelector(".hero-bag");
  let bagKey = "";
  function placeBag() {
    const b = state.bag;
    if (!bagBtn || !b) return;
    const d = G.dpr, w = Math.max(44, b.w / d), h = Math.max(44, b.h / d);
    const x = canvas.offsetLeft + (b.x + b.w / 2) / d - w / 2, y = canvas.offsetTop + (b.y + b.h / 2) / d - h / 2;
    const key = `${x.toFixed(1)},${y.toFixed(1)},${w.toFixed(1)},${h.toFixed(1)},${b.side}`;
    if (key === bagKey) return;
    bagKey = key;
    bagBtn.dataset.side = b.side;
    bagBtn.style.width = `${w}px`;
    bagBtn.style.height = `${h}px`;
    bagBtn.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    bagBtn.classList.add("is-placed");
  }

  // Lap a little water over the hull so the boat sits in the lake rather than on it.
  function waterline(g, X, Y, t) {
    g.font = G.font; g.textAlign = "center"; g.textBaseline = "middle";
    const n = Math.ceil((G.u * 26) / G.cw);
    for (let i = 0; i < n; i++) {
      const x = X - G.u * 13 + i * G.cw;
      g.fillStyle = i % 4 ? NIGHT.mid : NIGHT.ink;
      g.fillText(i % 3 === 1 ? "~" : "-", x, Y + G.u * 1.3 + Math.sin(t * 2.2 - i * 0.7) * G.u * 0.18);
    }
  }

  // ---------- loop ----------
  let raf = 0, last = 0, visible = true, ready = false;
  const reduced = () => reduceQuery.matches;
  const shouldRun = () => visible && !document.hidden && !reduced();

  function tick(now) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    step(dt);
    draw(dt);
    if (!ready) { ready = true; hero.classList.add("is-live"); }
    if (shouldRun()) raf = requestAnimationFrame(tick);
  }

  function still() {
    draw(0);
    if (!ready) { ready = true; hero.classList.add("is-live"); }
  }

  function sync() {
    if (shouldRun()) {
      if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
    } else {
      cancelAnimationFrame(raf);
      raf = 0;
      if (!ready || reduced()) still();
    }
  }

  function setup() {
    const before = G.dpr;
    measure();
    state.camX *= G.dpr / before;
    for (const scene of SCENES) {
      for (const L of scene.layers) placeLayer(L);
      if (scene.clouds) makeClouds(scene);
      if (scene.stars) makeStars(scene);
      scene.setup();
    }
    if (state.trans) finish();
    state.props = [];
    parts.length = 0;
    setupMask();
  }

  setup();
  tone(SCENES[0]);
  if (reduced()) still();
  sync();

  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      if (Math.round(rect.width * dpr) === G.W && Math.round(rect.height * dpr) === G.H) return;
      setup();
      if (!raf) still();
    }, 120);
  }).observe(canvas);
  new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; sync(); }).observe(hero);
  document.addEventListener("visibilitychange", sync);
  reduceQuery.addEventListener?.("change", sync);
})();

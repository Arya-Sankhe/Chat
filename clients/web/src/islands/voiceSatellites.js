// The small orbs around voice mode's big orb. Each phase has its own motion, and the motion
// blends smoothly when the phase changes:
// - thinking: each orb swings round on its own tilted orbit, like electrons, trailing a comet tail;
//   orbs passing behind the big orb dim as if hidden by it.
// - listening: an even ring that revolves calmly and breathes with the user's voice.
// - speaking: the ring turns slowly while Klui's voice runs round it as a wave, and loud
//   moments throw off small echoes that drift outward.
// - paused (mic off): a slow, dim drift.

const COUNT = 5;
const SIZES = [1, 0.72, 0.86, 0.62, 0.78];
const TRAIL_POINTS = 26;
// The canvas overhangs the orb button by this much on every side, so tails and echoes have room.
export const SATELLITE_OVERHANG = 0.14;

const MODES = {
  thinking: { speed: 2.1, trail: 1, tilt: 1, breathe: 0, wave: 0, alpha: 1, reach: 1 },
  listening: { speed: 0.55, trail: 0.12, tilt: 0, breathe: 1, wave: 0, alpha: 0.9, reach: 1 },
  speaking: { speed: 0.3, trail: 0.2, tilt: 0, breathe: 0, wave: 1, alpha: 1, reach: 1.02 },
  paused: { speed: 0.12, trail: 0, tilt: 0, breathe: 0, wave: 0, alpha: 0.35, reach: 0.94 },
  idle: { speed: 0.4, trail: 0, tilt: 0, breathe: 0.4, wave: 0, alpha: 0.8, reach: 1 }
};

// Tilted planes for the thinking orbits: [inclination, node angle, speed factor].
const PLANES = [
  [1.15, 0.2, 1],
  [1.05, 2.3, 1.22],
  [1.25, 4.1, 0.86],
  [0.95, 1.2, 1.1],
  [1.2, 3.3, 0.94]
];

const rgba = (color, alpha) => `rgba(${color[0] | 0}, ${color[1] | 0}, ${color[2] | 0}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
const lerp = (from, to, amount) => from + (to - from) * amount;

export function createSatellites(canvas, { calm = false } = {}) {
  const g = canvas.getContext("2d");
  let raf = 0;
  let last = 0;
  let mode = "idle";
  let target = 0;
  let level = 0;
  const mix = { ...MODES.idle };
  let palette = { a: [255, 168, 108], b: [255, 212, 168], glow: [255, 194, 148] };
  let goalPalette = palette;
  const sats = Array.from({ length: COUNT }, (_, i) => ({
    angle: (i / COUNT) * Math.PI * 2,
    orbit: Math.random() * Math.PI * 2,
    trail: [],
    x: 0,
    y: 0
  }));
  // Recent levels, so the speaking wave reaches each orb a little later than the one before it.
  const levels = new Float32Array(48);
  let levelAt = 0;
  let echoes = [];
  let echoCooldown = 0;
  let ring = 0;

  function delayed(frames) {
    return levels[(levelAt - frames + levels.length * 4) % levels.length];
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    const goal = MODES[mode] || MODES.idle;
    const blend = Math.min(1, dt * 2.6);
    for (const key of Object.keys(goal)) mix[key] += (goal[key] - mix[key]) * blend;
    palette = Object.fromEntries(Object.entries(palette).map(([key, color]) => [key, color.map((value, index) => lerp(value, goalPalette[key][index], Math.min(1, dt * 2)))]));
    level += (target - level) * (target > level ? 0.35 : 0.08);
    levelAt = (levelAt + 1) % levels.length;
    levels[levelAt] = level;

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

    const orbSize = Math.min(width, height) / (1 + SATELLITE_OVERHANG * 2);
    const cx = width / 2;
    const cy = height / 2;
    const base = orbSize * 0.43 * mix.reach;
    const hide = orbSize * 0.31; // the big orb's radius, for dimming orbs that pass behind it
    const dot = Math.max(2.4, orbSize * 0.0105);
    const motion = calm ? 0 : 1;
    ring += dt * mix.speed * motion;

    // Speaking: loud moments throw an echo off every orb.
    echoCooldown -= dt;
    if (motion && mix.wave > 0.5 && level > 0.42 && echoCooldown <= 0) {
      echoCooldown = 0.34;
      for (const sat of sats) echoes.push({ x: sat.x, y: sat.y, dx: sat.x - cx, dy: sat.y - cy, life: 1, size: dot * 0.8 });
    }

    sats.forEach((sat, i) => {
      const plane = PLANES[i];
      sat.orbit += dt * mix.speed * plane[2] * motion;
      // Flat ring position: even spacing, turning together.
      const even = sat.angle + ring;
      const lag = delayed(i * 5);
      const breathe = mix.breathe * level * 0.12;
      const wave = mix.wave * (lag * 0.2 + 0.03 * Math.sin(now / 260 + i * 1.3) * Math.min(1, level * 3));
      const r = base * (1 + breathe + wave);
      const flatX = Math.cos(even) * r;
      const flatY = Math.sin(even) * r;
      // Tilted orbit position: a circle on its own plane, seen at an angle.
      const [inclination, node] = plane;
      const ox = Math.cos(sat.orbit) * base;
      const oy = Math.sin(sat.orbit) * base * Math.cos(inclination);
      const oz = Math.sin(sat.orbit) * base * Math.sin(inclination);
      const tiltX = ox * Math.cos(node) - oy * Math.sin(node);
      const tiltY = ox * Math.sin(node) + oy * Math.cos(node);
      const x = cx + lerp(flatX, tiltX, mix.tilt);
      const y = cy + lerp(flatY, tiltY, mix.tilt);
      const z = lerp(0, oz / base, mix.tilt); // -1 (behind) .. 1 (in front)
      sat.x = x;
      sat.y = y;
      sat.trail.unshift({ x, y, z });
      if (sat.trail.length > TRAIL_POINTS) sat.trail.length = TRAIL_POINTS;

      const size = dot * SIZES[i] * (1 + 0.18 * z + mix.wave * lag * 0.5 + mix.breathe * level * 0.25);
      const cover = (point) => {
        const behind = point.z < 0 && Math.hypot(point.x - cx, point.y - cy) < hide;
        return behind ? 0.12 : 1;
      };
      const depth = (point) => 0.72 + 0.28 * point.z;

      // Comet tail: tapering and fading toward the end.
      const tail = Math.round(TRAIL_POINTS * mix.trail);
      if (tail > 1) {
        g.lineCap = "round";
        for (let k = 1; k < Math.min(tail, sat.trail.length); k += 1) {
          const from = sat.trail[k - 1];
          const to = sat.trail[k];
          const fade = 1 - k / tail;
          g.beginPath();
          g.moveTo(from.x, from.y);
          g.lineTo(to.x, to.y);
          g.strokeStyle = rgba(k < tail * 0.3 ? palette.glow : palette.a, fade * 0.55 * mix.trail * mix.alpha * cover(to) * depth(to));
          g.lineWidth = size * 1.5 * fade + 0.4;
          g.stroke();
        }
      }

      const alpha = mix.alpha * cover(sat.trail[0]) * depth(sat.trail[0]) * (0.75 + 0.25 * Math.sin(now / 420 + i * 1.7) * (1 - mix.wave));
      const halo = g.createRadialGradient(x, y, 0, x, y, size * 3.2);
      halo.addColorStop(0, rgba(i % 2 ? palette.a : palette.glow, alpha * 0.55));
      halo.addColorStop(1, rgba(palette.glow, 0));
      g.fillStyle = halo;
      g.fillRect(x - size * 3.2, y - size * 3.2, size * 6.4, size * 6.4);
      g.beginPath();
      g.arc(x, y, size, 0, Math.PI * 2);
      g.fillStyle = rgba([255, 255, 255], alpha);
      g.fill();
    });

    // Echoes drift outward, grow faint, and are gone.
    echoes = echoes.filter((echo) => (echo.life -= dt * 1.5) > 0);
    for (const echo of echoes) {
      const push = (1 - echo.life) * 0.45;
      const x = echo.x + echo.dx * push;
      const y = echo.y + echo.dy * push;
      g.beginPath();
      g.arc(x, y, echo.size * (0.6 + echo.life * 0.5), 0, Math.PI * 2);
      g.fillStyle = rgba(palette.glow, echo.life * 0.7);
      g.fill();
    }
  }

  return {
    setMode(next) { mode = MODES[next] ? next : "idle"; },
    setLevel(value) { target = Math.max(0, Math.min(1, Number(value) || 0)); },
    setPalette(colors, { instant = false } = {}) {
      if (!colors) return;
      goalPalette = { a: [...colors.a], b: [...colors.b], glow: [...colors.glow] };
      if (instant) palette = { a: [...colors.a], b: [...colors.b], glow: [...colors.glow] };
    },
    start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } },
    stop() { cancelAnimationFrame(raf); raf = 0; }
  };
}

// Excalidraw's dark theme draws the board through `invert(93%) hue-rotate(180deg)`, so a stored
// colour is not the colour the student sees (dark brown shows as tan, light blue as navy).
// Klui talks in colours as seen: these convert between the two for a theme.
export const DARK_FILTER = "invert(93%) hue-rotate(180deg)";

const INVERT = 0.93;
// CSS hue-rotate(180deg) as a matrix (Filter Effects spec, cos = -1, sin = 0).
const HUE = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856]
];
const HUE_INVERSE = inverse3(HUE);

function inverse3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]
  ];
}

const clamp = (value) => Math.min(1, Math.max(0, value));
const multiply = (m, v) => m.map((row) => clamp(row[0] * v[0] + row[1] * v[1] + row[2] * v[2]));

function parse(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const format = (rgb) => `#${rgb.map((value) => Math.round(clamp(value) * 255).toString(16).padStart(2, "0")).join("")}`;

/** One pixel through the dark filter, channels 0–1. */
export function darkPixel(rgb) {
  return multiply(HUE, rgb.map((value) => INVERT + value * (1 - 2 * INVERT)));
}

/** The colour the student sees for a stored colour. Anything that isn't #rrggbb passes through. */
export function seenColor(stored, theme) {
  const rgb = theme === "dark" ? parse(stored) : null;
  return rgb ? format(darkPixel(rgb)) : stored;
}

// OKLab, so "closest colour" means closest to the eye. Lightness counts half: out of reach, a red
// should stay red and a bit darker rather than turn pale pink.
function oklab([r, g, b]) {
  const linear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

const distance = (a, b) => (0.5 * (a[0] - b[0])) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const cache = new Map();

/**
 * The colour to store so the student sees `seen`, or as close to it as the dark filter can show
 * (it can't reach pure black or white, bright yellows or the most saturated reds).
 */
export function storedColor(seen, theme) {
  const rgb = theme === "dark" ? parse(seen) : null;
  if (!rgb) return seen;
  const key = seen.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const target = oklab(rgb);
  const cost = (stored) => distance(oklab(darkPixel(stored.map((value) => value / 255))), target);
  // Start from the exact inverse, then search the stored colours around the best so far.
  let best = multiply(HUE_INVERSE, rgb).map((value) => Math.round(clamp((INVERT - value) / (2 * INVERT - 1)) * 255));
  let bestCost = cost(best);
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const value = cost([r, g, b]);
    if (value < bestCost) [best, bestCost] = [[r, g, b], value];
  }
  for (const step of [8, 4, 2, 1]) {
    for (let improved = true; improved;) {
      improved = false;
      for (const dr of [-step, 0, step]) for (const dg of [-step, 0, step]) for (const db of [-step, 0, step]) {
        const next = [best[0] + dr, best[1] + dg, best[2] + db];
        if (next.some((value) => value < 0 || value > 255)) continue;
        const value = cost(next);
        if (value < bestCost - 1e-12) [best, bestCost, improved] = [next, value, true];
      }
    }
  }
  const out = format(best.map((value) => value / 255));
  cache.set(key, out);
  return out;
}

/** A proposal with Klui's colours (chosen as seen) turned into the colours to store. */
export function storedProposal(proposal, theme) {
  if (theme !== "dark") return proposal;
  const recolour = (item, keys) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, keys.includes(key) ? storedColor(value, theme) : value]));
  return {
    ...proposal,
    ops: (proposal.ops || []).map((op) => recolour(op, ["color", "fill"])),
    ...(proposal.edits ? { edits: proposal.edits.map((edit) => recolour(edit, ["strokeColor", "backgroundColor"])) } : {})
  };
}

/** Puts RGBA pixels (canvas ImageData.data) through the dark filter in place. */
export function darkPixels(data) {
  const invert = Array.from({ length: 256 }, (_, value) => INVERT + (value / 255) * (1 - 2 * INVERT));
  const [[a, b, c], [d, e, f], [g, h, i]] = HUE;
  for (let at = 0; at < data.length; at += 4) {
    const r = invert[data[at]];
    const gr = invert[data[at + 1]];
    const bl = invert[data[at + 2]];
    data[at] = (a * r + b * gr + c * bl) * 255;
    data[at + 1] = (d * r + e * gr + f * bl) * 255;
    data[at + 2] = (g * r + h * gr + i * bl) * 255;
  }
  return data;
}

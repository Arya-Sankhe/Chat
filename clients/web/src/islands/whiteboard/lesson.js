// The tutor's lesson board, shared by the browser and the server (no DOM, no Node APIs).
// Before a call, the lesson planner sketches each step's board as a few blocks (a note, a formula,
// a flow, a tree, a table, a timeline, a comparison, a plot or a labelled sketch). The server
// cleans them with cleanLessonBoard(); the browser lays them out with layoutLesson() and reveals
// them piece by piece as the tutor speaks. During the call the tutor drives the board with short
// cues in its reply ([show key], [point key], [mark key], [write: …], [draw: …], [ask to draw]),
// read by parseBoardCue(). Nothing here sizes text exactly: widths are estimates for the
// handwritten font, generous enough that labels never spill out of their boxes.

import { KLUI_INK, proposalToSkeletons, validateProposal } from "./schema.js";

export const BOARD_LIMITS = Object.freeze({
  steps: 7,
  blocksPerStep: 4,
  keyChars: 24,
  text: 160,
  label: 48,
  nodes: 6,
  children: 4,
  grandchildren: 3,
  columns: 4,
  rows: 6,
  events: 6,
  points: 5,
  curves: 3,
  marks: 4,
  sketchOps: 16,
  extras: 12
});

export const BLOCK_TYPES = Object.freeze(["note", "formula", "flow", "tree", "table", "timeline", "compare", "plot", "sketch"]);

// Board geometry, in scene units. Each step gets a column for the tutor and, beside it, a space
// for the student; steps run left to right so the board reads like a long classroom wall.
export const COLUMN = 960;
const SPACE_GAP = 80;
const SPACE_WIDTH = 520;
const STEP_GAP = 220;
export const STEP_STRIDE = COLUMN + SPACE_GAP + SPACE_WIDTH + STEP_GAP;
const BLOCKS_TOP = 110;
const BLOCK_GAP = 64;
const SPACE_MIN_HEIGHT = 560;
export const MARK_INK = "#e8590c";
const MUTED = "#868e96";
const CURVE_INKS = [KLUI_INK, MARK_INK, "#2f9e44"];
const FONT = 5; // Excalifont, the handwritten face

/* ---------- Cleaning ---------- */

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);

export function cleanText(value, max = BOARD_LIMITS.text) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(CONTROL, "").replace(/[[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** A short kebab-case key, unique among `used` (a numbered suffix when taken). */
export function cleanKey(value, used, fallback = "part") {
  const base = String(value ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, BOARD_LIMITS.keyChars)
    || String(fallback).slice(0, BOARD_LIMITS.keyChars);
  let key = base;
  for (let n = 2; used.has(key); n += 1) key = `${base.slice(0, BOARD_LIMITS.keyChars - String(n).length - 1)}-${n}`;
  used.add(key);
  return key;
}

const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);

function cleanAxis(value, fallbackLabel) {
  const axis = isObject(value) ? value : {};
  let min = number(axis.min);
  let max = number(axis.max);
  if (min === null || max === null || !(max > min) || max - min > 1e9) {
    min = 0;
    max = 10;
  }
  return { label: cleanText(axis.label, 32) || fallbackLabel, min, max };
}

/**
 * One block, cleaned; null when nothing usable is left. Keys are made unique against `used`
 * (block keys and every part key share one namespace, so a cue names exactly one thing).
 */
export function cleanLessonBlock(value, used = new Set()) {
  if (!isObject(value) || !BLOCK_TYPES.includes(value.type)) return null;
  const type = value.type;
  // Keys are taken only once the block is known to be usable, so a dropped block frees its names.
  const local = new Set(used);
  const key = cleanKey(value.key, local, type);
  const part = (raw, fallback) => cleanKey(raw, local, `${key}-${fallback}`);
  let block = null;
  if (type === "note") {
    const text = cleanText(value.text);
    if (text) block = { key, type, text };
  } else if (type === "formula") {
    const text = cleanText(value.text, 80);
    if (text) block = { key, type, text, ...(cleanText(value.caption, 90) ? { caption: cleanText(value.caption, 90) } : {}) };
  } else if (type === "flow") {
    const nodes = list(value.nodes).map((node, index) => ({ raw: node, index }))
      .filter(({ raw }) => cleanText(isObject(raw) ? raw.text : raw, BOARD_LIMITS.label))
      .slice(0, BOARD_LIMITS.nodes)
      .map(({ raw, index }) => ({ key: part(isObject(raw) ? raw.key : "", `n${index + 1}`), text: cleanText(isObject(raw) ? raw.text : raw, BOARD_LIMITS.label) }));
    if (nodes.length >= 2) {
      const cycle = value.cycle === true && nodes.length >= 3;
      const labels = list(value.labels).slice(0, cycle ? nodes.length : nodes.length - 1).map((label) => cleanText(label, 24));
      block = {
        key, type, nodes, cycle,
        direction: cycle ? "around" : value.direction === "down" ? "down" : "right",
        ...(labels.some(Boolean) ? { labels } : {}),
        ...(cleanText(value.title, 60) ? { title: cleanText(value.title, 60) } : {})
      };
    }
  } else if (type === "tree") {
    const rootText = cleanText(isObject(value.root) ? value.root.text : value.root, BOARD_LIMITS.label);
    if (rootText) {
      const root = { key: part(value.root?.key, "root"), text: rootText };
      const children = list(value.children).filter((child) => cleanText(isObject(child) ? child.text : child, BOARD_LIMITS.label)).slice(0, BOARD_LIMITS.children).map((child, index) => ({
        key: part(child?.key, `c${index + 1}`),
        text: cleanText(isObject(child) ? child.text : child, BOARD_LIMITS.label),
        children: list(child?.children).filter((leaf) => cleanText(isObject(leaf) ? leaf.text : leaf, BOARD_LIMITS.label)).slice(0, BOARD_LIMITS.grandchildren)
          .map((leaf, leafIndex) => ({ key: part(leaf?.key, `c${index + 1}-${leafIndex + 1}`), text: cleanText(isObject(leaf) ? leaf.text : leaf, BOARD_LIMITS.label) }))
      }));
      if (children.length) block = { key, type, root, children };
    }
  } else if (type === "table") {
    const columns = list(value.columns).map((column) => cleanText(column, 32)).slice(0, BOARD_LIMITS.columns);
    const width = columns.length;
    const rows = list(value.rows).filter(Array.isArray).slice(0, BOARD_LIMITS.rows)
      .map((row) => Array.from({ length: width }, (_, index) => cleanText(row[index], 60)))
      .filter((row) => row.some(Boolean));
    if (width >= 2 && columns.some(Boolean) && rows.length) {
      block = { key, type, columns, rows, rowKeys: rows.map((_, index) => part(`${key}-r${index + 1}`, `r${index + 1}`)) };
    }
  } else if (type === "timeline") {
    const events = list(value.events).filter((event) => isObject(event) && (cleanText(event.label, 24) || cleanText(event.text, 60))).slice(0, BOARD_LIMITS.events)
      .map((event, index) => ({ key: part(event.key, `e${index + 1}`), label: cleanText(event.label, 24), text: cleanText(event.text, 60) }));
    if (events.length >= 2) block = { key, type, events };
  } else if (type === "compare") {
    const side = (raw, name) => {
      if (!isObject(raw)) return null;
      const title = cleanText(raw.title, 40);
      const points = list(raw.points).map((point) => cleanText(point, 90)).filter(Boolean).slice(0, BOARD_LIMITS.points);
      return title || points.length ? { key: part(raw.key, name), title: title || name, points } : null;
    };
    const left = side(value.left, "left");
    const right = side(value.right, "right");
    if (left && right) block = { key, type, left, right };
  } else if (type === "plot") {
    const x = cleanAxis(value.x, "x");
    const y = cleanAxis(value.y, "y");
    const curves = list(value.curves).filter(isObject).slice(0, BOARD_LIMITS.curves).map((curve, index) => {
      const fn = typeof curve.fn === "string" ? curve.fn.slice(0, 120) : "";
      const compiled = fn ? compileExpression(fn) : null;
      const points = list(curve.points).filter((point) => Array.isArray(point) && number(point[0]) !== null && number(point[1]) !== null)
        .slice(0, 64).map(([px, py]) => [number(px), number(py)]);
      if (!compiled && points.length < 2) return null;
      return { key: part(curve.key, `curve${index + 1}`), label: cleanText(curve.label, 32), ...(compiled ? { fn } : { points }) };
    }).filter(Boolean);
    const marks = list(value.marks).filter((mark) => isObject(mark) && number(mark.x) !== null && number(mark.y) !== null).slice(0, BOARD_LIMITS.marks)
      .map((mark, index) => ({ key: part(mark.key, `pt${index + 1}`), x: number(mark.x), y: number(mark.y), label: cleanText(mark.label, 32) }));
    if (curves.length || marks.length) block = { key, type, x, y, curves, marks, ...(cleanText(value.title, 60) ? { title: cleanText(value.title, 60) } : {}) };
  } else if (type === "sketch") {
    const ops = list(value.ops).slice(0, BOARD_LIMITS.sketchOps);
    // Sketch parts are named in the shared namespace; arrows follow their shapes' new names.
    const renamed = new Map();
    const named = ops.filter(isObject).map((op, index) => {
      if (op.op === "connect") return { ...op };
      const next = part(op.key, `p${index + 1}`);
      if (typeof op.key === "string") renamed.set(op.key, next);
      return { ...op, key: next };
    }).map((op) => (op.op === "connect" ? { ...op, from: renamed.get(op.from) ?? op.from, to: renamed.get(op.to) ?? op.to } : op));
    try {
      const proposal = validateProposal({ summary: "", ops: named }, { overlap: true });
      block = { key, type, ops: proposal.ops, ...(cleanText(value.title, 60) ? { title: cleanText(value.title, 60) } : {}) };
    } catch {
      block = null;
    }
  }
  if (!block) return null;
  for (const name of local) used.add(name);
  return block;
}

/**
 * The planner's board for a lesson of `stepCount` steps: { steps: [{ blocks }] }. Unusable blocks
 * are dropped one by one; a board with nothing usable left is null, and the call runs voice-only.
 */
export function cleanLessonBoard(value, stepCount) {
  const raw = list(isObject(value) ? value.steps : value);
  const used = new Set(Array.from({ length: BOARD_LIMITS.steps }, (_, index) => [`step-${index + 1}`, `space-${index + 1}`]).flat());
  const steps = Array.from({ length: Math.min(stepCount, BOARD_LIMITS.steps) }, (_, index) => ({
    blocks: list(raw[index]?.blocks).map((block) => cleanLessonBlock(block, used)).filter(Boolean).slice(0, BOARD_LIMITS.blocksPerStep)
  }));
  return steps.some((step) => step.blocks.length) ? { steps } : null;
}

/** Every name a cue may use for a block: the block's own key and its parts'. */
export function blockNames(block) {
  const names = [block.key];
  if (block.type === "flow") names.push(...block.nodes.map((node) => node.key));
  if (block.type === "tree") names.push(block.root.key, ...block.children.flatMap((child) => [child.key, ...child.children.map((leaf) => leaf.key)]));
  if (block.type === "table") names.push(...block.rowKeys);
  if (block.type === "timeline") names.push(...block.events.map((event) => event.key));
  if (block.type === "compare") names.push(block.left.key, block.right.key);
  if (block.type === "plot") names.push(...block.curves.map((curve) => curve.key), ...block.marks.map((mark) => mark.key));
  if (block.type === "sketch") names.push(...block.ops.filter((op) => op.key && op.op !== "connect").map((op) => op.key));
  return names;
}

/** All names on a board, for checking cues and choosing fresh keys. */
export function boardNames(board) {
  const names = new Set();
  (board?.steps || []).forEach((step, index) => {
    names.add(`step-${index + 1}`);
    names.add(`space-${index + 1}`);
    for (const block of step.blocks) for (const name of blockNames(block)) names.add(name);
  });
  return names;
}

const quote = (text) => `"${String(text).slice(0, 60)}"`;

/** One line per block for the tutor's prompt: its key, kind, and what its parts say. */
export function describeBlock(block) {
  const items = (pairs) => pairs.map(([name, text]) => `${name} ${quote(text)}`).join(", ");
  if (block.type === "note") return `${block.key} (note): ${quote(block.text)}`;
  if (block.type === "formula") return `${block.key} (formula): ${quote(block.text)}${block.caption ? ` with caption ${quote(block.caption)}` : ""}`;
  if (block.type === "flow") return `${block.key} (${block.cycle ? "cycle" : "flow"}): ${items(block.nodes.map((node) => [node.key, node.text]))}`;
  if (block.type === "tree") return `${block.key} (tree): root ${block.root.key} ${quote(block.root.text)}; ${block.children.map((child) => `${child.key} ${quote(child.text)}${child.children.length ? ` [${items(child.children.map((leaf) => [leaf.key, leaf.text]))}]` : ""}`).join("; ")}`;
  if (block.type === "table") return `${block.key} (table, columns ${block.columns.map(quote).join(", ")}): ${block.rows.map((row, index) => `${block.rowKeys[index]} ${quote(row.filter(Boolean).join(" | "))}`).join(", ")}`;
  if (block.type === "timeline") return `${block.key} (timeline): ${items(block.events.map((event) => [event.key, [event.label, event.text].filter(Boolean).join(": ")]))}`;
  if (block.type === "compare") return `${block.key} (comparison): ${block.left.key} ${quote(block.left.title)} vs ${block.right.key} ${quote(block.right.title)}`;
  if (block.type === "plot") return `${block.key} (graph of ${block.y.label} against ${block.x.label}): ${items([...block.curves.map((curve) => [curve.key, curve.label || curve.fn || "curve"]), ...block.marks.map((mark) => [mark.key, mark.label || `point (${mark.x}, ${mark.y})`])])}`;
  if (block.type === "sketch") return `${block.key} (labelled sketch${block.title ? ` ${quote(block.title)}` : ""}): ${items(block.ops.filter((op) => op.key && op.op !== "connect").map((op) => [op.key, op.text || op.labels?.filter(Boolean).join(", ") || op.shape || op.op]))}`;
  return block.key;
}

/* ---------- Cues ---------- */

const CUE_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Reads the inside of one bracketed tag from the tutor's reply. Returns { op, key } for show,
 * point and mark, { op: "write" | "draw", text }, { op: "ask" }, or null for anything else.
 */
export function parseBoardCue(inner) {
  const tag = String(inner ?? "").trim();
  const simple = tag.match(/^(show|point|mark|circle|highlight)\s*:?\s+([\w-]+)$/i);
  if (simple) {
    const key = simple[2].toLowerCase();
    if (!CUE_KEY.test(key)) return null;
    const op = { circle: "mark", highlight: "point" }[simple[1].toLowerCase()] || simple[1].toLowerCase();
    return { op, key };
  }
  const free = tag.match(/^(write|draw)\s*:\s*(.+)$/i);
  if (free) {
    const text = cleanText(free[2], free[1].toLowerCase() === "write" ? 90 : 200);
    return text ? { op: free[1].toLowerCase(), text } : null;
  }
  if (/^ask\s+(?:to\s+|them\s+to\s+|the\s+student\s+to\s+)?draw$/i.test(tag)) return { op: "ask" };
  return null;
}

/* ---------- Plot expressions ---------- */

const FUNCTIONS = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs };

/**
 * A safe arithmetic expression in x (numbers, x, pi, e, + - * / ^, brackets, and a few functions)
 * compiled to a plain function. Null when it doesn't parse. Never evaluates code.
 */
export function compileExpression(source) {
  const tokens = String(source).toLowerCase().replace(/\*\*/g, "^").match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z]+|[-+*/^()]|\S/g);
  if (!tokens || tokens.length > 120) return null;
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const fail = () => { throw new Error("bad expression"); };
  // Precedence climbing: sums, products (with implicit multiplication), unary minus, powers.
  function sum() {
    let left = product();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const right = product();
      const a = left;
      left = op === "+" ? (x) => a(x) + right(x) : (x) => a(x) - right(x);
    }
    return left;
  }
  function product() {
    let left = unary();
    for (;;) {
      const token = peek();
      if (token === "*" || token === "/") {
        next();
        const right = unary();
        const a = left;
        left = token === "*" ? (x) => a(x) * right(x) : (x) => a(x) / right(x);
      } else if (token !== undefined && (token === "(" || /^[a-z\d.]/.test(token))) {
        const right = unary();
        const a = left;
        left = (x) => a(x) * right(x);
      } else return left;
    }
  }
  function unary() {
    if (peek() === "-") { next(); const inner = unary(); return (x) => -inner(x); }
    if (peek() === "+") { next(); return unary(); }
    return power();
  }
  function power() {
    const base = atom();
    if (peek() !== "^") return base;
    next();
    const exponent = unary();
    return (x) => base(x) ** exponent(x);
  }
  function atom() {
    const token = next();
    if (token === undefined) fail();
    if (token === "(") {
      const inner = sum();
      if (next() !== ")") fail();
      return inner;
    }
    if (/^\d*\.?\d+(?:e[+-]?\d+)?$/.test(token)) {
      const value = Number(token);
      return () => value;
    }
    if (token === "x") return (x) => x;
    if (token === "pi") return () => Math.PI;
    if (token === "e") return () => Math.E;
    if (Object.hasOwn(FUNCTIONS, token)) {
      const fn = FUNCTIONS[token];
      const arg = atom();
      return (x) => fn(arg(x));
    }
    return fail();
  }
  try {
    const fn = sum();
    if (at !== tokens.length) return null;
    return fn;
  } catch {
    return null;
  }
}

/* ---------- Layout ---------- */

// Estimated width of handwritten text: about 0.56 em per character.
const charWidth = (size) => size * 0.56;
const textWidth = (text, size) => Math.max(...String(text).split("\n").map((line) => line.length), 1) * charWidth(size);

/** Wraps text to lines of at most `chars` characters, breaking at spaces. */
export function wrapText(text, chars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= chars) line += ` ${word}`;
    else { lines.push(line); line = word; }
    while (line.length > chars) { lines.push(line.slice(0, chars)); line = line.slice(chars); }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

const lineCount = (text) => String(text).split("\n").length;

/**
 * A block laid out at (x, y): { key, type, height, width, pieces }. Each piece is a group of
 * element skeletons revealed together: `part` names what it shows (the block key for its frame),
 * `base` pieces come with any part of the block, and `needs` pieces (arrows, connectors) appear
 * once every part they join is on the board.
 */
export function layoutBlock(block, x, y, idPrefix) {
  let count = 0;
  const id = () => `${idPrefix}-${block.key}-${count++}`.slice(0, 64);
  const named = (name, skeleton) => ({ id: id(), roughness: 1, strokeWidth: 2, strokeColor: KLUI_INK, ...skeleton, customData: { klui: true, name } });
  const text = (name, value, at, size = 20, extra = {}) => named(name, { type: "text", x: at.x, y: at.y, text: value, fontSize: size, fontFamily: FONT, ...extra });
  const box = (name, at, width, height, label, extra = {}) => named(name, {
    type: extra.shape || "rectangle", x: at.x, y: at.y, width, height, backgroundColor: extra.fill || "transparent", fillStyle: extra.fill ? "solid" : "hachure",
    ...(extra.shape === "ellipse" ? {} : { roundness: { type: 3 } }),
    ...(label ? { label: { text: label, fontSize: extra.size || 20, fontFamily: FONT, strokeColor: extra.ink || KLUI_INK } } : {}),
    ...(extra.ink ? { strokeColor: extra.ink } : {})
  });
  const line = (name, points, extra = {}) => {
    const [ox, oy] = points[0];
    return named(name, { type: extra.arrow ? "arrow" : "line", x: ox, y: oy, points: points.map(([px, py]) => [px - ox, py - oy]), ...(extra.arrow ? {} : { endArrowhead: null }), ...(extra.smooth ? { roundness: { type: 2 } } : {}), ...(extra.ink ? { strokeColor: extra.ink } : {}), ...(extra.dashed ? { strokeStyle: "dashed" } : {}), ...(extra.width ? { strokeWidth: extra.width } : {}) });
  };
  const pieces = [];
  const add = (part, skeletons, extra = {}) => pieces.push({ part, skeletons: [].concat(skeletons), ...extra });
  let width = COLUMN;
  let height = 0;
  let top = y;
  if (block.title) {
    add(block.key, text(block.key, block.title, { x, y }, 24, { strokeColor: MUTED }), { base: true });
    top += 42;
  }

  if (block.type === "note") {
    const wrapped = wrapText(block.text, 60);
    add(block.key, [text(block.key, "•", { x, y: top }, 26), text(block.key, wrapped, { x: x + 30, y: top }, 26)]);
    width = Math.min(COLUMN, 30 + textWidth(wrapped, 26));
    height = top - y + lineCount(wrapped) * 26 * 1.25;
  } else if (block.type === "formula") {
    const size = 34;
    const boxWidth = Math.min(COLUMN, textWidth(block.text, size) + 72);
    const parts = [box(block.key, { x, y: top }, boxWidth, 84, block.text, { fill: "#fff9db", size })];
    let bottom = top + 84;
    if (block.caption) {
      parts.push(text(block.key, wrapText(block.caption, 70), { x: x + 6, y: bottom + 12 }, 18, { strokeColor: MUTED }));
      bottom += 12 + lineCount(wrapText(block.caption, 70)) * 18 * 1.25;
    }
    add(block.key, parts);
    width = boxWidth;
    height = bottom - y;
  } else if (block.type === "flow") {
    const n = block.nodes.length;
    const centres = new Map();
    let nodeWidth = 190;
    let nodeHeight = 86;
    if (block.direction === "right") {
      // Labelled arrows get gaps wide enough for their words, while boxes keep at least 130.
      const widest = Math.max(0, ...(block.labels || []).map((label) => textWidth(label, 16) + 24));
      const gap = Math.min(Math.max(70, widest), n > 1 ? (COLUMN - 130 * n) / (n - 1) : 70);
      nodeWidth = Math.min(200, (COLUMN - gap * (n - 1)) / n);
      block.nodes.forEach((node, index) => centres.set(node.key, { x: x + index * (nodeWidth + gap) + nodeWidth / 2, y: top + nodeHeight / 2 }));
      width = n * nodeWidth + (n - 1) * gap;
      height = top - y + nodeHeight + (block.labels ? 30 : 0);
    } else if (block.direction === "down") {
      nodeWidth = 300;
      nodeHeight = 72;
      const gap = 56;
      block.nodes.forEach((node, index) => centres.set(node.key, { x: x + nodeWidth / 2, y: top + index * (nodeHeight + gap) + nodeHeight / 2 }));
      width = nodeWidth + (block.labels ? 200 : 0);
      height = top - y + n * nodeHeight + (n - 1) * gap;
    } else {
      // A cycle: nodes evenly round a circle, starting at the top and going clockwise.
      nodeWidth = 180;
      nodeHeight = 76;
      const radius = n <= 3 ? 190 : n === 4 ? 220 : 250;
      const cx = x + radius + nodeWidth / 2;
      const cy = top + radius * 0.82 + nodeHeight / 2;
      block.nodes.forEach((node, index) => {
        const angle = -Math.PI / 2 + (index / n) * Math.PI * 2;
        centres.set(node.key, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius * 0.82 });
      });
      width = radius * 2 + nodeWidth;
      height = top - y + radius * 1.64 + nodeHeight;
    }
    for (const node of block.nodes) {
      const c = centres.get(node.key);
      add(node.key, box(node.key, { x: c.x - nodeWidth / 2, y: c.y - nodeHeight / 2 }, nodeWidth, nodeHeight, wrapText(node.text, Math.max(8, Math.floor((nodeWidth - 24) / charWidth(20))))));
    }
    const edges = block.nodes.slice(0, block.cycle ? n : n - 1).map((node, index) => [node, block.nodes[(index + 1) % n], block.labels?.[index] || ""]);
    for (const [from, to, label] of edges) {
      const a = edgePoint(centres.get(from.key), centres.get(to.key), nodeWidth, nodeHeight);
      const b = edgePoint(centres.get(to.key), centres.get(from.key), nodeWidth, nodeHeight);
      const parts = [line(from.key, [[a.x, a.y], [b.x, b.y]], { arrow: true })];
      if (label) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const offset = block.direction === "down" ? { x: 14, y: -10 } : { x: -textWidth(label, 16) / 2, y: -28 };
        parts.push(text(from.key, label, { x: mid.x + offset.x, y: mid.y + offset.y }, 16, { strokeColor: MUTED }));
      }
      add(block.key, parts, { needs: [from.key, to.key] });
    }
  } else if (block.type === "tree") {
    const nodeWidth = 190;
    const nodeHeight = 70;
    const leafWidth = 150;
    const columnWidth = Math.min(COLUMN / block.children.length, 260);
    width = columnWidth * block.children.length;
    const rootAt = { x: x + width / 2 - nodeWidth / 2, y: top };
    add(block.root.key, box(block.root.key, rootAt, nodeWidth, nodeHeight, wrapText(block.root.text, 15), { fill: "#e7f5ff" }));
    const childTop = top + nodeHeight + 70;
    let deepest = childTop + nodeHeight;
    block.children.forEach((child, index) => {
      const cx = x + columnWidth * index + columnWidth / 2;
      const childWidth = Math.min(nodeWidth, columnWidth - 20);
      add(child.key, box(child.key, { x: cx - childWidth / 2, y: childTop }, childWidth, nodeHeight, wrapText(child.text, Math.max(8, Math.floor((childWidth - 20) / charWidth(20))))));
      add(block.key, line(child.key, [[rootAt.x + nodeWidth / 2, top + nodeHeight], [cx, childTop]]), { needs: [block.root.key, child.key] });
      child.children.forEach((leaf, leafIndex) => {
        const leafTop = childTop + nodeHeight + 40 + leafIndex * 64;
        const width = Math.min(leafWidth, columnWidth - 30);
        add(leaf.key, box(leaf.key, { x: cx - width / 2 + 14, y: leafTop }, width, 48, wrapText(leaf.text, Math.max(8, Math.floor((width - 16) / charWidth(16)))), { size: 16 }));
        add(block.key, line(leaf.key, [[cx - childWidth / 2 + 10, childTop + nodeHeight], [cx - childWidth / 2 + 10, leafTop + 24], [cx - width / 2 + 14, leafTop + 24]]), { needs: [child.key, leaf.key] });
        deepest = Math.max(deepest, leafTop + 48);
      });
    });
    height = deepest - y;
  } else if (block.type === "table") {
    const columns = block.columns.length;
    const cellWidth = Math.min(260, COLUMN / columns);
    const chars = Math.max(8, Math.floor((cellWidth - 20) / charWidth(18)));
    width = cellWidth * columns;
    const rowHeight = (cells) => Math.max(52, Math.max(...cells.map((cell) => lineCount(wrapText(cell || " ", chars)))) * 18 * 1.25 + 24);
    const headerHeight = rowHeight(block.columns);
    add(block.key, block.columns.map((column, index) => box(block.key, { x: x + index * cellWidth, y: top }, cellWidth, headerHeight, wrapText(column, chars), { fill: "#e7f5ff", size: 18 })), { base: true });
    let rowTop = top + headerHeight;
    block.rows.forEach((row, rowIndex) => {
      const h = rowHeight(row);
      const name = block.rowKeys[rowIndex];
      add(name, row.map((cell, index) => box(name, { x: x + index * cellWidth, y: rowTop }, cellWidth, h, cell ? wrapText(cell, chars) : "", { size: 18 })));
      rowTop += h;
    });
    height = rowTop - y;
  } else if (block.type === "timeline") {
    const n = block.events.length;
    const spacing = COLUMN / n;
    const axisY = top + 44;
    add(block.key, line(block.key, [[x, axisY], [x + COLUMN, axisY]], { arrow: true }), { base: true });
    let deepest = axisY + 20;
    block.events.forEach((event, index) => {
      const cx = x + spacing * index + spacing / 2;
      const chars = Math.max(8, Math.floor((spacing - 16) / charWidth(16)));
      const parts = [named(event.key, { type: "ellipse", x: cx - 8, y: axisY - 8, width: 16, height: 16, backgroundColor: KLUI_INK, fillStyle: "solid" })];
      if (event.label) parts.push(text(event.key, event.label, { x: cx - textWidth(event.label, 20) / 2, y: axisY - 40 }, 20));
      if (event.text) {
        const wrapped = wrapText(event.text, chars);
        parts.push(text(event.key, wrapped, { x: cx - Math.min(spacing - 16, textWidth(wrapped, 16)) / 2, y: axisY + 18 }, 16, { strokeColor: MUTED }));
        deepest = Math.max(deepest, axisY + 18 + lineCount(wrapped) * 20);
      }
      add(event.key, parts);
    });
    height = deepest - y;
  } else if (block.type === "compare") {
    const sideWidth = (COLUMN - 60) / 2;
    let deepest = top;
    [block.left, block.right].forEach((side, index) => {
      const sx = x + index * (sideWidth + 60);
      const parts = [box(side.key, { x: sx, y: top }, sideWidth, 60, side.title, { fill: index ? "#fff4e6" : "#e7f5ff", ink: index ? MARK_INK : KLUI_INK, size: 22 })];
      let at = top + 80;
      for (const point of side.points) {
        const wrapped = wrapText(point, Math.floor((sideWidth - 30) / charWidth(18)));
        parts.push(text(side.key, "•", { x: sx + 4, y: at }, 18), text(side.key, wrapped, { x: sx + 24, y: at }, 18));
        at += lineCount(wrapped) * 18 * 1.25 + 10;
      }
      deepest = Math.max(deepest, at);
      add(side.key, parts);
    });
    add(block.key, line(block.key, [[x + sideWidth + 30, top + 6], [x + sideWidth + 30, Math.max(top + 70, deepest - 6)]], { ink: MUTED, dashed: true }), { base: true });
    height = deepest - y;
  } else if (block.type === "plot") {
    const chartWidth = 640;
    const chartHeight = 340;
    const left = x + 60;
    // Room above the chart for the y axis's arrowhead and label, clear of the title.
    const chartTop = top + 70;
    const sx = (value) => left + ((value - block.x.min) / (block.x.max - block.x.min)) * chartWidth;
    const sy = (value) => chartTop + chartHeight - ((value - block.y.min) / (block.y.max - block.y.min)) * chartHeight;
    // Axes cross at zero when zero is in range, otherwise along the bottom and left edges.
    const axisX = block.y.min <= 0 && block.y.max >= 0 ? sy(0) : chartTop + chartHeight;
    const axisY = block.x.min <= 0 && block.x.max >= 0 ? sx(0) : left;
    const tick = (value) => String(Math.abs(value) >= 1000 || Number.isInteger(value) ? value : Number(value.toPrecision(3)));
    add(block.key, [
      line(block.key, [[left, axisX], [left + chartWidth + 24, axisX]], { arrow: true }),
      line(block.key, [[axisY, chartTop + chartHeight], [axisY, chartTop - 24]], { arrow: true }),
      text(block.key, block.x.label, { x: left + chartWidth + 30, y: axisX - 12 }, 18, { strokeColor: MUTED }),
      text(block.key, block.y.label, { x: axisY - textWidth(block.y.label, 18) / 2, y: chartTop - 54 }, 18, { strokeColor: MUTED }),
      text(block.key, tick(block.x.min), { x: left - 6, y: chartTop + chartHeight + 8 }, 14, { strokeColor: MUTED }),
      text(block.key, tick(block.x.max), { x: left + chartWidth - 14, y: chartTop + chartHeight + 8 }, 14, { strokeColor: MUTED }),
      text(block.key, tick(block.y.max), { x: left - 14 - textWidth(tick(block.y.max), 14), y: chartTop - 6 }, 14, { strokeColor: MUTED }),
      text(block.key, tick(block.y.min), { x: left - 14 - textWidth(tick(block.y.min), 14), y: chartTop + chartHeight - 14 }, 14, { strokeColor: MUTED })
    ], { base: true });
    block.curves.forEach((curve, index) => {
      const ink = CURVE_INKS[index % CURVE_INKS.length];
      const segments = curveSegments(curve, block.x, block.y).map((segment) => segment.map(([px, py]) => [sx(px), sy(py)]));
      const parts = segments.filter((segment) => segment.length >= 2).map((segment) => line(curve.key, segment, { smooth: true, ink, width: 2.5 }));
      const last = segments.at(-1)?.at(-1);
      if (curve.label && last) parts.push(text(curve.key, curve.label, { x: Math.min(last[0] + 10, left + chartWidth + 10), y: last[1] - 24 }, 18, { strokeColor: ink }));
      if (parts.length) add(curve.key, parts);
    });
    for (const mark of block.marks) {
      if (mark.x < block.x.min || mark.x > block.x.max || mark.y < block.y.min || mark.y > block.y.max) continue;
      const px = sx(mark.x);
      const py = sy(mark.y);
      const parts = [named(mark.key, { type: "ellipse", x: px - 7, y: py - 7, width: 14, height: 14, backgroundColor: MARK_INK, fillStyle: "solid", strokeColor: MARK_INK })];
      if (mark.label) parts.push(text(mark.key, mark.label, { x: px + 12, y: py - 30 }, 18, { strokeColor: MARK_INK }));
      add(mark.key, parts);
    }
    width = chartWidth + 60 + 120;
    height = chartTop - y + chartHeight + 40;
  } else if (block.type === "sketch") {
    // The planner draws sketches in its own coordinates; they are fitted to the column.
    const skeletons = proposalToSkeletons({ ops: block.ops });
    const box = sketchBounds(block.ops);
    const scale = Math.min(1, COLUMN / Math.max(1, box.width), 560 / Math.max(1, box.height));
    const place = (px, py) => [x + (px - box.x) * scale, top + (py - box.y) * scale];
    const keyOf = new Map(block.ops.filter((op) => op.key).map((op) => [`klui-${op.key}`, op.key]));
    const connections = block.ops.filter((op) => op.op === "connect");
    let arrowIndex = 0;
    for (const skeleton of skeletons) {
      const [px, py] = place(skeleton.x, skeleton.y);
      const scaled = { ...skeleton, x: px, y: py };
      if (skeleton.width !== undefined) scaled.width = skeleton.width * scale;
      if (skeleton.height !== undefined) scaled.height = skeleton.height * scale;
      if (skeleton.points) scaled.points = skeleton.points.map(([qx, qy]) => [qx * scale, qy * scale]);
      delete scaled.start;
      delete scaled.end;
      if (skeleton.type === "arrow" && !skeleton.id) {
        // A connect arrow joins two shapes: it appears once both are on the board.
        const link = connections[arrowIndex++];
        add(block.key, named(block.key, { ...scaled, id: undefined }), { needs: [link.from, link.to] });
        continue;
      }
      // Point labels ("klui-tri-label-0") belong to their line.
      const owner = keyOf.get(skeleton.id) || keyOf.get(String(skeleton.id || "").replace(/-label-\d+$/, "")) || block.key;
      add(owner, named(owner, { ...scaled, id: undefined }));
    }
    width = box.width * scale;
    height = top - y + box.height * scale;
  }
  // Ids are assigned last so every skeleton has one, in reveal order.
  for (const piece of pieces) for (const skeleton of piece.skeletons) if (!skeleton.id) skeleton.id = id();
  return { key: block.key, type: block.type, x, y, width, height: Math.max(height, 40), pieces };
}

function edgePoint(from, to, width, height) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const scale = 1 / Math.max(Math.abs(dx) / (width / 2 + 10), Math.abs(dy) / (height / 2 + 10), 0.001);
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

function sketchBounds(ops) {
  const xs = [];
  const ys = [];
  for (const op of ops) {
    if (op.op === "shape") { xs.push(op.x, op.x + op.width); ys.push(op.y, op.y + op.height); }
    if (op.op === "text") { xs.push(op.x, op.x + op.width); ys.push(op.y, op.y + 30); }
    if (op.op === "line") for (const [px, py] of op.points) { xs.push(px - 30, px + 30); ys.push(py - 30, py + 30); }
  }
  if (!xs.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** A curve's points within the plot's ranges, split where it leaves them (or is undefined). */
export function curveSegments(curve, xAxis, yAxis) {
  const raw = curve.fn
    ? (() => {
      const fn = compileExpression(curve.fn);
      if (!fn) return [];
      return Array.from({ length: 61 }, (_, index) => {
        const x = xAxis.min + ((xAxis.max - xAxis.min) * index) / 60;
        return [x, fn(x)];
      });
    })()
    : [...curve.points].sort((a, b) => a[0] - b[0]);
  const segments = [];
  let current = [];
  const span = yAxis.max - yAxis.min;
  for (const [x, y] of raw) {
    const inside = Number.isFinite(y) && x >= xAxis.min && x <= xAxis.max && y >= yAxis.min - span * 0.02 && y <= yAxis.max + span * 0.02;
    if (inside) current.push([x, Math.min(yAxis.max, Math.max(yAxis.min, y))]);
    else if (current.length) { segments.push(current); current = []; }
  }
  if (current.length) segments.push(current);
  return segments;
}

/**
 * The whole planned board, laid out: per step, its heading, the student's space, and its blocks
 * stacked down the tutor's column, plus where improvised blocks go next.
 */
export function layoutLesson(board, steps = []) {
  return (board?.steps || []).map((step, index) => {
    const n = index + 1;
    const x = index * STEP_STRIDE;
    const title = `Step ${n} · ${cleanText(steps[index]?.title || "", 60)}`.replace(/ · $/, "");
    const heading = layoutHeading(n, title, x);
    const blocks = [];
    let y = BLOCKS_TOP;
    for (const block of step.blocks) {
      const laid = layoutBlock(block, x, y, `s${n}`);
      blocks.push(laid);
      y += laid.height + BLOCK_GAP;
    }
    const space = layoutSpace(n, x + COLUMN + SPACE_GAP, BLOCKS_TOP, Math.max(SPACE_MIN_HEIGHT, y - BLOCKS_TOP));
    return { n, x, heading, space, blocks, nextY: y };
  });
}

function layoutHeading(n, title, x) {
  const name = `step-${n}`;
  const width = Math.min(COLUMN, textWidth(title, 36));
  return {
    key: name,
    pieces: [{
      part: name,
      skeletons: [
        { id: `s${n}-heading-0`, type: "text", x, y: 0, text: title, fontSize: 36, fontFamily: FONT, strokeColor: KLUI_INK, customData: { klui: true, name } },
        { id: `s${n}-heading-1`, type: "line", x, y: 56, points: [[0, 0], [width * 0.5, 3], [width, 0]], endArrowhead: null, roundness: { type: 2 }, strokeColor: KLUI_INK, strokeWidth: 2, roughness: 1, customData: { klui: true, name } }
      ]
    }]
  };
}

function layoutSpace(n, x, y, height) {
  const name = `space-${n}`;
  return {
    key: name,
    box: { x, y, width: SPACE_WIDTH, height },
    pieces: [{
      part: name,
      skeletons: [
        { id: `s${n}-space-0`, type: "rectangle", x, y, width: SPACE_WIDTH, height, strokeColor: MUTED, strokeStyle: "dashed", strokeWidth: 1, roughness: 1, backgroundColor: "transparent", roundness: { type: 3 }, customData: { klui: true, name } },
        { id: `s${n}-space-1`, type: "text", x: x + 18, y: y + 14, text: "Your space", fontSize: 20, fontFamily: FONT, strokeColor: MUTED, customData: { klui: true, name } },
        { id: `s${n}-space-2`, type: "text", x: x + 18, y: y + 42, text: "Draw or write here. I'll take a look.", fontSize: 15, fontFamily: FONT, strokeColor: MUTED, customData: { klui: true, name } }
      ]
    }]
  };
}

/**
 * A hand-drawn loop around `box`, like a teacher circling something: a closed line that slightly
 * overshoots its start, so it draws itself on in one stroke.
 */
export function markSkeleton(box, name, id) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = box.width / 2 + 18;
  const ry = box.height / 2 + 16;
  const points = [];
  const steps = 26;
  for (let index = 0; index <= steps; index += 1) {
    const turn = index / steps;
    const angle = -Math.PI * 0.6 + turn * Math.PI * 2.12;
    const wobble = 1 + 0.035 * Math.sin(turn * 9) + 0.04 * turn;
    points.push([cx + Math.cos(angle) * rx * wobble, cy + Math.sin(angle) * ry * wobble]);
  }
  const [ox, oy] = points[0];
  return {
    id, type: "line", x: ox, y: oy, points: points.map(([px, py]) => [px - ox, py - oy]), endArrowhead: null, roundness: { type: 2 },
    strokeColor: MARK_INK, strokeWidth: 2.5, roughness: 1, backgroundColor: "transparent", customData: { klui: true, name: `mark-${name}`.slice(0, 40) }
  };
}

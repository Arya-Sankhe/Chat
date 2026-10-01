// Text measurement for the deck renderer. Widths come from the metric-compatible fonts the
// worker renders previews with (Liberation Sans/Narrow = Arial/Arial Narrow, Carlito = Calibri,
// Gelasio = Georgia), so a box sized here fits in PowerPoint and in the LibreOffice preview.
import fs from "node:fs";

const METRICS = JSON.parse(fs.readFileSync(new URL("./font-metrics.json", import.meta.url), "utf8"));
const tables = new Map();
const SERIF_TWINS = new Set(["Cambria", "Times New Roman"]);

function faceTable(face, bold) {
  const key = `${face}|${bold ? 1 : 0}`;
  if (tables.has(key)) return tables.get(key);
  // Serif faces without their own table measure as Georgia, which is wider, so text still fits.
  const family = METRICS[face] || METRICS[SERIF_TWINS.has(face) ? "Georgia" : "Arial"];
  const style = bold ? family.bold : family.regular;
  const widths = new Map();
  [...style.widths].forEach((char, index) => widths.set(char, style.adv[index]));
  const table = { widths, avg: style.avg };
  tables.set(key, table);
  return table;
}

// Width of a string in points. Unknown glyphs (CJK etc.) count as a full em.
export function textWidthPt(text, { face = "Arial", size = 12, bold = false, charSpacing = 0 } = {}) {
  const table = faceTable(face, bold);
  let em = 0;
  let count = 0;
  for (const char of String(text || "")) {
    const code = char.codePointAt(0);
    em += table.widths.get(char) ?? (code > 0x2e80 ? 1 : table.avg);
    count += 1;
  }
  return em * size + Math.max(0, count - 1) * charSpacing;
}

// "**x**" marks emphasis. Returns runs [{ text, em }] with the markers removed.
export function parseRuns(text) {
  const runs = [];
  const source = String(text ?? "");
  const pattern = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > last) runs.push({ text: source.slice(last, match.index), em: false });
    runs.push({ text: match[1], em: true });
    last = match.index + match[0].length;
  }
  if (last < source.length) runs.push({ text: source.slice(last), em: false });
  return runs.filter((run) => run.text);
}

export function plain(text) {
  return String(text ?? "").replace(/\*\*([^*]+)\*\*/g, "$1");
}

// Greedy word wrap that mirrors how PowerPoint breaks lines. Emphasised words are measured in
// the emphasis weight. Returns line strings (markers removed).
export function wrapLines(text, widthIn, style) {
  const widthPt = Math.max(1, widthIn * 72 * 0.97);
  const lines = [];
  for (const paragraph of String(text ?? "").split(/\n/)) {
    const tokens = [];
    for (const run of parseRuns(paragraph)) {
      for (const piece of run.text.split(/(\s+)/)) {
        if (piece) tokens.push({ text: piece, bold: run.em ? (style.emBold ?? style.bold) : style.bold });
      }
    }
    let line = "";
    let lineWidth = 0;
    const flush = () => {
      lines.push(line.trimEnd());
      line = "";
      lineWidth = 0;
    };
    for (const token of tokens) {
      const width = textWidthPt(token.text, { ...style, bold: token.bold });
      if (/^\s+$/.test(token.text)) {
        if (line) {
          line += token.text;
          lineWidth += width;
        }
        continue;
      }
      if (lineWidth + width <= widthPt || !line.trim()) {
        if (width > widthPt && !line.trim()) {
          // A single word wider than the box breaks by character.
          lines.broken = token.text;
          let chunk = "";
          for (const char of token.text) {
            const next = chunk + char;
            if (textWidthPt(next, { ...style, bold: token.bold }) > widthPt && chunk) {
              lines.push(chunk);
              chunk = char;
            } else {
              chunk = next;
            }
          }
          line = chunk;
          lineWidth = textWidthPt(chunk, { ...style, bold: token.bold });
        } else {
          line += token.text;
          lineWidth += width;
        }
      } else {
        flush();
        line = token.text;
        lineWidth = width;
      }
    }
    flush();
  }
  if (!lines.length) lines.push("");
  return lines;
}

export function lineHeightIn(size, lineHeight = 1.2) {
  return (size * lineHeight) / 72;
}

export function textHeightIn(lineCount, size, lineHeight = 1.2, paraGapPt = 0, paragraphs = 1) {
  return lineCount * lineHeightIn(size, lineHeight) + Math.max(0, paragraphs - 1) * (paraGapPt / 72);
}

// Largest size in [max..min] (step 0.5pt) whose wrapped text fits the box. When nothing fits
// the text is clipped to the lines that fit and ends with an ellipsis.
export function fitText(text, { w, h = Infinity, face, bold = false, emBold, max, min, lineHeight = 1.2, charSpacing = 0, maxLines = Infinity }) {
  const style = { face, bold, emBold, charSpacing };
  for (let size = max; size >= min - 0.001; size -= 0.5) {
    const lines = wrapLines(text, w, { ...style, size });
    const height = textHeightIn(lines.length, size, lineHeight);
    if (height <= h + 0.001 && lines.length <= maxLines) {
      return { text, size, lines, height, fits: true, broken: lines.broken || "" };
    }
  }
  const size = min;
  const lines = wrapLines(text, w, { ...style, size });
  // At least one line is always drawn; if even that is taller than the box it does not fit.
  const room = Math.max(1, Math.min(maxLines, Math.floor((h + 0.001) / lineHeightIn(size, lineHeight))));
  if (lines.length <= room) {
    const height = textHeightIn(lines.length, size, lineHeight);
    return { text, size, lines, height, fits: height <= h + 0.001, broken: lines.broken || "" };
  }
  const kept = lines.slice(0, room);
  kept[room - 1] = `${kept[room - 1].replace(/[\s,.;:–—-]+$/, "")}…`;
  return { text: truncateTo(text, kept), size, lines: kept, height: textHeightIn(room, size, lineHeight), fits: false, broken: lines.broken || "" };
}

// Cut the marked-up source so it holds only the visible lines' words, keeping emphasis markers.
function truncateTo(text, keptLines) {
  const budget = keptLines.join("").replace(/…$/, "").replace(/\s+/g, "").length;
  let visible = 0;
  let out = "";
  const source = String(text ?? "");
  let open = false;
  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith("**", index)) {
      out += "**";
      open = !open;
      index += 1;
      continue;
    }
    const char = source[index];
    if (/\s/.test(char)) {
      out += char;
      continue;
    }
    if (visible >= budget) break;
    out += char;
    visible += 1;
  }
  out = out.replace(/[\s,.;:–—-]+$/, "");
  if (open) out += "**";
  return `${out}…`;
}

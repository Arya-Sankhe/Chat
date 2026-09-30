// Drawing primitives and reusable slide components. Every text box is measured before it is
// placed (see measure.js), so components size themselves to their content and shrink or clip
// instead of overflowing.
import { fitText, parseRuns, plain, textWidthPt } from "./measure.js";

export const W = 13.333;
export const H = 7.5;
export const MX = 0.6;
export const CW = W - MX * 2;

const LINE_HEIGHT = { title: 1.1, display: 1.02, number: 1.0, body: 1.25, label: 1.2 };

export class Painter {
  constructor(pptx, slide, theme, deck) {
    this.pptx = pptx;
    this.slide = slide;
    this.theme = theme;
    this.deck = deck;
    this.warnings = [];
  }

  hidden(name) {
    return Boolean(this.theme.hidden?.has(name));
  }

  // Colour for a named slide element: a style override if set, else the theme token.
  role(name, fallback) {
    return this.theme.roles?.[name] || fallback;
  }

  color(value) {
    if (!value) return undefined;
    return this.theme.colors[value] || String(value).replace(/^#/, "");
  }

  face(role = "body") {
    const fonts = this.theme.fonts;
    return fonts[role] || fonts.body;
  }

  resolveStyle(style = {}) {
    const role = style.role || "body";
    const face = style.face || this.face(role === "title" ? "title" : role === "display" ? "display" : role === "number" ? "number" : role === "label" ? "label" : "body");
    const roleBold = role === "title" ? this.theme.fonts.titleBold : role === "display" ? this.theme.fonts.displayBold : role === "number" ? this.theme.fonts.numberBold : false;
    const bold = style.bold ?? roleBold;
    const lineHeight = style.lineHeight || LINE_HEIGHT[role] || 1.2;
    const em = style.em || {};
    return {
      face,
      bold,
      emBold: em.bold ?? true,
      max: style.size || 12,
      min: style.min ?? Math.max(7, (style.size || 12) * 0.8),
      lineHeight,
      charSpacing: style.spacing || 0,
      maxLines: style.maxLines || Infinity,
      caps: Boolean(style.caps),
      color: this.color(style.color || "body"),
      emColor: this.color(em.color || style.color || "ink"),
      align: style.align || "left",
      valign: style.valign || "top",
      italic: Boolean(style.italic)
    };
  }

  measure(value, w, style = {}, h = Infinity) {
    const resolved = this.resolveStyle(style);
    const text = resolved.caps ? String(value ?? "").toUpperCase() : String(value ?? "");
    return fitText(text, { ...resolved, w, h });
  }

  // Draw text in a box. Returns the fit ({ size, height, lines, fits }).
  text(value, box, style = {}) {
    if (value === null || value === undefined || String(value).trim() === "") return { size: 0, height: 0, lines: [], fits: true };
    const resolved = this.resolveStyle(style);
    const source = resolved.caps ? String(value).toUpperCase() : String(value);
    const fit = fitText(source, { ...resolved, w: box.w, h: box.h ?? Infinity });
    if (!fit.fits) this.warnings.push(`clipped: ${plain(source).slice(0, 60)}`);
    const runs = [];
    const paragraphs = fit.text.split("\n");
    paragraphs.forEach((paragraph, paragraphIndex) => {
      const parsed = parseRuns(paragraph);
      if (!parsed.length) parsed.push({ text: " ", em: false });
      parsed.forEach((run, runIndex) => {
        const options = {};
        if (run.em) {
          options.bold = resolved.emBold;
          options.color = resolved.emColor;
        }
        if (runIndex === parsed.length - 1 && paragraphIndex < paragraphs.length - 1) options.breakLine = true;
        runs.push({ text: run.text, options });
      });
    });
    const drawHeight = resolved.valign === "top" ? Math.max(fit.height + 0.06, 0.18) : Math.max(box.h ?? fit.height, fit.height + 0.06);
    this.slide.addText(runs, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: drawHeight,
      fontFace: resolved.face,
      fontSize: fit.size,
      color: resolved.color,
      bold: resolved.bold,
      italic: resolved.italic,
      align: resolved.align,
      valign: resolved.valign,
      margin: 0,
      lineSpacing: Math.round(fit.size * resolved.lineHeight * 10) / 10,
      charSpacing: resolved.charSpacing || undefined,
      fit: "none",
      wrap: true,
      rotate: style.rotate || undefined,
      objectName: style.name || `Text: ${plain(source).replace(/\s+/g, " ").slice(0, 40)}`
    });
    return fit;
  }

  rect(box, { fill, line, lineWidth = 0.75, radius = 0, transparency = 0, dash, name } = {}) {
    const shape = radius ? this.pptx.ShapeType.roundRect : this.pptx.ShapeType.rect;
    const options = {
      x: box.x,
      y: box.y,
      w: Math.max(0.001, box.w),
      h: Math.max(0.001, box.h),
      fill: fill ? { color: this.color(fill), transparency } : { type: "none" },
      line: line ? { color: this.color(line), width: lineWidth, dashType: dash } : { type: "none" }
    };
    if (radius) options.rectRadius = radius;
    if (name) options.objectName = name;
    this.slide.addShape(shape, options);
  }

  ellipse(box, { fill, line, lineWidth = 0.75, transparency = 0 } = {}) {
    this.slide.addShape(this.pptx.ShapeType.ellipse, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill: fill ? { color: this.color(fill), transparency } : { type: "none" },
      line: line ? { color: this.color(line), width: lineWidth } : { type: "none" }
    });
  }

  line(x1, y1, x2, y2, { color = "rule", width = 0.75, dash, arrow } = {}) {
    const options = {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.max(0.0001, Math.abs(x2 - x1)),
      h: Math.max(0.0001, Math.abs(y2 - y1)),
      line: { color: this.color(color), width, dashType: dash, endArrowType: arrow || undefined }
    };
    if (Math.abs(x2 - x1) < 0.0002) options.w = 0;
    if (Math.abs(y2 - y1) < 0.0002) options.h = 0;
    if ((x2 < x1) !== (y2 < y1) && options.w && options.h) options.flipV = true;
    if (x2 < x1 && !options.h) options.flipH = true;
    if (y2 < y1 && !options.w) options.flipV = true;
    this.slide.addShape(this.pptx.ShapeType.line, options);
  }

  shape(type, box, { fill, line, lineWidth = 0.75, transparency = 0, rotate, flipH } = {}) {
    this.slide.addShape(this.pptx.ShapeType[type] || type, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill: fill ? { color: this.color(fill), transparency } : { type: "none" },
      line: line ? { color: this.color(line), width: lineWidth } : { type: "none" },
      rotate,
      flipH
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Status colours: "Met", "On track", "Missed", "At risk"...

export function statusTone(text) {
  const value = plain(text).toLowerCase();
  if (!value) return "";
  if (/(^|\b)(miss(ed)?|behind|fail(ed)?|off[ -]track|red|blocked|over budget|not met|delayed|critical|no\b|✗|below)/.test(value)) return "negative";
  if (/(at risk|watch|amber|partial|pending|in progress|monitor|conditional|in talks|negotiating|medium|caution)/.test(value)) return "warn";
  if (/(^|\b)(met|on[ -]track|pass(ed)?|done|achieved|complete[d]?|green|ahead|yes|✓|approved|beat|above|ok|closable|ready|high)\b/.test(value)) return "positive";
  return "";
}

// Small status marker: coloured dot + label.
export function statusLabel(p, text, box, { size = 10 } = {}) {
  const tone = statusTone(text) || "muted";
  const dot = size / 72 * 0.55;
  p.ellipse({ x: box.x, y: box.y + (size * 1.2 / 72 - dot) / 2 + 0.005, w: dot, h: dot }, { fill: tone });
  return p.text(text, { x: box.x + dot + 0.07, y: box.y, w: box.w - dot - 0.07 }, { size, min: size - 1, color: tone === "muted" ? "body" : tone, bold: true, maxLines: 2 });
}

export function chip(p, text, x, y, { size = 8.5, fill = "accent", color = "onAccent", maxW = 3, padX = 0.1, radius = 0.04, bold = true } = {}) {
  const label = plain(text);
  const width = Math.min(maxW, textWidthPt(label, { face: p.face("label"), size, bold }) / 72 + padX * 2 + 0.02);
  const height = size * 1.25 / 72 + 0.08;
  p.rect({ x, y, w: width, h: height }, { fill, radius: radius ? radius : 0 });
  p.text(label, { x: x + padX, y: y + 0.04, w: width - padX * 2 + 0.02 }, { role: "label", size, min: size - 1.5, color, bold, maxLines: 1 });
  return { w: width, h: height };
}

// ---------------------------------------------------------------------------------------------
// KPI: big value, smaller unit on the same baseline, label and note underneath.

export function measureKpi(p, kpiItem, w, { size = 30, labelSize = 10, noteSize = 9 } = {}) {
  const unitSize = Math.max(9, size * 0.42);
  let valueSize = size;
  const face = p.face("number");
  while (valueSize > size * 0.55) {
    const width = textWidthPt(kpiItem.value, { face, size: valueSize, bold: p.theme.fonts.numberBold }) / 72
      + (kpiItem.unit ? 0.06 + textWidthPt(kpiItem.unit, { face: p.face("body"), size: unitSize }) / 72 : 0);
    if (width <= w) break;
    valueSize -= 1;
  }
  const valueH = valueSize * 1.05 / 72;
  const label = kpiItem.label ? p.measure(kpiItem.label, w, { size: labelSize, maxLines: 2 }) : { height: 0 };
  const note = kpiItem.note ? p.measure(kpiItem.note, w, { size: noteSize, maxLines: 3 }) : { height: 0 };
  return { valueSize, unitSize: Math.min(unitSize, valueSize * 0.5), valueH, height: valueH + (label.height ? 0.06 + label.height : 0) + (note.height ? 0.04 + note.height : 0) };
}

export function drawKpi(p, kpiItem, box, { size = 30, labelSize = 10, noteSize = 9, color = "ink", align = "left", labelColor = "body", noteColor = "muted", labelBold = false, unitColor = "muted" } = {}) {
  const m = measureKpi(p, kpiItem, box.w, { size, labelSize, noteSize });
  const face = p.face("number");
  const valueW = textWidthPt(kpiItem.value, { face, size: m.valueSize, bold: p.theme.fonts.numberBold }) / 72;
  const unitW = kpiItem.unit ? textWidthPt(kpiItem.unit, { face: p.face("body"), size: m.unitSize }) / 72 : 0;
  const total = valueW + (unitW ? unitW + 0.06 : 0);
  let x = box.x;
  if (align === "center") x = box.x + (box.w - total) / 2;
  if (align === "right") x = box.x + box.w - total;
  const tone = statusTone(kpiItem.status);
  p.text(kpiItem.value, { x, y: box.y, w: valueW + 0.12 }, { role: "number", size: m.valueSize, min: m.valueSize, color: tone || color, maxLines: 1, lineHeight: 1.05 });
  if (kpiItem.unit) {
    const drop = (m.valueSize - m.unitSize) * 0.8 / 72;
    p.text(kpiItem.unit, { x: x + valueW + 0.06, y: box.y + drop, w: unitW + 0.15 }, { size: m.unitSize, min: m.unitSize, color: unitColor, maxLines: 1, lineHeight: 1.05 });
  }
  let y = box.y + m.valueH + 0.06;
  if (kpiItem.label) y += p.text(kpiItem.label, { x: box.x, y, w: box.w }, { size: labelSize, color: labelColor, bold: labelBold, maxLines: 2, align }).height + 0.04;
  if (kpiItem.note) y += p.text(kpiItem.note, { x: box.x, y, w: box.w }, { size: noteSize, color: noteColor, maxLines: 3, align }).height;
  return { height: y - box.y };
}

// Vertical stack of KPIs separated by hairlines (the right-hand "rail" in Kimi-style decks).
export function kpiStack(p, box, kpis, { size = 30 } = {}) {
  if (!kpis.length) return;
  let scale = 1;
  let heights = [];
  for (; scale >= 0.6; scale -= 0.08) {
    heights = kpis.map((item) => measureKpi(p, item, box.w, { size: size * scale, labelSize: 10 * Math.max(scale, 0.85), noteSize: 9 }).height);
    if (heights.reduce((a, b) => a + b, 0) + (kpis.length - 1) * 0.3 <= box.h) break;
  }
  const used = heights.reduce((a, b) => a + b, 0);
  const gap = Math.min(0.62, Math.max(0.2, (box.h - used) / Math.max(1, kpis.length)));
  let y = box.y;
  kpis.forEach((item, index) => {
    const color = index === 0 ? "accent" : "ink";
    drawKpi(p, item, { x: box.x, y, w: box.w }, { size: size * scale, labelSize: 10 * Math.max(scale, 0.85), noteSize: 9, color });
    y += heights[index] + gap / 2;
    if (index < kpis.length - 1) p.line(box.x, y, box.x + box.w, y, { color: "rule", width: 0.75 });
    y += gap / 2;
  });
}

// Horizontal row of KPIs with thin vertical dividers.
export function kpiRow(p, box, kpis, { size = 34, divider = true, labelSize = 10.5, colors, labelColor = "body", noteColor = "muted", unitColor = "muted", dividerColor = "rule", align = "left" } = {}) {
  if (!kpis.length) return 0;
  const gap = 0.3;
  const w = (box.w - gap * (kpis.length - 1)) / kpis.length;
  let height = 0;
  kpis.forEach((item, index) => {
    const x = box.x + index * (w + gap);
    const inner = divider && index > 0 ? { x: x + 0.02, w: w - 0.02 } : { x, w };
    const drawn = drawKpi(p, item, { x: inner.x, y: box.y, w: inner.w }, { size, labelSize, noteSize: 9, color: colors?.[index] || (index === 0 ? "accent" : "ink"), labelColor, noteColor, unitColor, align });
    height = Math.max(height, drawn.height);
  });
  if (divider) {
    for (let index = 1; index < kpis.length; index += 1) {
      const x = box.x + index * (w + gap) - gap / 2;
      p.line(x, box.y + 0.04, x, box.y + height, { color: dividerColor, width: 0.75 });
    }
  }
  return height;
}

// ---------------------------------------------------------------------------------------------
// Rows: the workhorse list. Optional big index number, bold title, body, right-hand meta.

export function rows(p, box, list, {
  numbered = false,
  numberStyle = "muted",
  titleSize = 13,
  bodySize = 11,
  titleColor = "ink",
  bodyColor = "body",
  divider = true,
  metaW = 0,
  marker = false,
  maxGap = 0.34,
  startIndex = 1,
  labelColor = "accent"
} = {}) {
  if (!list.length) return 0;
  const numW = numbered ? 0.62 : marker ? 0.22 : 0;
  const textW = box.w - numW - (metaW ? metaW + 0.2 : 0);
  let plan = null;
  // Grow sparse lists (up to ~20%) so they fill the slide; shrink dense ones until they fit.
  for (const scale of [1.2, 1.12, 1.06, 1, 0.94, 0.88, 0.82, 0.76, 0.7]) {
    const ts = Math.min(titleSize * scale, 17.5);
    const bs = Math.min(bodySize * Math.max(scale, 0.82), 13.5);
    const pad = 0.13 * scale + 0.03;
    const measured = list.map((entry) => {
      const label = entry.label ? p.measure(entry.label, textW, { size: 8.5, bold: true, caps: true, spacing: 0.8, maxLines: 1 }) : { height: 0 };
      const title = entry.title ? p.measure(entry.title, textW, { size: ts, bold: true, maxLines: 3 }) : { height: 0 };
      const body = entry.body ? p.measure(entry.body, textW, { size: bs, maxLines: 6 }) : { height: 0 };
      const meta = metaW && (entry.meta || entry.status) ? { height: (entry.meta ? p.measure(entry.meta, metaW, { size: bs, maxLines: 3 }).height : 0) + (entry.status ? bs * 1.3 / 72 + 0.06 : 0) } : { height: 0 };
      const text = (label.height ? label.height + 0.04 : 0) + title.height + (title.height && body.height ? 0.05 : 0) + body.height;
      return { h: Math.max(text, meta.height, numbered ? ts * 1.3 / 72 : 0) };
    });
    const total = measured.reduce((sum, entry) => sum + entry.h, 0) + pad * 2 * list.length;
    plan = { ts, bs, pad, measured, total };
    if (total <= box.h * (scale > 1 ? 0.8 : 1)) break;
  }
  const extra = Math.max(0, box.h - plan.total);
  const gap = Math.min(maxGap, extra / list.length);
  const budgetEach = plan.total > box.h ? box.h / list.length - plan.pad * 2 : Infinity;
  let y = box.y;
  list.forEach((entry, index) => {
    const top = y + plan.pad + gap / 2;
    let x = box.x;
    if (numbered) {
      const number = String(index + startIndex).padStart(2, "0");
      p.text(number, { x, y: top - 0.02, w: numW - 0.1 }, { role: "number", size: Math.min(20, plan.ts * 1.45), min: 11, color: numberStyle === "accent" ? "accent" : "faint", maxLines: 1, lineHeight: 1 });
      x += numW;
    } else if (marker) {
      p.rect({ x, y: top + plan.ts * 0.42 / 72, w: 0.07, h: 0.07 }, { fill: "accent" });
      x += numW;
    }
    let ty = top;
    const room = Number.isFinite(budgetEach) ? budgetEach : Infinity;
    if (entry.label) ty += p.text(entry.label, { x, y: ty, w: textW }, { size: 8.5, bold: true, caps: true, spacing: 0.8, color: labelColor, maxLines: 1 }).height + 0.04;
    if (entry.title) ty += p.text(entry.title, { x, y: ty, w: textW, h: Math.max(0.2, room - (ty - top)) }, { size: plan.ts, min: plan.ts - 1, bold: true, color: titleColor, maxLines: 3 }).height + (entry.body ? 0.05 : 0);
    if (entry.body) p.text(entry.body, { x, y: ty, w: textW, h: Math.max(0.18, room - (ty - top)) }, { size: plan.bs, min: plan.bs - 1, color: bodyColor, maxLines: 6 });
    if (metaW && (entry.meta || entry.status)) {
      let my = top;
      if (entry.status) {
        const tone = statusTone(entry.status) || "accent";
        my += p.text(`● ${plain(entry.status)}`, { x: box.x + box.w - metaW, y: my, w: metaW }, { size: plan.bs - 0.5, min: 8.5, bold: true, color: tone, align: "right", maxLines: 1 }).height + 0.06;
      }
      if (entry.meta) p.text(entry.meta, { x: box.x + box.w - metaW, y: my, w: metaW }, { size: plan.bs, min: plan.bs - 1, color: "muted", align: "right", maxLines: 3 });
    }
    y = top + Math.min(plan.measured[index].h, Number.isFinite(budgetEach) ? budgetEach : Infinity) + plan.pad + gap / 2;
    if (divider && index < list.length - 1) p.line(box.x, y, box.x + box.w, y, { color: "rule", width: 0.75 });
  });
  return y - box.y;
}

// ---------------------------------------------------------------------------------------------
// Table: hairline rows, bold first column, right-aligned numbers, status colouring.

const NUMERIC = /^[\s(+\-−–~≈<>≤≥$€£¥₹]*[\d][\d.,]*\s*(%|x|×|pp|pts?|bp|bps|k|m|bn|mn|b|t|pct|days?|yrs?|years?|min|h|hrs?|kg|t|km|mw|gw)?\)?\s*$/i;

export function isNumericCell(value) {
  return NUMERIC.test(plain(value));
}

export function drawTable(p, box, table, { size = 10.5 } = {}) {
  const columns = table.columns;
  const rowsData = table.rows;
  const n = columns.length;
  const face = p.face("body");
  const numericCol = columns.map((_, col) => rowsData.filter((row) => isNumericCell(row[col])).length >= Math.max(1, rowsData.length * 0.6));
  // Column widths from content at the current type size: the 75th-percentile cell width,
  // clamped; spare width goes to text columns so numbers stay tight and never wrap.
  const columnWidths = (fontSizeNow) => {
    const natural = columns.map((column, col) => {
      const cells = rowsData.map((row) => textWidthPt(plain(row[col]), { face, size: fontSizeNow, bold: col === 0 }) / 72).sort((a, b) => a - b);
      const p75 = cells[Math.floor(cells.length * 0.75)] || 0;
      const widest = cells[cells.length - 1] || 0;
      const head = textWidthPt(plain(column), { face, size: fontSizeNow - 1, bold: true }) / 72;
      const want = numericCol[col] ? Math.max(widest, head * 0.9) : Math.max(p75, head * 0.8);
      return Math.min(4.2, Math.max(0.7, want + 0.26));
    });
    const naturalTotal = natural.reduce((a, b) => a + b, 0);
    if (naturalTotal >= box.w) return natural.map((value) => (value / naturalTotal) * box.w);
    const spare = box.w - naturalTotal;
    const textCols = numericCol.map((isNum, col) => (!isNum ? col : -1)).filter((col) => col >= 0);
    if (!textCols.length) return natural.map((value) => value + spare / natural.length);
    return natural.map((value, col) => value + (textCols.includes(col) ? spare / textCols.length : 0));
  };
  let widths = columnWidths(size);

  const pad = 0.08;
  // Start large and step down: short tables get bigger type instead of a half-empty slide.
  let fontSize = Math.min(13, size + 2.5);
  const roomy = (total) => total <= box.h * 0.82;
  let rowHeights = [];
  let visibleRows = rowsData;
  for (;;) {
    widths = columnWidths(fontSize);
    const lh = fontSize * 1.18 / 72;
    const headH = Math.max(...columns.map((column, col) => p.measure(column, widths[col] - pad * 2, { size: fontSize - 1, bold: true, maxLines: 2 }).lines.length)) * lh + 0.16;
    rowHeights = [headH, ...visibleRows.map((row) => Math.max(...row.map((cell, col) => p.measure(cell, widths[col] - pad * 2, { size: fontSize, bold: col === 0, maxLines: 3 }).lines.length)) * lh + 0.2)];
    const total = rowHeights.reduce((a, b) => a + b, 0);
    if (fontSize > size && !roomy(total)) {
      fontSize -= 0.5;
      continue;
    }
    if (total <= box.h) {
      // Spread spare height across body rows, capped so tables stay tight.
      const extra = Math.min((box.h - total) / Math.max(1, visibleRows.length), 0.3);
      rowHeights = rowHeights.map((value, index) => (index === 0 ? value : value + extra));
      break;
    }
    if (fontSize > 8.5) {
      fontSize -= 0.5;
      continue;
    }
    if (visibleRows.length > 3) {
      visibleRows = visibleRows.slice(0, visibleRows.length - 1);
      continue;
    }
    break;
  }
  if (visibleRows.length < rowsData.length) p.warnings.push(`table rows dropped: ${rowsData.length - visibleRows.length}`);

  const headerFill = p.theme.chrome.tableHeader === "fill";
  const border = (color, pt) => ({ type: "solid", color: p.color(color), pt });
  const none = { type: "none" };
  const cell = (text, options) => {
    const runs = [];
    parseRuns(plain(text) === text ? text : text).forEach((run) => {
      runs.push({ text: run.text, options: run.em ? { bold: true, color: p.color("ink") } : {} });
    });
    return { text: runs.length ? runs : [{ text: "" }], options };
  };
  const header = columns.map((column, col) => cell(column, {
    bold: true,
    fontSize: fontSize - 1,
    color: p.color(headerFill ? "onAccent" : "muted"),
    fill: headerFill ? { color: p.color("accent2") } : undefined,
    align: numericCol[col] ? "right" : "left",
    valign: "bottom",
    border: [none, none, headerFill ? none : border("ruleStrong", 1), none]
  }));
  const body = visibleRows.map((row, rowIndex) => row.map((value, col) => {
    const highlight = rowIndex === table.highlightRow;
    const isStatus = col === table.statusColumn;
    const tone = isStatus ? statusTone(value) : "";
    return cell(isStatus && tone ? `● ${plain(value)}` : value, {
      bold: col === 0 || highlight,
      fontSize,
      color: p.color(tone || (col === 0 ? "ink" : "body")),
      fill: highlight ? { color: p.color("surfaceStrong") } : headerFill && rowIndex % 2 === 1 ? { color: p.color("surface") } : undefined,
      align: numericCol[col] ? "right" : "left",
      valign: "middle",
      border: [none, none, border(rowIndex === visibleRows.length - 1 ? "ruleStrong" : "rule", rowIndex === visibleRows.length - 1 ? 1 : 0.75), none]
    });
  }));
  p.slide.addTable([header, ...body], {
    x: box.x,
    y: box.y,
    w: box.w,
    colW: widths,
    rowH: rowHeights,
    fontFace: face,
    fontSize,
    color: p.color("body"),
    margin: [0.04, pad, 0.04, pad],
    autoPage: false,
    objectName: "Table"
  });
  return rowHeights.reduce((a, b) => a + b, 0);
}

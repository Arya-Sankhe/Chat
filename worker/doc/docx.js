// DocSpec -> DOCX. Native Word throughout: real heading styles (navigation pane, TOC), real
// lists, tables with repeating header rows, editable equations (OMML) and Word fonts. Charts
// are PNGs of the same drawings the PDF uses.

import fs from "node:fs/promises";
import katex from "katex";
import { mml2omml } from "mathml2omml";
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeightRule, ImageRun,
  ImportedXmlComponent, LevelFormat, Packer, PageBreak, PageNumber, Paragraph, ShadingType, Table,
  TableCell, TableLayoutType, TableRow, TabStopType, TextRun, VerticalAlign, WidthType
} from "docx";
import { chartSvg } from "./charts.js";
import { columnAlignments, columnWeights } from "./html.js";
import { parseInline, textBlocks } from "./inline.js";
import { plain } from "./spec.js";
import { resolveStyle } from "./themes.js";

const MM = 56.7; // twips per millimetre
const PAGE = { A4: [11906, 16838], Letter: [12240, 15840], Legal: [12240, 20160] };
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

function hp(pt) {
  return Math.round(pt * 2);
}

function tint(hexColor, amount) {
  const a = hexColor.match(/../g).map((v) => parseInt(v, 16));
  return a.map((v) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function smart(text) {
  return String(text)
    .replace(/(^|[\s([{“‘—–-])"(?=\S)/g, "$1“").replace(/"/g, "”")
    .replace(/(^|[\s([{“—–-])'(?=\S)/g, "$1‘").replace(/'/g, "’")
    .replace(/ -- /g, " — ");
}

function omml(latex, display = false) {
  try {
    const mathml = katex.renderToString(latex, { output: "mathml", throwOnError: false, strict: "ignore", displayMode: display })
      .replace(/^<span class="katex">/, "").replace(/<\/span>$/, "")
      .replace(/<annotation[\s\S]*?<\/annotation>/g, "");
    const xml = mml2omml(mathml).replace(/\s+xmlns:\w+="[^"]*"/g, "");
    return ImportedXmlComponent.fromXmlString(display ? `<m:oMathPara>${xml}</m:oMathPara>` : xml);
  } catch {
    return null;
  }
}

class Builder {
  constructor(doc, theme, charts) {
    this.doc = doc;
    this.theme = theme;
    this.c = theme.colors;
    this.f = theme.fonts.docx;
    this.t = theme.type;
    this.l = theme.layout;
    this.charts = charts;
    this.chartIndex = 0;
    this.lists = 0;
    this.tables = 0;
    this.figures = 0;
    this.equations = 0;
    const [w, h] = PAGE[doc.page?.size] || PAGE.A4;
    const landscape = doc.page?.orientation === "landscape";
    this.pageW = landscape ? h : w;
    this.pageH = landscape ? w : h;
    const [mt, mr, mb, ml] = this.l.margins;
    this.margins = { top: Math.round(mt * MM), right: Math.round(mr * MM), bottom: Math.round(mb * MM), left: Math.round(ml * MM) };
    this.contentW = this.pageW - this.margins.left - this.margins.right;
    this.labels = ["lab", "academic", "apa", "mla"].includes(theme.name) || (doc.blocks || []).filter((b) => b.type === "table" || b.type === "chart").length >= 3;
  }

  runs(text, base = {}) {
    const out = [];
    for (const run of parseInline(text)) {
      if (run.math) {
        const math = omml(run.text);
        if (math) {
          out.push(math);
          continue;
        }
      }
      const options = {
        text: run.code ? run.text : smart(run.text),
        bold: base.bold || run.bold || undefined,
        italics: base.italics || run.italic || undefined,
        strike: run.strike || undefined,
        superScript: run.sup || undefined,
        subScript: run.sub || undefined,
        font: run.code ? this.f.mono : base.font,
        size: base.size ? hp(base.size) : run.code ? hp(this.t.base * 0.9) : undefined,
        color: base.color || (run.bold && !this.l.plain ? this.c.ink : undefined),
        allCaps: base.allCaps,
        smallCaps: base.smallCaps,
        characterSpacing: base.spacing
      };
      if (run.href) out.push(new ExternalHyperlink({ link: run.href, children: [new TextRun({ ...options, color: this.c.accent, underline: this.l.plain ? {} : undefined })] }));
      else if (options.text.includes("\n")) {
        // Hard line breaks inside a paragraph (address blocks, poem lines) keep the run's format.
        options.text.split("\n").forEach((part, i) => out.push(new TextRun({ ...options, text: part, ...(i ? { break: 1 } : {}) })));
      } else out.push(new TextRun(options));
    }
    return out;
  }

  para(text, options = {}, runBase = {}) {
    return new Paragraph({ children: this.runs(text, runBase), ...options });
  }

  label(text, { color = this.c.muted, size = this.t.base * 0.74, spacing = 30 } = {}) {
    return new TextRun({ text: plain(text).toUpperCase(), bold: true, color, size: hp(size), font: this.f.label, characterSpacing: spacing });
  }

  // Rich text: paragraphs, lists and display math inside callouts, cards and problems.
  rich(text, { size, color, after = 80, prefix = null, style, italics } = {}) {
    const out = [];
    let lead = prefix;
    const takePrefix = () => {
      const value = lead || [];
      lead = null;
      return value;
    };
    for (const block of textBlocks(text)) {
      if (block.type === "list") {
        const reference = block.style === "number" ? "numbers" : "bullets";
        const instance = this.lists++;
        for (const item of block.items) {
          const value = typeof item === "string" ? item : item.text;
          const prefix = block.style === "check" ? [new TextRun({ text: item.checked ? "☒ " : "☐ ", font: "Segoe UI Symbol" })] : [];
          out.push(new Paragraph({
            children: [...takePrefix(), ...prefix, ...this.runs(value, { size, color, italics })],
            ...(block.style === "check" ? { indent: { left: 0 } } : { numbering: { reference, level: 0, instance } }),
            spacing: { after: 40 }
          }));
        }
      } else if (block.type === "equation") {
        const math = omml(block.latex, true);
        out.push(new Paragraph({ children: [...takePrefix(), ...(math ? [math] : [new TextRun(block.latex)])], alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 } }));
      } else {
        out.push(new Paragraph({ children: [...takePrefix(), ...this.runs(block.text, { size, color, italics })], spacing: { after }, ...(style ? { style } : {}) }));
      }
    }
    if (!out.length) out.push(new Paragraph({ children: takePrefix() }));
    return out;
  }

  border(color, size = 4) {
    return { style: BorderStyle.SINGLE, size, color };
  }

  box(children, { fill, left, all, padding = 140, width = this.contentW } = {}) {
    const borders = { top: NONE, bottom: NONE, left: NONE, right: NONE };
    if (all) Object.assign(borders, { top: all, bottom: all, left: all, right: all });
    if (left) borders.left = left;
    return new Table({
      width: { size: width, type: WidthType.DXA },
      columnWidths: [width],
      layout: TableLayoutType.FIXED,
      borders: NO_BORDERS,
      rows: [new TableRow({
        cantSplit: true,
        children: [new TableCell({
          children,
          borders,
          shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
          margins: { top: padding, bottom: padding, left: padding + 40, right: padding + 40 }
        })]
      })]
    });
  }

  spacer(after = 120) {
    return new Paragraph({ children: [], spacing: { before: 0, after }, style: "Tight" });
  }

  titleBlock() {
    const { doc, c, t, l } = this;
    const out = [];
    const meta = doc.meta || [];
    if (l.titleBlock === "mla") {
      const lines = meta.length ? meta.map((item) => item.value) : [doc.author, doc.date].filter(Boolean);
      for (const value of lines) out.push(this.para(value, { indent: { firstLine: 0 }, spacing: { after: 0 } }));
      if (doc.title) out.push(this.para(doc.title, { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { after: 0 } }));
      return out;
    }
    if (l.titleBlock === "apa") {
      for (let i = 0; i < 4; i += 1) out.push(new Paragraph({ children: [], indent: { firstLine: 0 } }));
      out.push(this.para(doc.title || "", { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { after: 480 } }, { bold: true }));
      if (doc.subtitle) out.push(this.para(doc.subtitle, { alignment: AlignmentType.CENTER, indent: { firstLine: 0 } }));
      const lines = meta.length ? meta.map((item) => item.value) : [doc.author, doc.date].filter(Boolean);
      for (const value of lines) out.push(this.para(value, { alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { after: 0 } }));
      out.push(new Paragraph({ children: [new PageBreak()] }));
      if (doc.title) out.push(this.para(doc.title, { alignment: AlignmentType.CENTER, indent: { firstLine: 0 } }, { bold: true }));
      return out;
    }
    if (l.titleBlock === "cv" || l.titleBlock === "letterhead") {
      const align = l.titleBlock === "cv" && l.cvAlign !== "left" ? AlignmentType.CENTER : AlignmentType.LEFT;
      const contact = doc.contact?.length ? doc.contact : meta.map((item) => item.value);
      out.push(this.para(doc.title || doc.author || "", { alignment: align, spacing: { after: 40 } }, { bold: true, size: t.title, font: this.f.heading, color: this.theme.name === "cv_modern" ? c.accent : c.ink }));
      if (doc.subtitle) out.push(this.para(doc.subtitle, { alignment: align, spacing: { after: 40 } }, { color: c.muted, size: t.base * 1.02 }));
      if (contact.length) {
        const separator = this.theme.name === "cv" ? "  ◇  " : l.titleBlock === "letterhead" ? "  ·  " : "  |  ";
        const children = [];
        contact.forEach((item, i) => {
          if (i) children.push(new TextRun({ text: separator, color: c.faint, size: hp(t.base * 0.93) }));
          children.push(...this.runs(item, { size: t.base * (l.titleBlock === "letterhead" ? 0.85 : 0.93), color: l.titleBlock === "letterhead" ? c.muted : c.text }));
        });
        out.push(new Paragraph({
          children,
          alignment: align,
          spacing: { after: l.titleBlock === "letterhead" ? 480 : 120 },
          border: l.titleBlock === "letterhead" ? { bottom: this.border(c.accent, 8) } : undefined
        }));
      }
      return out;
    }
    if (!doc.title && !doc.subtitle && !doc.kicker && !meta.length) return out;
    const center = l.titleBlock === "center";
    const align = center ? AlignmentType.CENTER : AlignmentType.LEFT;
    if (doc.kicker) out.push(new Paragraph({ children: [this.label(doc.kicker, { color: c.accent, size: t.base * 0.8, spacing: 40 })], alignment: align, spacing: { after: 120 } }));
    if (doc.title) out.push(this.para(doc.title, { style: "Title", alignment: align }));
    if (doc.subtitle) out.push(this.para(doc.subtitle, { style: "Subtitle", alignment: align }, center ? { italics: true } : {}));
    if (!meta.length && (doc.author || doc.date)) out.push(this.para([doc.author, doc.date].filter(Boolean).join(" · "), { alignment: align, spacing: { after: 200 } }, { color: c.muted }));
    if (l.titleRule && !center) out.push(new Paragraph({ children: [], border: { bottom: this.border(c.ink, this.theme.name === "briefing" ? 18 : 10) }, spacing: { before: 120, after: 160 } }));
    if (meta.length) {
      const cols = Math.min(4, meta.length);
      const rows = [];
      for (let i = 0; i < meta.length; i += cols) rows.push(meta.slice(i, i + cols));
      const width = Math.floor(this.contentW / cols);
      out.push(new Table({
        width: { size: this.contentW, type: WidthType.DXA },
        columnWidths: Array(cols).fill(width),
        layout: TableLayoutType.FIXED,
        borders: NO_BORDERS,
        alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
        rows: rows.map((row) => new TableRow({
          children: Array.from({ length: cols }, (_, i) => new TableCell({
            borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
            margins: { top: 20, bottom: 60, left: 0, right: 120 },
            children: row[i] ? [
              ...(row[i].label ? [new Paragraph({ children: [this.label(row[i].label, { size: t.base * 0.72 })], alignment: align, spacing: { after: 20 } })] : []),
              this.para(row[i].value, { alignment: align, spacing: { after: 0 } }, { color: c.ink, size: t.base * 0.95 })
            ] : [new Paragraph({ children: [] })]
          }))
        }))
      }));
      out.push(this.spacer(200));
    } else {
      out.push(this.spacer(120));
    }
    return out;
  }

  heading(block, number) {
    const { c, t, l } = this;
    const level = block.level;
    const children = [];
    if (number) children.push(new TextRun({ text: `${number}  `, color: l.plain ? undefined : c.faint }));
    children.push(...this.runs(block.text));
    const tag = block.tag && level === 1 && !l.plain;
    if (tag) {
      children.push(new TextRun({ text: "\t" }));
      children.push(this.label(block.tag, { size: t.base * 0.74 }));
    }
    const ruled = level === 1 && (l.headingRule === "below" || l.cv);
    return new Paragraph({
      children,
      style: `Heading${level}`,
      tabStops: tag ? [{ type: TabStopType.RIGHT, position: this.contentW }] : undefined,
      border: ruled ? { bottom: this.border(l.cv && this.theme.name === "cv" ? c.ink : c.rule, 6), ...(l.headingRule === "above" ? {} : {}) } : undefined,
      alignment: (this.theme.name === "apa" && level === 1) || (this.theme.name === "mla" && level === 1) ? AlignmentType.CENTER : undefined
    });
  }

  list(block) {
    const instance = this.lists++;
    const out = [];
    const reference = block.style === "number" ? "numbers" : "bullets";
    const flat = [];
    const walk = (items, depth) => {
      for (const item of items) {
        flat.push({ item, depth });
        if (typeof item === "object" && item.items?.length) walk(item.items, depth + 1);
      }
    };
    walk(block.items, 0);
    flat.forEach(({ item, depth }, index) => {
      const text = typeof item === "string" ? item : item.text;
      const spacing = { after: index === flat.length - 1 ? 160 : 60 };
      if (block.style === "check" && depth === 0) {
        out.push(new Paragraph({
          children: [new TextRun({ text: item.checked ? "☒  " : "☐  ", font: "Segoe UI Symbol", color: this.c.muted }), ...this.runs(text)],
          indent: { left: 360, hanging: 360 },
          spacing
        }));
      } else {
        out.push(new Paragraph({
          children: this.runs(text),
          numbering: { reference: block.style === "check" ? "bullets" : reference, level: Math.min(depth, 2), instance },
          spacing
        }));
      }
    });
    return out;
  }

  table(block) {
    const { c, t, l } = this;
    this.tables += 1;
    const aligns = columnAlignments(block);
    const weights = columnWeights(block);
    const total = weights.reduce((sum, value) => sum + value, 0);
    const widths = weights.map((weight) => Math.floor((weight / total) * this.contentW));
    const style = l.tableStyle;
    const highlight = new Set(Array.isArray(block.highlight) ? block.highlight : block.highlight !== undefined ? [block.highlight] : []);
    const size = this.l.plain && !this.l.cv ? t.base : t.base * 0.88;
    const align = (i) => (aligns[i] === "right" ? AlignmentType.RIGHT : aligns[i] === "center" ? AlignmentType.CENTER : AlignmentType.LEFT);
    const font = ["lab", "homework"].includes(this.theme.name) ? this.f.label : undefined;
    const rule = this.border(c.rule, 4);
    const strong = this.border(c.ink, style === "rules" ? 12 : 8);
    const out = [];
    if (block.caption) {
      out.push(new Paragraph({
        children: [...(this.labels ? [new TextRun({ text: `Table ${this.tables}. `, bold: true, color: c.accent, size: hp(t.base * 0.86), font: this.f.label })] : []), ...this.runs(block.caption, { bold: true, size: t.base * 0.86, font: this.f.label, color: c.ink })],
        keepNext: true,
        spacing: { before: 160, after: 80 }
      }));
    }
    const hasHeader = block.columns.some((column) => (typeof column === "string" ? column : column.label));
    const rows = [];
    if (hasHeader) {
      rows.push(new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: block.columns.map((column, i) => new TableCell({
          width: { size: widths[i], type: WidthType.DXA },
          shading: style === "dark" || style === "light" ? { type: ShadingType.CLEAR, fill: c.tableHead, color: "auto" } : style === "grid" ? { type: ShadingType.CLEAR, fill: c.surface, color: "auto" } : undefined,
          borders: style === "grid" ? { top: rule, bottom: rule, left: rule, right: rule } : { top: style === "rules" ? strong : NONE, bottom: style === "rules" || style === "light" ? this.border(c.ink, 6) : NONE, left: NONE, right: NONE },
          margins: { top: 90, bottom: 90, left: 120, right: 120 },
          verticalAlign: VerticalAlign.BOTTOM,
          children: [new Paragraph({ children: this.runs(typeof column === "string" ? column : column.label, { bold: true, size: size * 0.95, color: style === "dark" ? c.tableHeadText : c.ink, font: this.f.label }), alignment: align(i), spacing: { after: 0, line: 252 } })]
        }))
      }));
    }
    block.rows.forEach((row, r) => {
      const isTotal = block.total && r === block.rows.length - 1;
      const stripe = (style === "dark" || style === "light") && r % 2 === 1 ? c.stripe : null;
      const fill = highlight.has(r) ? tint(c.accent, 0.9) : stripe;
      rows.push(new TableRow({
        cantSplit: true,
        children: row.map((cell, i) => new TableCell({
          width: { size: widths[i], type: WidthType.DXA },
          shading: fill && !isTotal ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
          borders: style === "grid"
            ? { top: rule, bottom: rule, left: rule, right: rule }
            : { top: isTotal ? this.border(c.ink, 8) : NONE, bottom: style === "rules" ? (r === block.rows.length - 1 ? strong : NONE) : rule, left: NONE, right: NONE },
          margins: { top: block.compact ? 50 : 80, bottom: block.compact ? 50 : 80, left: 120, right: 120 },
          children: [new Paragraph({ children: this.runs(cell, { size, bold: isTotal || (i === 0 && !this.l.plain) || undefined, color: i === 0 || isTotal ? c.ink : undefined, font }), alignment: align(i), spacing: { after: 0, line: 252 } })]
        }))
      }));
    });
    out.push(new Table({ width: { size: this.contentW, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, borders: NO_BORDERS, rows }));
    const note = [block.note, block.source ? `Source: ${block.source}` : ""].filter(Boolean).join(" ");
    out.push(note ? this.para(note, { spacing: { before: 80, after: 220 } }, { size: t.base * 0.8, color: c.muted }) : this.spacer(200));
    return out;
  }

  chart(block) {
    const { c, t } = this;
    const image = this.charts[this.chartIndex++];
    if (!image) return [];
    this.figures += 1;
    const out = [];
    const lab = ["lab", "academic"].includes(this.theme.name) || this.l.plain;
    if ((block.title || block.caption) && !lab) {
      out.push(this.para(block.title || block.caption, { keepNext: true, spacing: { before: 160, after: block.title && block.caption ? 20 : 100 } }, { bold: true, color: c.ink, size: t.base * 0.95, font: this.f.label }));
      if (block.title && block.caption) out.push(this.para(block.caption, { keepNext: true, spacing: { after: 100 } }, { size: t.base * 0.82, color: c.muted }));
    }
    const widthPx = Math.round(this.contentW / 15);
    const heightPx = Math.round((image.height / image.width) * widthPx);
    out.push(new Paragraph({ children: [new ImageRun({ type: "png", data: image.png, transformation: { width: widthPx, height: heightPx }, altText: { title: plain(block.title || "Chart"), description: plain(block.caption || block.title || "Chart"), name: "chart" } })], keepNext: Boolean(lab || block.note || block.source), spacing: { after: 60 } }));
    if (lab && (block.title || block.caption)) {
      out.push(new Paragraph({ children: [...(this.labels ? [new TextRun({ text: `Figure ${this.figures}. `, bold: true, size: hp(t.base * 0.86), font: this.f.label, color: c.ink })] : []), ...this.runs([block.title, block.caption].filter(Boolean).join(". "), { size: t.base * 0.86, color: c.muted })], spacing: { after: 160 } }));
    }
    const note = [block.note, block.source ? `Source: ${block.source}` : ""].filter(Boolean).join(" ");
    out.push(note ? this.para(note, { spacing: { after: 220 } }, { size: t.base * 0.8, color: c.muted }) : this.spacer(160));
    return out;
  }

  calloutColor(variant) {
    const c = this.c;
    return { tip: c.accent2, example: c.accent2, important: c.warn, warning: c.negative, success: c.positive, abstract: c.ink }[variant] || c.accent;
  }

  callout(block) {
    const color = this.calloutColor(block.variant);
    const titles = { tip: "Tip", important: "Important", warning: "Warning", example: "Example", definition: "Definition", summary: "Summary", success: "Result", abstract: "Abstract" };
    const title = block.title || titles[block.variant] || "";
    const children = [];
    if (title) children.push(new Paragraph({ children: [this.label(title, { color, size: this.t.base * 0.8 })], spacing: { after: 60 } }));
    children.push(...this.rich(block.text));
    const style = this.l.calloutStyle;
    if (style === "plain") return [...children, this.spacer(120)];
    const fill = block.variant === "abstract" ? this.c.surface : tint(color, 0.94);
    return [this.box(children, style === "bar" ? { fill, left: this.border(color, 24) } : { fill, all: this.border(tint(color, 0.6), 6) }), this.spacer(200)];
  }

  stats(block) {
    const { c, t } = this;
    const n = block.items.length;
    const gap = 140;
    const width = Math.floor((this.contentW - gap * (n - 1)) / n);
    const cells = [];
    const tones = { negative: c.negative, positive: c.positive, warn: c.warn };
    block.items.forEach((item, i) => {
      if (i) cells.push(new TableCell({ width: { size: gap, type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children: [new Paragraph({ children: [] })] }));
      const color = tones[item.tone] || c.accent;
      cells.push(new TableCell({
        width: { size: width, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: c.surface, color: "auto" },
        borders: { top: this.border(color, 18), bottom: NONE, left: NONE, right: NONE },
        margins: { top: 120, bottom: 120, left: 160, right: 120 },
        children: [
          this.para(item.value, { spacing: { after: 40 } }, { bold: true, size: t.base * 1.75, color: tones[item.tone] || c.ink, font: this.f.heading }),
          new Paragraph({ children: [this.label(item.label, { size: t.base * 0.72 })], spacing: { after: item.note ? 20 : 0 } }),
          ...(item.note ? [this.para(item.note, { spacing: { after: 0 } }, { size: t.base * 0.78, color: c.muted })] : [])
        ]
      }));
    });
    const widths = cells.map((_, i) => (i % 2 ? gap : width));
    return [new Table({ width: { size: this.contentW, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, borders: NO_BORDERS, rows: [new TableRow({ cantSplit: true, children: cells })] }), this.spacer(220)];
  }

  cards(block) {
    const { c, t } = this;
    const cols = Math.min(block.columns || 2, block.items.length);
    const gap = 160;
    const width = Math.floor((this.contentW - gap * (cols - 1)) / cols);
    const rows = [];
    for (let i = 0; i < block.items.length; i += cols) {
      const cells = [];
      for (let j = 0; j < cols; j += 1) {
        const item = block.items[i + j];
        if (j) cells.push(new TableCell({ width: { size: gap, type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children: [new Paragraph({ children: [] })] }));
        const rule = this.border(c.rule, 6);
        cells.push(new TableCell({
          width: { size: width, type: WidthType.DXA },
          borders: item ? { top: rule, bottom: rule, left: rule, right: rule } : { top: NONE, bottom: NONE, left: NONE, right: NONE },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          children: item ? [
            new Paragraph({
              children: [...this.runs(item.title, { bold: true, color: c.ink, font: this.f.heading, size: t.base * 1.02 }), ...(item.tag ? [new TextRun({ text: "\t" }), this.label(item.tag, { color: c.accent, size: t.base * 0.7 })] : [])],
              tabStops: item.tag ? [{ type: TabStopType.RIGHT, position: width - 330 }] : undefined,
              spacing: { after: 60 }
            }),
            ...this.rich(item.text, { size: t.base * 0.94, after: 60 })
          ] : [new Paragraph({ children: [] })]
        }));
      }
      rows.push(new TableRow({ cantSplit: true, children: cells }));
      if (i + cols < block.items.length) rows.push(new TableRow({ height: { value: gap, rule: HeightRule.EXACT }, children: Array.from({ length: cols * 2 - 1 }, () => new TableCell({ borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children: [new Paragraph({ children: [], spacing: { after: 0, line: 120 } })] })) }));
    }
    const widths = Array.from({ length: cols * 2 - 1 }, (_, i) => (i % 2 ? gap : width));
    return [new Table({ width: { size: this.contentW, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, borders: NO_BORDERS, rows }), this.spacer(220)];
  }

  steps(block) {
    const { c, t } = this;
    const numW = 620;
    const rows = block.items.map((item, i) => new TableRow({
      cantSplit: true,
      children: [
        new TableCell({ width: { size: numW, type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, margins: { top: 40, bottom: 120, left: 0, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: String(i + 1).padStart(2, "0"), bold: true, color: c.accent, size: hp(t.base * 1.3), font: this.f.heading })] })] }),
        new TableCell({
          width: { size: this.contentW - numW, type: WidthType.DXA },
          borders: { top: NONE, bottom: i < block.items.length - 1 ? this.border(c.rule, 4) : NONE, left: NONE, right: NONE },
          margins: { top: 40, bottom: 140, left: 0, right: 0 },
          children: [...(item.title ? [this.para(item.title, { spacing: { after: 40 } }, { bold: true, color: c.ink, font: this.f.heading, size: t.base * 1.02 })] : []), ...this.rich(item.text, { after: 40 })]
        })
      ]
    }));
    return [new Table({ width: { size: this.contentW, type: WidthType.DXA }, columnWidths: [numW, this.contentW - numW], layout: TableLayoutType.FIXED, borders: NO_BORDERS, rows }), this.spacer(200)];
  }

  fields(block) {
    const { c, t } = this;
    if (this.l.cv) {
      return block.items.map((item) => new Paragraph({ children: [...this.runs(item.label, { bold: true, color: c.ink }), new TextRun({ text: ": " , bold: true }), ...this.runs(item.value)], spacing: { after: 20 } }));
    }
    const cols = block.columns || 1;
    const labelW = Math.floor((this.contentW / cols) * (cols === 1 ? 0.3 : 0.4));
    const valueW = Math.floor(this.contentW / cols) - labelW;
    const rows = [];
    for (let i = 0; i < block.items.length; i += cols) {
      const cells = [];
      for (let j = 0; j < cols; j += 1) {
        const item = block.items[i + j];
        const rule = this.border(c.rule, 4);
        // A boxed block is a tinted key-value panel.
        const shading = block.boxed ? { type: ShadingType.CLEAR, fill: tint(c.accent2, 0.93), color: "auto" } : undefined;
        cells.push(new TableCell({ width: { size: labelW, type: WidthType.DXA }, shading, borders: { top: NONE, left: NONE, right: NONE, bottom: rule }, margins: { top: 70, bottom: 70, left: 60, right: 120 }, children: [this.para(item?.label || "", { spacing: { after: 0 } }, { bold: true, color: c.ink, size: t.base * 0.86, font: this.f.label })] }));
        cells.push(new TableCell({ width: { size: valueW, type: WidthType.DXA }, shading, borders: { top: NONE, left: NONE, right: NONE, bottom: item && !item.value ? this.border(c.muted, 6) : rule }, margins: { top: 70, bottom: 70, left: 60, right: 160 }, children: [this.para(item?.value || "", { spacing: { after: 0 } })] }));
      }
      rows.push(new TableRow({ cantSplit: true, children: cells }));
    }
    const widths = Array.from({ length: cols * 2 }, (_, i) => (i % 2 ? valueW : labelW));
    return [new Table({ width: { size: this.contentW, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, borders: { ...NO_BORDERS, top: this.border(block.boxed ? tint(c.accent2, 0.6) : c.rule, 4), ...(block.boxed ? { bottom: this.border(tint(c.accent2, 0.6), 4), left: this.border(tint(c.accent2, 0.6), 4), right: this.border(tint(c.accent2, 0.6), 4) } : {}) }, rows }), this.spacer(200)];
  }

  problem(block) {
    const { c, t } = this;
    const head = new Paragraph({
      children: [
        ...(block.label ? [new TextRun({ text: ` ${plain(block.label).toUpperCase()} `, bold: true, color: "FFFFFF", size: hp(t.base * 0.74), font: this.f.label, characterSpacing: 20, shading: { type: ShadingType.CLEAR, fill: c.accent, color: "auto" } }), new TextRun({ text: "  " })] : []),
        ...this.runs(block.title || "", { bold: true, color: c.ink, font: this.f.heading, size: t.h2 })
      ],
      keepNext: true,
      spacing: { before: 320, after: 120 }
    });
    return block.text ? [head, this.box(this.rich(block.text, { after: 60 }), { fill: c.surface, padding: 120 }), this.spacer(120)] : [head];
  }

  answer(block) {
    const { c, t } = this;
    const children = this.rich(block.text, { after: 0, prefix: [this.label(block.label, { color: c.accent2, size: t.base * 0.72 }), new TextRun({ text: "    " })] });
    return [this.box(children, { fill: tint(c.accent2, 0.93), all: this.border(c.accent2, 8), padding: 100 }), this.spacer(220)];
  }

  entry(block) {
    const { c, t } = this;
    const tab = [{ type: TabStopType.RIGHT, position: this.contentW }];
    const out = [];
    const modern = this.theme.name === "cv_modern";
    const line = (left, right, options = {}) => new Paragraph({ children: [...left, ...(right ? [new TextRun({ text: "\t" }), ...right] : [])], tabStops: tab, keepNext: true, spacing: { after: 10 }, ...options });
    const muted = modern ? c.muted : c.text;
    if (modern && block.org) {
      out.push(line([...this.runs(block.title || "", { bold: true, color: c.ink }), ...(block.title ? [new TextRun({ text: " · ", color: c.muted })] : []), ...this.runs(block.org, { color: c.muted })], block.dates ? this.runs(block.dates, { color: c.muted }) : null));
      if (block.subtitle || block.location) out.push(line(this.runs(block.subtitle || "", { color: c.muted }), block.location ? this.runs(block.location, { color: c.muted }) : null));
    } else if (block.org) {
      out.push(line(this.runs(block.org, { bold: true, color: c.ink }), block.location ? this.runs(block.location) : null));
      if (block.title || block.dates) out.push(line(this.runs(block.title || "", { italics: this.theme.name === "cv" }), block.dates ? this.runs(block.dates, { color: muted }) : null));
      if (block.subtitle) out.push(this.para(block.subtitle, { keepNext: true, spacing: { after: 10 } }, { italics: true }));
    } else {
      out.push(line(this.runs(block.title || "", { bold: true, color: c.ink }), block.dates ? this.runs(block.dates, { color: muted }) : null));
      if (block.location || block.subtitle) out.push(line(this.runs(block.subtitle || block.location || "", { italics: true }), null));
    }
    if (block.text) out.push(this.para(block.text, { spacing: { after: 20 } }));
    const instance = this.lists++;
    block.bullets.forEach((item) => out.push(new Paragraph({ children: this.runs(item), numbering: { reference: "cvbullets", level: 0, instance }, spacing: { after: 20 } })));
    out.push(this.spacer(this.t.base * 8));
    return out;
  }

  references(block, previous) {
    const out = [];
    const heading = block.title || (previous?.type === "heading" ? "" : this.theme.name === "mla" ? "Works Cited" : "References");
    if (heading) {
      out.push(this.theme.name === "mla"
        ? this.para(heading, { alignment: AlignmentType.CENTER, pageBreakBefore: true, indent: { firstLine: 0 } })
        : this.heading({ text: heading, level: 1 }, ""));
    }
    for (const item of block.items) {
      out.push(this.para(item, { indent: { left: 720, hanging: 720 }, spacing: { after: this.l.plain ? 0 : 100 } }, { size: this.l.plain ? this.t.base : this.t.base * 0.9 }));
    }
    return out;
  }

  block(block, number, previous) {
    const { c, t } = this;
    switch (block.type) {
      case "heading": return [this.heading(block, number)];
      case "paragraph": return [this.para(block.text, {
        style: block.lead ? "Lead" : undefined,
        alignment: block.align === "center" ? AlignmentType.CENTER : block.align === "right" ? AlignmentType.RIGHT : block.align === "justify" ? AlignmentType.JUSTIFIED : undefined,
        ...(block.align ? { indent: { firstLine: 0 } } : {})
      })];
      case "list": return this.list(block);
      case "table": return this.table(block);
      case "chart": return this.chart(block);
      case "callout": return this.callout(block);
      case "quote": return [
        ...this.rich(block.text, { style: "Quote" }),
        ...(block.cite ? [this.para(`— ${block.cite}`, { style: "Quote", spacing: { after: 200 } }, { italics: false, size: t.base * 0.85, color: c.muted })] : [])
      ];
      case "equation": {
        this.equations += 1;
        const math = omml(block.latex, false);
        const numbered = this.l.numberEquations;
        return [new Paragraph({
          children: numbered ? [new TextRun({ text: "\t" }), ...(math ? [math] : [new TextRun(block.latex)]), new TextRun({ text: `\t(${this.equations})`, color: c.muted })] : [...(math ? [math] : [new TextRun(block.latex)])],
          alignment: numbered ? AlignmentType.LEFT : AlignmentType.CENTER,
          tabStops: numbered ? [{ type: TabStopType.CENTER, position: Math.round(this.contentW / 2) }, { type: TabStopType.RIGHT, position: this.contentW }] : undefined,
          spacing: { before: 120, after: 160 },
          indent: { firstLine: 0 }
        })];
      }
      case "code": return [new Paragraph({
        children: block.text.split("\n").flatMap((lineText, i) => [...(i ? [new TextRun({ break: 1 })] : []), new TextRun({ text: lineText || " ", font: this.f.mono, size: hp(t.base * 0.84) })]),
        shading: { type: ShadingType.CLEAR, fill: c.surface, color: "auto" },
        border: { top: this.border(c.rule), bottom: this.border(c.rule), left: this.border(c.rule), right: this.border(c.rule) },
        spacing: { before: 60, after: 200, line: 264 },
        indent: { firstLine: 0 }
      })];
      case "stats": return this.stats(block);
      case "cards": return this.cards(block);
      case "steps": return this.steps(block);
      case "fields": return this.fields(block);
      case "problem": return this.problem(block);
      case "answer": return this.answer(block);
      case "entry": return this.entry(block);
      case "references": return this.references(block, previous);
      case "figure": {
        const match = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(block.src || "");
        if (!match) return [];
        this.figures += 1;
        const width = Math.round((this.contentW / 15) * (block.width || 100) / 100);
        return [
          new Paragraph({ children: [new ImageRun({ type: match[1].toLowerCase().startsWith("jp") ? "jpg" : match[1].toLowerCase(), data: Buffer.from(match[2], "base64"), transformation: { width, height: Math.round(width * 0.6) } })], alignment: AlignmentType.CENTER }),
          ...(block.caption ? [this.para(block.caption, { alignment: AlignmentType.CENTER, spacing: { after: 200 } }, { size: t.base * 0.86, color: c.muted })] : [])
        ];
      }
      case "divider": return [new Paragraph({ children: [], border: { bottom: this.border(c.rule, 6) }, spacing: { before: 120, after: 240 } })];
      case "page_break": return [new Paragraph({ children: [new PageBreak()] })];
      case "toc": {
        const heads = (this.doc.blocks || []).filter((entry) => entry.type === "heading" && entry.level === 1);
        if (!heads.length) return [];
        const children = [new Paragraph({ children: [this.label("Contents")], spacing: { after: 80 } }), ...heads.map((entry, i) => this.para(`${i + 1}. ${entry.text}`, { spacing: { after: 30 } }))];
        return [this.box(children, { fill: c.surface }), this.spacer(200)];
      }
      default: return [];
    }
  }

  headerFooter() {
    const { doc, c, t, l } = this;
    const slots = (kind) => {
      const out = { left: "", center: "", right: "" };
      if (kind === "header") {
        if (l.header === "surname-page") out.right = `${String(doc.author || "").replace(/,.*$/, "").trim().split(/\s+/).pop() || ""} {page}`.trim();
        if (l.header === "page-right") out.right = "{page}";
      } else if (l.footer === "title-page") {
        out.left = plain(doc.title || "");
        out.right = "Page {page} of {pages}";
      } else if (l.footer === "title-section-page") {
        out.left = plain(doc.kicker || doc.title || "");
        out.center = doc.kicker ? plain(doc.title || "") : "";
        out.right = "Page {page} of {pages}";
      } else if (l.footer === "page-center") {
        out.center = "{page}";
      }
      const custom = doc[kind];
      for (const slot of ["left", "center", "right"]) if (custom) out[slot] = custom[slot] ?? "";
      return out;
    };
    const runsFor = (template, size, color) => String(template).split(/(\{page\}|\{pages\}|\{title\}|\{author\})/g).filter(Boolean).map((part) => {
      const base = { size: hp(size), color, font: l.plain ? this.f.body : this.f.label };
      if (part === "{page}") return new TextRun({ ...base, children: [PageNumber.CURRENT] });
      if (part === "{pages}") return new TextRun({ ...base, children: [PageNumber.TOTAL_PAGES] });
      return new TextRun({ ...base, text: part === "{title}" ? plain(doc.title || "") : part === "{author}" ? plain(doc.author || "") : part });
    });
    const line = (values, kind) => {
      const size = l.plain ? t.base : t.base * 0.78;
      const color = l.plain ? c.text : c.muted;
      const children = [];
      if (values.left) children.push(...runsFor(values.left, size, color));
      if (values.center) children.push(new TextRun({ text: "\t" }), ...runsFor(values.center, size, color));
      if (values.right) children.push(new TextRun({ text: values.center ? "\t" : "\t\t" }), ...runsFor(values.right, size, color));
      if (!children.length) return null;
      return new Paragraph({
        children,
        style: "RunningText",
        tabStops: [{ type: TabStopType.CENTER, position: Math.round(this.contentW / 2) }, { type: TabStopType.RIGHT, position: this.contentW }],
        border: kind === "footer" && !l.plain ? { top: this.border(c.rule, 4) } : undefined,
        spacing: kind === "footer" ? { before: 120 } : { after: 120 },
        indent: { firstLine: 0 }
      });
    };
    const header = line(slots("header"), "header");
    const footer = line(slots("footer"), "footer");
    const firstEmpty = !(l.header === "surname-page" || l.header === "page-right");
    return {
      headers: header ? { default: new Header({ children: [header] }), ...(firstEmpty ? { first: new Header({ children: [] }) } : {}) } : undefined,
      footers: footer ? { default: new Footer({ children: [footer] }) } : undefined,
      titlePage: Boolean(header && firstEmpty)
    };
  }

  styles() {
    const { c, f, t, l } = this;
    const line = Math.round(240 * t.line * (l.plain ? 1 : 0.94));
    const after = Math.round(t.base * 20 * (t.paragraphGap ?? 0.62));
    const caps = t.headingCase === "upper" ? { allCaps: true } : t.headingCase === "smallcaps" ? { smallCaps: true } : {};
    const tracking = t.tracking ? Math.round(t.tracking * t.h1 * 20) : undefined;
    const justify = l.justify ?? (this.theme.name === "academic" || this.theme.name === "lab");
    const heading = (id, name, size, level, extra = {}) => ({
      id, name, basedOn: "Normal", next: "Normal", quickFormat: true,
      run: { font: f.heading, size: hp(size), bold: t.headingWeight >= 600, color: c.ink, ...extra.run },
      paragraph: { keepNext: true, keepLines: true, outlineLevel: level, spacing: { before: extra.before ?? Math.round(size * 20 * 1.3), after: extra.after ?? Math.round(size * 20 * 0.45), line: 264 }, indent: { firstLine: 0 }, alignment: AlignmentType.LEFT, ...extra.paragraph }
    });
    return {
      default: { document: { run: { font: f.body, size: hp(t.base), color: c.text } } },
      paragraphStyles: [
        { id: "Normal", name: "Normal", quickFormat: true, run: { font: f.body, size: hp(t.base), color: c.text }, paragraph: { spacing: { after, line }, ...(justify ? { alignment: AlignmentType.JUSTIFIED } : {}), ...(t.indent ? { indent: { firstLine: 720 } } : {}) } },
        { id: "Tight", name: "Tight", basedOn: "Normal", run: { size: 4 }, paragraph: { spacing: { before: 0, after: 0, line: 240 }, indent: { firstLine: 0 } } },
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: f.heading, size: hp(t.title), bold: true, color: c.ink }, paragraph: { spacing: { after: 100, line: 252 }, indent: { firstLine: 0 }, alignment: AlignmentType.LEFT } },
        { id: "Subtitle", name: "Subtitle", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: f.body, size: hp(t.subtitle), color: c.muted }, paragraph: { spacing: { after: 120, line: 288 }, indent: { firstLine: 0 }, alignment: AlignmentType.LEFT } },
        heading("Heading1", "Heading 1", t.h1, 0, { run: { ...caps, characterSpacing: tracking }, before: l.plain ? (l.cv ? 200 : 240) : undefined, after: l.cv ? 80 : undefined }),
        heading("Heading2", "Heading 2", t.h2, 1, { before: l.plain ? 240 : undefined }),
        heading("Heading3", "Heading 3", t.h3, 2, { run: { color: l.plain ? c.ink : c.accent, ...(["briefing", "lab"].includes(this.theme.name) ? { allCaps: true, characterSpacing: 16 } : {}), ...(this.theme.name === "apa" ? { italics: true } : {}) }, before: l.plain ? 240 : undefined }),
        { id: "Lead", name: "Lead", basedOn: "Normal", run: { size: hp(t.base * 1.12), color: c.ink }, paragraph: { spacing: { after: Math.round(after * 1.2) } } },
        { id: "Quote", name: "Quote", basedOn: "Normal", run: { italics: !l.plain, color: l.plain ? c.text : c.ink, size: hp(l.plain ? t.base : t.base * 1.05) }, paragraph: { indent: { left: l.plain ? 720 : 360, firstLine: 0 }, border: l.plain ? undefined : { left: this.border(c.accent, 18) }, spacing: { before: 120, after: 120 } } },
        { id: "RunningText", name: "Running Text", basedOn: "Normal", run: { font: l.plain ? f.body : f.label, size: hp(l.plain ? t.base : t.base * 0.78), color: l.plain ? c.text : c.muted }, paragraph: { indent: { firstLine: 0 }, alignment: AlignmentType.LEFT, spacing: { after: 0, line: 240 } } },
        { id: "Caption", name: "Caption", basedOn: "Normal", run: { size: hp(t.base * 0.85), color: c.muted }, paragraph: { spacing: { after: 160 } } }
      ]
    };
  }

  numbering() {
    const { c, t } = this;
    const indent = (level) => ({ left: 360 + level * 360, hanging: 270 });
    const bulletLevels = ["•", "–", "▪"].map((text, level) => ({ level, format: LevelFormat.BULLET, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: indent(level) }, run: { color: this.l.plain ? c.text : c.accent } } }));
    const numberLevels = [[LevelFormat.DECIMAL, "%1."], [LevelFormat.LOWER_LETTER, "%2."], [LevelFormat.LOWER_ROMAN, "%3."]].map(([format, text], level) => ({ level, format, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: indent(level) }, run: { color: this.l.plain ? c.text : c.accent, bold: !this.l.plain } } }));
    return {
      config: [
        { reference: "bullets", levels: bulletLevels },
        { reference: "numbers", levels: numberLevels },
        { reference: "cvbullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 220 } }, run: { color: c.text } } }] }
      ]
    };
  }

  build() {
    const children = [...this.titleBlock()];
    const blocks = this.doc.blocks || [];
    const numbers = new Map();
    if (this.l.numberHeadings && !blocks.some((b) => b.type === "heading" && /^(\d+(\.\d+)*[.)]?|[IVX]+\.|[A-Z]\.)\s/.test(b.text))) {
      const counter = [0, 0];
      for (const b of blocks) {
        if (b.type !== "heading" || b.level > 2) continue;
        counter[b.level - 1] += 1;
        if (b.level === 1) counter[1] = 0;
        numbers.set(b.id, b.level === 1 ? `${counter[0]}.` : `${counter[0]}.${counter[1]}`);
      }
    }
    if (this.doc.toc && !blocks.some((b) => b.type === "toc")) children.push(...this.block({ type: "toc" }));
    blocks.forEach((block, i) => children.push(...this.block(block, numbers.get(block.id), blocks[i - 1])));
    const { headers, footers, titlePage } = this.headerFooter();
    return new Document({
      creator: "Klui",
      title: plain(this.doc.title || "Document"),
      description: plain(this.doc.subtitle || ""),
      styles: this.styles(),
      numbering: this.numbering(),
      features: {},
      sections: [{
        properties: {
          page: {
            size: { width: this.pageW, height: this.pageH, orientation: this.doc.page?.orientation === "landscape" ? "landscape" : "portrait" },
            margin: { ...this.margins, header: 500, footer: 500 }
          },
          titlePage
        },
        headers,
        footers,
        children
      }]
    });
  }
}

// charts: PNGs for the chart blocks, in document order (see chartImages).
export async function renderDocx(doc, outputPath, { charts = [] } = {}) {
  const theme = resolveStyle(doc);
  const document = new Builder(doc, theme, charts).build();
  await fs.writeFile(outputPath, await Packer.toBuffer(document));
}

export function chartSvgs(doc) {
  const theme = resolveStyle(doc);
  // One entry per chart block, empty when a chart cannot be drawn, so indexes stay aligned.
  return (doc.blocks || []).filter((block) => block.type === "chart").map((block) => chartSvg(block, theme, theme.fonts.pdf));
}

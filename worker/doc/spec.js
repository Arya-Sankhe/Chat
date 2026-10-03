// DocSpec: the structured source of every Klui document. The doc writer (an LLM) writes
// DocMarkdown, a small superset of Markdown (below), which parses into this JSON; edits are
// precise operations on it, addressed by block id, and the renderers draw PDF and DOCX from it.
//
// DocSpec
//   { style, page: {size: "A4"|"Letter", orientation}, title, subtitle, kicker, author, date,
//     meta: [{label, value}], contact: [string] (CV / letterhead line), header: {left, right},
//     footer: {left, center, right}, toc, numbered_headings, overrides, blocks: [block] }
//   overrides: {colors: {accent, ink, text, muted, rule, surface, tableHead, tableHeadText, stripe, palette},
//               fonts: {heading, body}, base_size, line_height, heading_case, title_align, table_style,
//               callout_style, heading_rule, margins, page}
//
// Blocks (every block has a stable "id"; text fields hold inline markup: **bold**, *italic*,
// `code`, [link](url), $math$, ^sup^, ~sub~, ~~strike~~)
//   heading     level 1-3, text, tag (small right-hand label)
//   paragraph   text, lead (larger intro paragraph)
//   list        style "bullet" | "number" | "check", items [string | {text, checked, items}], start
//   table       caption, columns [string | {label, align}], rows [[cell]], total (last row is a total),
//               highlight (row index), note, source, compact
//   chart       chart "bar" | "column" | "line" | "area" | "pie" | "donut" | "stacked" | "stacked_bar" |
//               "scatter" | "combo", title, caption, categories, series [{name, values, type}],
//               points [{label, x, y}], unit, highlight, x_label, y_label, note, source
//   callout     variant (note, tip, key, important, warning, example, definition, summary, success,
//               abstract), title, text (markdown: paragraphs and lists)
//   quote       text, cite
//   equation    latex
//   code        lang, text
//   stats       items [{value, label, note, tone}]
//   cards       items [{title, text, tag}], columns 2-3
//   steps       items [{title, text}]
//   fields      items [{label, value}], columns 1-4 (blank value = a fill-in line)
//   problem     label, title, text
//   answer      label, text
//   entry       title, org, location, dates, subtitle, text, bullets [string]  (CV, experience)
//   references  items [string]
//   figure      src, caption, width (percent)
//   divider, page_break, toc
//
// DocMarkdown
//   --- front matter (key: value; meta / contact as "- " lists) ---
//   # / ## / ### headings ("## Market ignition || Formative phase" adds a right-hand tag)
//   paragraphs, - / 1. / - [ ] lists, > quotes, GFM tables ("Table: caption" line above),
//   $$ display math $$, ```lang code```, ```chart {json}```, ![caption](url), \pagebreak, ---
//   :::callout tip "Title" ... :::     :::stats  - value | label | note  :::
//   :::cards 3  ### Title || tag  text ... :::    :::steps  ### Title  text ... :::
//   :::fields 2  - Label: value :::    :::problem "Problem 1" "Title" prompt :::
//   :::answer "Answer" text :::        :::entry  title: / org: / location: / dates: / - bullets :::
//   :::references  - reference ... :::  :::table "Caption"  | GFM | ... note: ... :::  :::toc:::

import { STYLES, chooseStyle, fontChoice, styleName } from "./themes.js";

export const BLOCK_TYPES = new Set([
  "heading", "paragraph", "list", "table", "chart", "callout", "quote", "equation", "code", "stats",
  "cards", "steps", "fields", "problem", "answer", "entry", "references", "figure", "divider", "page_break", "toc"
]);

export const CALLOUT_VARIANTS = ["note", "tip", "key", "important", "warning", "example", "definition", "summary", "success", "abstract"];
export const CHART_TYPES = ["bar", "column", "line", "area", "pie", "donut", "stacked", "stacked_bar", "scatter", "combo"];

const TYPE_ALIASES = {
  h: "heading", title: "heading", section: "heading", text: "paragraph", p: "paragraph", para: "paragraph",
  bullets: "list", ul: "list", ol: "list", checklist: "list", grid: "table", graph: "chart", plot: "chart",
  box: "callout", note: "callout", tip: "callout", warning: "callout", info: "callout", definition: "callout",
  blockquote: "quote", math: "equation", formula: "equation", kpis: "stats", metrics: "stats", kpi: "stats",
  card: "cards", process: "steps", procedure: "steps", info_grid: "fields", form: "fields", meta: "fields",
  exercise: "problem", question: "problem", solution_answer: "answer", result: "answer", experience: "entry",
  job: "entry", education: "entry", bibliography: "references", works_cited: "references", citations: "references",
  image: "figure", img: "figure", hr: "divider", rule: "divider", pagebreak: "page_break", "page-break": "page_break",
  contents: "toc"
};

const CALLOUT_ALIASES = {
  info: "note", caution: "warning", danger: "warning", alert: "warning", hint: "tip", idea: "tip",
  key_point: "key", keypoint: "key", takeaway: "key", insight: "key", remember: "important", check: "success",
  done: "success", definition: "definition", define: "definition", eg: "example", "e.g.": "example",
  recap: "summary", tldr: "summary", conclusion: "summary"
};

export function str(value, max = 4000) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") return "";
  const text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.7 ? cut.slice(0, space) : cut}…`;
}

function line(value, max = 400) {
  return str(value, max).replace(/\s*\n\s*/g, " ");
}

function arr(value, max = 200) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function int(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[,\s$€£¥%×x]/gi, "").replace(/[−–]/g, "-");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

export function hex(value) {
  const match = String(value || "").trim().replace(/^#/, "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!match) return "";
  const raw = match[1].length === 3 ? match[1].split("").map((c) => c + c).join("") : match[1];
  return raw.toUpperCase();
}

// Plain text of inline markup, for matching, measuring and search.
export function plain(text) {
  return String(text || "")
    .replace(/\$\$([^$]+)\$\$/g, "$1")
    .replace(/\$(?![\s\d])([^$\n]+?)\$(?!\d)/g, "$1")
    .replace(/\\[([]([\s\S]+?)\\[)\]]/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<![*\w])\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\^([^^\s]+)\^/g, "$1")
    .replace(/(?<!~)~([^~\s]+)~(?!~)/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!$|~^])/g, "$1");
}

// ---------------------------------------------------------------------------------------------
// Normalisation

function normalizeItems(items, depth = 0) {
  return arr(items, 80).map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const out = { text: str(item.text ?? item.title ?? item.label ?? "", 2000) };
      if (item.checked) out.checked = true;
      const children = depth < 2 ? normalizeItems(item.items || item.children, depth + 1) : [];
      if (children.length) out.items = children;
      return out.text || children.length ? out : null;
    }
    const text = str(item, 2000);
    return text ? text : null;
  }).filter(Boolean);
}

function normalizeColumns(columns) {
  return arr(columns, 12).map((column) => {
    if (column && typeof column === "object") {
      const out = { label: line(column.label ?? column.title ?? column.name ?? "", 120) };
      const align = String(column.align || "").toLowerCase();
      if (["left", "right", "center"].includes(align)) out.align = align;
      const width = Number(column.width);
      if (Number.isFinite(width) && width > 0 && width <= 100) out.width = width;
      return out;
    }
    return line(column, 120);
  });
}

function normalizeChart(block) {
  const type = String(block.chart || block.chart_type || block.kind || "column").toLowerCase().replace(/[\s-]+/g, "_");
  const chartType = CHART_TYPES.includes(type) ? type
    : { hbar: "bar", horizontal_bar: "bar", bars: "column", vertical_bar: "column", histogram: "column", pie_chart: "pie",
      doughnut: "donut", ring: "donut", stacked_column: "stacked", stacked100: "stacked", stacked_horizontal: "stacked_bar",
      trend: "line", lines: "line", xy: "scatter", bubble: "scatter" }[type] || "column";
  const out = {
    chart: chartType,
    title: line(block.title, 160),
    caption: line(block.caption, 300),
    unit: line(block.unit, 24),
    note: line(block.note, 300),
    source: line(block.source, 200),
    x_label: line(block.x_label, 60),
    y_label: line(block.y_label, 60)
  };
  out.categories = arr(block.categories || block.labels, 40).map((value) => line(value, 60));
  out.series = arr(block.series, 8).map((series, index) => {
    const values = arr(series?.values || series?.data, 40).map(num);
    const entry = { name: line(series?.name ?? `Series ${index + 1}`, 60), values };
    if (series?.type === "line") entry.type = "line";
    if (hex(series?.color)) entry.color = hex(series.color);
    return entry;
  }).filter((series) => series.values.some((value) => value !== null));
  if (!out.series.length && Array.isArray(block.values)) {
    out.series = [{ name: out.title || "Value", values: arr(block.values, 40).map(num) }];
  }
  out.points = arr(block.points, 60).map((point) => ({
    label: line(point?.label ?? point?.name ?? "", 60),
    x: num(point?.x),
    y: num(point?.y ?? point?.value)
  })).filter((point) => point.y !== null);
  // Pie / bar data given as points becomes one series.
  if (!out.series.length && out.points.length && chartType !== "scatter") {
    out.categories = out.points.map((point) => point.label);
    out.series = [{ name: out.title || "Value", values: out.points.map((point) => point.y) }];
    out.points = [];
  }
  if (out.categories.length && out.series.length) {
    const width = out.categories.length;
    out.series = out.series.map((series) => ({ ...series, values: Array.from({ length: width }, (_, i) => series.values[i] ?? null) }));
  }
  if (block.highlight !== undefined && block.highlight !== null && block.highlight !== "") {
    const index = typeof block.highlight === "number" ? block.highlight : out.categories.findIndex((c) => plain(c).toLowerCase() === plain(block.highlight).toLowerCase());
    if (Number.isInteger(index) && index >= 0) out.highlight = index;
  }
  if (Array.isArray(block.colors)) out.colors = block.colors.map(hex).filter(Boolean).slice(0, 8);
  if (block.stacked100 || type === "stacked100") out.percent = true;
  for (const key of Object.keys(out)) if (out[key] === "" || (Array.isArray(out[key]) && !out[key].length && !["series", "categories"].includes(key))) delete out[key];
  return out;
}

export function normalizeBlock(raw) {
  if (!raw || typeof raw !== "object") return null;
  let type = String(raw.type || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (!BLOCK_TYPES.has(type)) type = TYPE_ALIASES[type] || "";
  if (!type) return null;
  const block = { type };
  if (typeof raw.id === "string" && /^[a-z0-9_-]{1,24}$/i.test(raw.id)) block.id = raw.id;
  switch (type) {
    case "heading": {
      block.level = int(raw.level, 1, 1, 3);
      block.text = line(raw.text ?? raw.title, 300);
      if (raw.tag) block.tag = line(raw.tag, 60);
      if (!block.text) return null;
      break;
    }
    case "paragraph": {
      block.text = str(raw.text ?? raw.body ?? raw.content, 8000);
      if (raw.lead) block.lead = true;
      if (["center", "right", "justify", "left"].includes(raw.align)) block.align = raw.align;
      if (!block.text) return null;
      break;
    }
    case "list": {
      const style = String(raw.style || (raw.ordered ? "number" : raw.check ? "check" : "bullet")).toLowerCase();
      block.style = ["bullet", "number", "check"].includes(style) ? style : style.startsWith("num") || style === "ordered" ? "number" : "bullet";
      block.items = normalizeItems(raw.items);
      if (raw.start && block.style === "number") block.start = int(raw.start, 1, 1, 999);
      if (!block.items.length) return null;
      break;
    }
    case "table": {
      block.columns = normalizeColumns(raw.columns || raw.headers || []);
      const width = Math.max(block.columns.length, ...arr(raw.rows, 200).map((row) => (Array.isArray(row) ? row.length : 0)));
      block.rows = arr(raw.rows, 200).map((row) => {
        const cells = Array.isArray(row) ? row : [row];
        return Array.from({ length: width }, (_, i) => str(cells[i] ?? "", 1200).replace(/\n+/g, " "));
      }).filter((row) => row.some((cell) => cell));
      while (block.columns.length < width) block.columns.push("");
      if (raw.caption || raw.title) block.caption = line(raw.caption || raw.title, 300);
      if (raw.note) block.note = line(raw.note, 600);
      if (raw.source) block.source = line(raw.source, 300);
      if (raw.total) block.total = true;
      if (raw.compact) block.compact = true;
      const highlight = Array.isArray(raw.highlight) ? raw.highlight : raw.highlight !== undefined && raw.highlight !== null && raw.highlight !== "" ? [raw.highlight] : [];
      const rows = highlight.map((value) => int(value, -1, -1, 999)).filter((value) => value >= 0 && value < block.rows.length);
      if (rows.length) block.highlight = rows.length === 1 ? rows[0] : rows;
      if (!block.rows.length) return null;
      break;
    }
    case "chart": {
      Object.assign(block, normalizeChart(raw));
      if (block.chart === "scatter" ? !block.points?.length : !block.series.length) return null;
      break;
    }
    case "callout": {
      const variant = String(raw.variant || raw.kind || raw.tone || (TYPE_ALIASES[String(raw.type).toLowerCase()] === "callout" ? raw.type : "note")).toLowerCase();
      block.variant = CALLOUT_VARIANTS.includes(variant) ? variant : CALLOUT_ALIASES[variant] || "note";
      if (raw.title) block.title = line(raw.title, 160);
      block.text = str(raw.text ?? raw.body ?? raw.content, 6000);
      if (!block.text && !block.title) return null;
      break;
    }
    case "quote": {
      block.text = str(raw.text ?? raw.quote, 3000);
      if (raw.cite || raw.attribution) block.cite = line(raw.cite || raw.attribution, 200);
      if (!block.text) return null;
      break;
    }
    case "equation": {
      block.latex = str(raw.latex ?? raw.text ?? raw.math, 3000).replace(/^\$\$?|\$\$?$/g, "").trim();
      if (raw.label) block.label = line(raw.label, 40);
      if (!block.latex) return null;
      break;
    }
    case "code": {
      block.lang = line(raw.lang || raw.language, 24);
      block.text = String(raw.text ?? raw.code ?? "").replace(/\r\n?/g, "\n").slice(0, 12000);
      if (!block.text.trim()) return null;
      break;
    }
    case "stats": {
      block.items = arr(raw.items || raw.stats || raw.kpis, 6).map((item) => ({
        value: line(item?.value, 24),
        label: line(item?.label, 80),
        ...(item?.note ? { note: line(item.note, 120) } : {}),
        ...(["positive", "negative", "warn", "accent"].includes(item?.tone) ? { tone: item.tone } : {})
      })).filter((item) => item.value);
      if (!block.items.length) return null;
      break;
    }
    case "cards":
    case "steps": {
      block.items = arr(raw.items || raw.cards || raw.steps, type === "steps" ? 10 : 9).map((item) => {
        if (typeof item === "string") return { title: "", text: str(item, 1200) };
        return {
          title: line(item?.title, 160),
          text: str(item?.text ?? item?.body, 1500),
          ...(item?.tag ? { tag: line(item.tag, 40) } : {})
        };
      }).filter((item) => item.title || item.text);
      if (type === "cards") block.columns = int(raw.columns, block.items.length % 3 === 0 && block.items.length > 2 ? 3 : 2, 1, 4);
      if (!block.items.length) return null;
      break;
    }
    case "fields": {
      block.items = arr(raw.items || raw.fields, 40).map((item) => ({ label: line(item?.label, 80), value: str(item?.value ?? "", 600) }))
        .filter((item) => item.label || item.value);
      block.columns = int(raw.columns, block.items.length >= 4 ? 2 : 1, 1, 4);
      if (raw.boxed) block.boxed = true;
      if (!block.items.length) return null;
      break;
    }
    case "problem": {
      block.label = line(raw.label || raw.number, 40);
      if (raw.title) block.title = line(raw.title, 200);
      block.text = str(raw.text ?? raw.prompt ?? "", 6000);
      if (!block.text && !block.title) return null;
      break;
    }
    case "answer": {
      block.label = line(raw.label || "Answer", 60);
      block.text = str(raw.text ?? raw.value ?? "", 2000);
      if (!block.text) return null;
      break;
    }
    case "entry": {
      for (const key of ["title", "org", "location", "dates", "subtitle"]) {
        const value = line(raw[key] ?? (key === "org" ? raw.organization || raw.company || raw.school : key === "dates" ? raw.date : ""), 160);
        if (value) block[key] = value;
      }
      if (raw.text) block.text = str(raw.text, 2000);
      block.bullets = arr(raw.bullets || raw.items, 12).map((value) => str(typeof value === "object" ? value?.text : value, 600)).filter(Boolean);
      if (!block.title && !block.org) return null;
      break;
    }
    case "references": {
      block.items = arr(raw.items || raw.references, 120).map((value) => str(typeof value === "object" ? value?.text : value, 1200)).filter(Boolean);
      if (raw.title) block.title = line(raw.title, 80);
      if (!block.items.length) return null;
      break;
    }
    case "figure": {
      const src = String(raw.src || raw.url || "").trim();
      if (!/^(https:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,)/i.test(src)) return null;
      block.src = src.slice(0, 4_000_000);
      if (raw.caption) block.caption = line(raw.caption, 300);
      block.width = int(raw.width, 100, 20, 100);
      break;
    }
    default:
      break;
  }
  return block;
}

function normalizeOverrides(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const out = {};
  const colors = {};
  for (const [key, value] of Object.entries(raw.colors || {})) {
    if (key === "palette" && Array.isArray(value)) {
      const palette = value.map(hex).filter(Boolean).slice(0, 8);
      if (palette.length) colors.palette = palette;
    } else if (/^(ink|text|muted|faint|rule|accent|accent2|surface|surfaceStrong|tableHead|tableHeadText|stripe|positive|negative|warn|page)$/.test(key) && hex(value)) {
      colors[key] = hex(value);
    }
  }
  if (Object.keys(colors).length) out.colors = colors;
  const fonts = {};
  for (const key of ["heading", "body"]) {
    const face = fontChoice(raw.fonts?.[key]);
    if (face) fonts[key] = face;
    const asked = line(raw.fonts?.[key], 40);
    if (face && asked && asked !== face) fonts[`${key}_requested`] = asked;
  }
  if (Object.keys(fonts).length) out.fonts = fonts;
  const base = Number(raw.base_size);
  if (Number.isFinite(base) && base >= 8 && base <= 14) out.base_size = Math.round(base * 4) / 4;
  const spacing = Number(raw.line_height);
  if (Number.isFinite(spacing) && spacing >= 1 && spacing <= 2.5) out.line_height = Math.round(spacing * 100) / 100;
  if (["none", "upper", "smallcaps"].includes(raw.heading_case)) out.heading_case = raw.heading_case;
  if (["left", "center"].includes(raw.title_align)) out.title_align = raw.title_align;
  if (["dark", "light", "rules", "grid", "plain"].includes(raw.table_style)) out.table_style = raw.table_style;
  if (["bar", "box", "plain"].includes(raw.callout_style)) out.callout_style = raw.callout_style;
  if (["none", "below", "above"].includes(raw.heading_rule)) out.heading_rule = raw.heading_rule;
  if (["narrow", "normal", "wide"].includes(raw.margins)) out.margins = raw.margins;
  if (typeof raw.number_headings === "boolean") out.number_headings = raw.number_headings;
  if (typeof raw.justify === "boolean") out.justify = raw.justify;
  return Object.keys(out).length ? out : undefined;
}

function normalizeSlots(raw, keys) {
  if (!raw || typeof raw !== "object") return undefined;
  const out = {};
  for (const key of keys) {
    if (raw[key] !== undefined) out[key] = line(raw[key], 160);
  }
  return Object.keys(out).length ? out : undefined;
}

// Blocks keep their ids across edits; new blocks get the next free id.
export function assignIds(blocks) {
  const used = new Set();
  let next = 1;
  for (const block of blocks) {
    if (block.id && !used.has(block.id)) used.add(block.id);
    else delete block.id;
    const match = /^b(\d+)$/.exec(block.id || "");
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  for (const block of blocks) {
    if (!block.id) {
      while (used.has(`b${next}`)) next += 1;
      block.id = `b${next}`;
      used.add(block.id);
      next += 1;
    }
  }
  return blocks;
}

export function normalizeDoc(raw = {}, fallback = {}) {
  const input = raw && typeof raw === "object" ? raw : {};
  const doc = {};
  doc.style = styleName(input.style || input.theme) || styleName(fallback.style) || chooseStyle(`${input.title || fallback.title || ""} ${fallback.hint || ""}`);
  const style = STYLES[doc.style];
  const size = String(input.page?.size || input.page_size || (typeof input.page === "string" ? input.page : "") || "").toLowerCase();
  doc.page = {
    size: size === "letter" || size === "us letter" ? "Letter" : size === "a4" ? "A4" : size === "legal" ? "Legal" : style.layout.page,
    orientation: String(input.page?.orientation || "").toLowerCase() === "landscape" ? "landscape" : "portrait"
  };
  for (const key of ["title", "subtitle", "kicker", "author", "date"]) {
    const value = line(input[key] ?? (key === "title" ? fallback.title : ""), key === "subtitle" ? 400 : 240);
    if (value) doc[key] = value;
  }
  const meta = arr(input.meta, 12).map((item) => {
    if (typeof item === "string") {
      const match = item.match(/^([^:]{1,40}):\s*(.+)$/);
      return match ? { label: line(match[1], 40), value: line(match[2], 160) } : { label: "", value: line(item, 160) };
    }
    return { label: line(item?.label, 40), value: line(item?.value, 160) };
  }).filter((item) => item.value);
  if (meta.length) doc.meta = meta;
  const contact = arr(input.contact, 8).map((value) => line(value, 120)).filter(Boolean);
  if (contact.length) doc.contact = contact;
  const header = normalizeSlots(input.header, ["left", "center", "right"]);
  if (header) doc.header = header;
  const footer = normalizeSlots(input.footer, ["left", "center", "right"]);
  if (footer) doc.footer = footer;
  if (input.toc) doc.toc = true;
  if (typeof input.numbered_headings === "boolean") doc.numbered_headings = input.numbered_headings;
  const overrides = normalizeOverrides(input.overrides || input.style_overrides);
  if (overrides) doc.overrides = overrides;
  doc.blocks = assignIds(arr(input.blocks, 1500).map(normalizeBlock).filter(Boolean));
  return doc;
}

// ---------------------------------------------------------------------------------------------
// DocMarkdown parser

function parseArgs(text) {
  const positional = [];
  const named = {};
  const pattern = /(\w[\w-]*)=("([^"]*)"|'([^']*)'|\S+)|"([^"]*)"|'([^']*)'|“([^”]*)”|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    if (match[1]) named[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[2];
    else positional.push(match[5] ?? match[6] ?? match[7] ?? match[8]);
  }
  return { positional, named };
}

// "{accent: 1D4ED8, ink: 0F172A}" -> object (flow maps in front matter, one level of nesting).
function parseFlowMap(text) {
  const inner = text.trim().slice(1, -1);
  const out = {};
  let depth = 0;
  let quote = "";
  let current = "";
  const parts = [];
  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = "";
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === "{" || char === "[") {
      depth += 1;
      current += char;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      current += char;
    } else if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  for (const part of parts) {
    const match = part.match(/^\s*["']?([\w-]+)["']?\s*:\s*([\s\S]*)$/);
    if (match) out[match[1]] = parseScalar(match[2]);
  }
  return out;
}

function parseScalar(value) {
  const text = String(value ?? "").trim();
  if (/^\{[\s\S]*\}$/.test(text)) return parseFlowMap(text);
  if (/^\[[\s\S]*\]$/.test(text)) return text.slice(1, -1).split(",").map((part) => parseScalar(part)).filter((part) => part !== "");
  if (/^(true|yes)$/i.test(text)) return true;
  if (/^(false|no)$/i.test(text)) return false;
  if (/^".*"$|^'.*'$/.test(text)) return text.slice(1, -1);
  return text;
}

// Front matter: "key: value" lines; a key with no value followed by "- " lines is a list;
// "  sub: value" lines under a key make an object.
function parseFrontMatter(lines) {
  const out = {};
  let current = null;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const item = raw.match(/^\s+-\s+(.*)$/) || raw.match(/^-\s+(.*)$/);
    if (item && current) {
      if (!Array.isArray(out[current])) out[current] = [];
      out[current].push(parseScalar(item[1]));
      continue;
    }
    const nested = raw.match(/^\s+([\w-]+):\s*(.*)$/);
    if (nested && current) {
      if (!out[current] || typeof out[current] !== "object" || Array.isArray(out[current])) out[current] = {};
      const value = nested[2].trim();
      if (value.startsWith("[") && value.endsWith("]")) out[current][nested[1]] = value.slice(1, -1).split(",").map((part) => parseScalar(part));
      else out[current][nested[1]] = parseScalar(value);
      continue;
    }
    const pair = raw.match(/^([\w-]+):\s*(.*)$/);
    if (pair) {
      current = pair[1].toLowerCase();
      const value = pair[2].trim();
      if (value === "") out[current] = "";
      else if (value.startsWith("[") && value.endsWith("]")) out[current] = value.slice(1, -1).split(",").map((part) => parseScalar(part)).filter((part) => part !== "");
      else out[current] = parseScalar(value);
    }
  }
  return out;
}

function splitRow(row) {
  let text = String(row || "").trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells = [];
  let current = "";
  let math = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\" && text[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (char === "$" && (math || (/[^\s\d]/.test(text[i + 1] || "") && text.indexOf("$", i + 1) > i + 1))) {
      // Inline math may hold "|" (absolute values); prices like "$300M" are not math.
      math = !math;
      current += char;
    } else if (char === "|" && !math) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isSeparator(row) {
  const cells = splitRow(row);
  return cells.length >= 1 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

function parseTable(lines, start) {
  if (start + 1 >= lines.length || !lines[start].includes("|") || !isSeparator(lines[start + 1])) return null;
  const header = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((cell) => {
    const c = cell.replace(/\s/g, "");
    return c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "";
  });
  const rows = [];
  let index = start + 2;
  while (index < lines.length && lines[index].trim().includes("|") && lines[index].trim()) {
    rows.push(splitRow(lines[index]));
    index += 1;
  }
  const columns = header.map((label, i) => (aligns[i] ? { label, align: aligns[i] } : label));
  return { table: { type: "table", columns, rows }, next: index };
}

function parseListLines(lines) {
  // Returns {style, items, start} from consecutive list lines (indent-aware, up to 3 levels).
  const root = { items: [] };
  const stack = [{ indent: -1, node: root }];
  let style = "";
  let start = null;
  let last = null;
  for (const raw of lines) {
    const match = raw.match(/^(\s*)([-*+•]|\d+[.)])\s+(\[( |x|X)\]\s+)?(.*)$/);
    if (!match) {
      if (last && raw.trim()) last.text = `${last.text} ${raw.trim()}`;
      continue;
    }
    const indent = match[1].replace(/\t/g, "  ").length;
    const ordered = /\d/.test(match[2]);
    const checkbox = match[4] !== undefined;
    if (!style) {
      style = checkbox ? "check" : ordered ? "number" : "bullet";
      if (ordered) start = Number.parseInt(match[2], 10);
    }
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    if (stack.length > 3) stack.length = 3;
    const node = { text: match[5].trim(), items: [] };
    if (checkbox && match[4].toLowerCase() === "x") node.checked = true;
    stack[stack.length - 1].node.items.push(node);
    stack.push({ indent, node });
    last = node;
  }
  const simplify = (items) => items.map((item) => {
    const children = simplify(item.items);
    if (!children.length && !item.checked) return item.text;
    return { text: item.text, ...(item.checked ? { checked: true } : {}), ...(children.length ? { items: children } : {}) };
  });
  return { style: style || "bullet", items: simplify(root.items), start };
}

// Sections separated by "### Title || tag" lines (cards, steps), or list items "**Title** - text".
function parseTitledItems(body) {
  const lines = body.split("\n");
  const items = [];
  let current = null;
  for (const raw of lines) {
    const head = raw.match(/^#{2,4}\s+(.+)$/);
    if (head) {
      const [title, tag] = head[1].split(/\s+\|\|\s+/);
      current = { title: title.trim(), text: "", ...(tag ? { tag: tag.trim() } : {}) };
      items.push(current);
      continue;
    }
    const bullet = raw.match(/^\s*(?:[-*]|\d+[.)])\s+(?:\*\*(.+?)\*\*[:.]?\s*(?:[-–—:]\s*)?)?(.*)$/);
    if (bullet && (!current || bullet[1])) {
      current = { title: (bullet[1] || "").trim(), text: bullet[2].trim() };
      items.push(current);
      continue;
    }
    if (current) current.text = current.text ? `${current.text}\n${raw}` : raw;
  }
  return items.map((item) => ({ ...item, text: item.text.trim() }));
}

function parseKeyValues(body) {
  const out = {};
  const bullets = [];
  const rest = [];
  for (const raw of body.split("\n")) {
    const pair = raw.match(/^\s*(title|role|position|org|organization|company|school|location|dates?|subtitle|degree|gpa|link):\s*(.*)$/i);
    const bullet = raw.match(/^\s*[-*•]\s+(.*)$/);
    if (pair) {
      const key = pair[1].toLowerCase();
      const mapped = { role: "title", position: "title", organization: "org", company: "org", school: "org", date: "dates", degree: "title" }[key] || key;
      if (mapped === "gpa" || mapped === "link") rest.push(`${pair[1]}: ${pair[2]}`);
      else out[mapped] = pair[2].trim();
    } else if (bullet) bullets.push(bullet[1].trim());
    else if (raw.trim()) rest.push(raw.trim());
  }
  return { ...out, bullets, text: rest.join(" ") };
}

function directiveBlock(type, args, body) {
  const { positional, named } = parseArgs(args);
  const text = body.replace(/^\n+|\n+$/g, "");
  switch (type) {
    case "callout":
    case "note": case "tip": case "warning": case "info": case "key": case "important": case "example":
    case "definition": case "summary": case "success": case "abstract": {
      const variant = type === "callout" ? (positional[0] && !/\s/.test(positional[0]) && positional.length > 1 ? positional.shift() : named.variant || positional.length === 1 && CALLOUT_VARIANTS.includes(String(positional[0]).toLowerCase()) ? (named.variant || positional.shift()) : "note") : type;
      const title = named.title || positional.join(" ");
      return { type: "callout", variant, title, text };
    }
    case "stats": case "kpis": case "metrics": {
      const items = text.split("\n").map((raw) => raw.replace(/^\s*[-*]\s+/, "")).filter((raw) => raw.trim()).map((raw) => {
        const [value, label, note] = raw.split(/\s*\|\s*/);
        return { value, label, note };
      });
      return { type: "stats", items };
    }
    case "cards": case "steps": {
      const columns = Number(named.columns || positional.find((value) => /^\d$/.test(value)));
      return { type, items: parseTitledItems(text), ...(columns ? { columns } : {}) };
    }
    case "fields": case "form": case "info": {
      const items = text.split("\n").map((raw) => raw.replace(/^\s*[-*]\s+/, "")).filter((raw) => raw.trim()).map((raw) => {
        const match = raw.match(/^([^:]{1,80}):\s*(.*)$/);
        return match ? { label: match[1].replace(/\*\*/g, "").trim(), value: match[2].trim() } : { label: raw.trim(), value: "" };
      });
      const columns = Number(named.columns || positional.find((value) => /^\d$/.test(value)));
      const boxed = positional.includes("boxed") || named.boxed !== undefined;
      return { type: "fields", items, ...(columns ? { columns } : {}), ...(boxed ? { boxed: true } : {}) };
    }
    case "problem": case "exercise": case "question":
      return { type: "problem", label: named.label || positional[0] || "", title: named.title || positional.slice(1).join(" "), text };
    case "answer": case "result":
      return { type: "answer", label: named.label || positional.join(" ") || "Answer", text };
    case "entry": case "job": case "experience": case "education":
      return { type: "entry", ...parseKeyValues(text) };
    case "references": case "bibliography": case "works_cited": {
      const items = [];
      for (const raw of text.split("\n")) {
        const item = raw.match(/^\s*(?:[-*]|\d+[.)]|\[\d+\])\s+(.*)$/);
        if (item) items.push(item[1].trim());
        else if (raw.trim() && items.length && /^\s/.test(raw)) items[items.length - 1] += ` ${raw.trim()}`;
        else if (raw.trim()) items.push(raw.trim());
      }
      return { type: "references", items, ...(named.title || positional.length ? { title: named.title || positional.join(" ") } : {}) };
    }
    case "table": {
      const lines = text.split("\n");
      const start = lines.findIndex((raw) => raw.includes("|"));
      const parsed = start >= 0 ? parseTable(lines, start) : null;
      if (!parsed) return null;
      const options = {};
      for (const raw of lines.slice(parsed.next)) {
        const match = raw.match(/^\s*(note|source|caption|total|highlight|compact):\s*(.*)$/i);
        if (match) options[match[1].toLowerCase()] = parseScalar(match[2]);
      }
      const highlight = named.highlight ?? options.highlight;
      return {
        ...parsed.table,
        caption: named.caption || positional.join(" ") || options.caption || "",
        note: named.note || options.note || "",
        source: named.source || options.source || "",
        total: named.total !== undefined ? parseScalar(named.total) === true : options.total === true,
        compact: named.compact !== undefined || options.compact === true,
        ...(highlight !== undefined && highlight !== "" ? { highlight: String(highlight).split(",").map((value) => Number(value) - 1).filter((value) => value >= 0) } : {})
      };
    }
    case "chart": {
      try {
        return { type: "chart", ...JSON.parse(text) };
      } catch {
        return null;
      }
    }
    case "quote":
      return { type: "quote", text, cite: named.cite || positional.join(" ") };
    case "figure": case "image": {
      const kv = Object.fromEntries(text.split("\n").map((raw) => raw.match(/^\s*(src|url|caption|width):\s*(.*)$/i)).filter(Boolean).map((m) => [m[1].toLowerCase(), m[2].trim()]));
      return { type: "figure", src: kv.src || kv.url || named.src, caption: kv.caption || named.caption, width: kv.width || named.width };
    }
    case "toc": case "contents":
      return { type: "toc" };
    case "pagebreak": case "page_break": case "newpage":
      return { type: "page_break" };
    default:
      return text ? { type: "paragraph", text } : null;
  }
}

export function parseDocMarkdown(source, fallback = {}) {
  const text = String(source || "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  let lines = text.split("\n");
  let front = {};
  // Front matter, optionally inside a ```yaml or ``` fence a model may add.
  const firstContent = lines.findIndex((raw) => raw.trim());
  if (firstContent >= 0 && lines[firstContent].trim() === "---") {
    const end = lines.findIndex((raw, i) => i > firstContent && raw.trim() === "---");
    if (end > firstContent) {
      front = parseFrontMatter(lines.slice(firstContent + 1, end));
      lines = lines.slice(end + 1);
    }
  }
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ").replace(/[ \t]+/g, " ").replace(/\s*\u2028\s*/g, "\n").trim() });
      paragraph = [];
    }
  };
  let index = 0;
  let tableCaption = "";
  while (index < lines.length) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed) {
      flush();
      index += 1;
      continue;
    }
    // Directives
    const directive = trimmed.match(/^:{3,}\s*([a-z_-]+)\s*(.*)$/i);
    if (directive && !/^:{3,}\s*$/.test(trimmed)) {
      flush();
      const type = directive[1].toLowerCase().replace(/-/g, "_");
      const rest = directive[2].replace(/:{3,}\s*$/, "");
      if (/:{3,}\s*$/.test(directive[2]) || ["toc", "contents", "pagebreak", "page_break", "newpage"].includes(type)) {
        const block = directiveBlock(type, rest, "");
        if (block) blocks.push(block);
        index += 1;
        continue;
      }
      let end = index + 1;
      let depth = 1;
      while (end < lines.length) {
        const candidate = lines[end].trim();
        if (/^:{3,}\s*$/.test(candidate)) {
          depth -= 1;
          if (depth === 0) break;
        } else if (/^:{3,}\s*[a-z]/i.test(candidate)) depth += 1;
        end += 1;
      }
      const block = directiveBlock(type, rest, lines.slice(index + 1, end).join("\n"));
      if (block) blocks.push(block);
      index = end + 1;
      continue;
    }
    // Fenced code / chart / math
    const fence = trimmed.match(/^(`{3,}|~{3,})\s*([\w+-]*)\s*(.*)$/);
    if (fence) {
      flush();
      const marker = fence[1];
      let end = index + 1;
      while (end < lines.length && !lines[end].trim().startsWith(marker)) end += 1;
      const body = lines.slice(index + 1, end).join("\n");
      const lang = fence[2].toLowerCase();
      if (lang === "chart") {
        try {
          blocks.push({ type: "chart", ...JSON.parse(body) });
        } catch {
          // An unreadable chart is dropped rather than printed as JSON.
        }
      } else if (["math", "latex", "tex", "equation"].includes(lang)) {
        blocks.push({ type: "equation", latex: body.trim() });
      } else if (lang === "table" || lang === "stats") {
        try {
          blocks.push({ type: lang, ...JSON.parse(body) });
        } catch {
          blocks.push({ type: "code", lang, text: body });
        }
      } else {
        blocks.push({ type: "code", lang, text: body });
      }
      index = end + 1;
      continue;
    }
    // Display math
    if (trimmed.startsWith("$$")) {
      flush();
      const single = trimmed.match(/^\$\$(.+)\$\$\s*$/);
      if (single) {
        blocks.push({ type: "equation", latex: single[1].trim() });
        index += 1;
        continue;
      }
      let end = index + 1;
      const parts = [trimmed.slice(2)];
      while (end < lines.length && !lines[end].includes("$$")) {
        parts.push(lines[end]);
        end += 1;
      }
      if (end < lines.length) parts.push(lines[end].slice(0, lines[end].indexOf("$$")));
      blocks.push({ type: "equation", latex: parts.join("\n").trim() });
      index = end + 1;
      continue;
    }
    const bracketLine = trimmed.match(/^\\\[(.+)\\\]$/);
    if (bracketLine) {
      flush();
      blocks.push({ type: "equation", latex: bracketLine[1].trim() });
      index += 1;
      continue;
    }
    if (/^\\\[\s*$/.test(trimmed)) {
      flush();
      let end = index + 1;
      while (end < lines.length && !/^\\\]/.test(lines[end].trim())) end += 1;
      blocks.push({ type: "equation", latex: lines.slice(index + 1, end).join("\n").trim() });
      index = end + 1;
      continue;
    }
    if (/^(\\pagebreak|\\newpage|<!--\s*pagebreak\s*-->)$/i.test(trimmed)) {
      flush();
      blocks.push({ type: "page_break" });
      index += 1;
      continue;
    }
    // Headings
    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flush();
      const [textPart, tag] = heading[2].split(/\s+\|\|\s+/);
      blocks.push({ type: "heading", level: Math.min(3, heading[1].length), text: textPart.trim(), ...(tag ? { tag: tag.trim() } : {}) });
      index += 1;
      continue;
    }
    // Table caption line
    const caption = trimmed.match(/^\**(?:Table|Caption)(?:\s+\d+)?[:.]\**\s+(.+)$/);
    const nextLine = lines.slice(index + 1).findIndex((candidate) => candidate.trim());
    if (caption && nextLine >= 0 && nextLine <= 1 && lines[index + 1 + nextLine].includes("|")) {
      flush();
      tableCaption = caption[1].replace(/\*+$/, "").trim();
      index += 1 + nextLine;
      continue;
    }
    // Tables
    const table = parseTable(lines, index);
    if (table) {
      flush();
      const block = { ...table.table };
      if (tableCaption) block.caption = tableCaption;
      tableCaption = "";
      let next = table.next;
      // A caption or note line directly under the table.
      while (next < lines.length) {
        const after = lines[next].trim().match(/^(Table|Caption|Note|Source):\s+(.+)$/i);
        if (!after) break;
        const key = after[1].toLowerCase();
        block[key === "table" || key === "caption" ? "caption" : key] = after[2].trim();
        next += 1;
      }
      blocks.push(block);
      index = next;
      continue;
    }
    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ type: "divider" });
      index += 1;
      continue;
    }
    // Figure
    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
    if (image) {
      flush();
      blocks.push({ type: "figure", src: image[2], caption: image[1] });
      index += 1;
      continue;
    }
    // Quotes and GitHub-style callouts
    if (trimmed.startsWith(">")) {
      flush();
      const quoted = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoted.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      const alert = quoted[0]?.match(/^\[!(\w+)\]\s*(.*)$/);
      if (alert) {
        blocks.push({ type: "callout", variant: alert[1].toLowerCase(), title: alert[2], text: quoted.slice(1).join("\n").trim() });
      } else {
        let cite = "";
        const last = quoted[quoted.length - 1] || "";
        const attribution = last.match(/^(?:—|--|–)\s*(.+)$/);
        if (attribution && quoted.length > 1) {
          cite = attribution[1];
          quoted.pop();
        }
        blocks.push({ type: "quote", text: quoted.join(" ").replace(/\s+/g, " ").trim(), cite });
      }
      continue;
    }
    // Lists
    if (/^([-*+•]|\d+[.)])\s+/.test(trimmed)) {
      flush();
      const listLines = [];
      const ordered = /^\d/.test(trimmed);
      while (index < lines.length) {
        const candidate = lines[index];
        // A top-level item of the other kind (bullets after numbers) starts a new list.
        const top = candidate.match(/^([-*+•]|\d+[.)])\s+/);
        if (top && listLines.length && /^\d/.test(top[1]) !== ordered) break;
        if (!candidate.trim()) {
          // A blank line ends the list unless the next line continues it.
          const next = lines[index + 1] || "";
          if (/^\s*([-*+•]|\d+[.)])\s+/.test(next)) {
            index += 1;
            continue;
          }
          break;
        }
        if (/^\s*([-*+•]|\d+[.)])\s+/.test(candidate) || /^\s{2,}\S/.test(candidate)) {
          listLines.push(candidate);
          index += 1;
          continue;
        }
        break;
      }
      const list = parseListLines(listLines);
      blocks.push({ type: "list", style: list.style, items: list.items, ...(list.start && list.start !== 1 ? { start: list.start } : {}) });
      continue;
    }
    // A line ending in two spaces or a backslash is a hard line break (address blocks).
    paragraph.push(/( {2,}|\\)$/.test(raw) ? `${trimmed.replace(/\\$/, "")}\u2028` : trimmed);
    index += 1;
  }
  flush();

  // A first "# Title" becomes the document title when the front matter has none.
  if (!front.title && blocks[0]?.type === "heading" && blocks[0].level === 1 && !fallback.title) {
    front.title = blocks.shift().text;
  } else if (blocks[0]?.type === "heading" && blocks[0].level === 1 && plain(blocks[0].text).toLowerCase() === plain(front.title || fallback.title || "").toLowerCase()) {
    blocks.shift();
  }
  // Sections start at level 1 whatever depth of "#" the writer used for them.
  const levels = blocks.filter((block) => block.type === "heading").map((block) => block.level);
  const shift = levels.length ? Math.min(...levels) - 1 : 0;
  if (shift > 0) for (const block of blocks) if (block.type === "heading") block.level = Math.max(1, block.level - shift);
  let meta = Array.isArray(front.meta) ? front.meta : [];
  // Header lines and the title repeated at the top of the body (an essay's name / instructor /
  // course / date block) belong to the title block, not the text.
  const squash = (value) => plain(value).replace(/\s+/g, " ").trim().toLowerCase();
  const known = [front.title, front.author, front.date, ...meta.map((item) => (typeof item === "string" ? item.replace(/^[^:]{1,40}:\s*/, "") : item?.value))].filter(Boolean).map(squash);
  while (blocks.length && blocks[0].type === "paragraph") {
    const lines = blocks[0].text.split("\n").map((value) => value.trim()).filter(Boolean);
    const short = lines.length >= 2 && lines.length <= 6 && lines.every((value) => value.length <= 70);
    if (known.includes(squash(blocks[0].text)) || (short && lines.some((value) => known.includes(squash(value))))) {
      if (short && !meta.length) meta = lines.filter((value) => squash(value) !== squash(front.title || ""));
      blocks.shift();
      continue;
    }
    break;
  }
  const overrides = typeof front.overrides === "object" ? front.overrides : {};
  for (const key of ["accent", "ink", "text"]) {
    if (front[key] && hex(front[key])) overrides.colors = { ...(overrides.colors || {}), [key]: front[key] };
  }
  if (front.heading_font || front.body_font) overrides.fonts = { heading: front.heading_font, body: front.body_font };
  return normalizeDoc({
    ...front,
    meta,
    page: { size: front.page || front.page_size || "", orientation: front.orientation || "" },
    header: typeof front.header === "object" ? front.header : undefined,
    footer: typeof front.footer === "object" ? front.footer : typeof front.footer === "string" ? { left: front.footer } : undefined,
    contact: Array.isArray(front.contact) ? front.contact : typeof front.contact === "string" ? front.contact.split(/\s+[|·•]\s+/) : undefined,
    overrides: Object.keys(overrides).length ? overrides : undefined,
    blocks
  }, fallback);
}

// ---------------------------------------------------------------------------------------------
// Text views

function itemsText(items, depth = 0) {
  return items.map((item) => {
    const text = typeof item === "string" ? item : item.text;
    const children = typeof item === "object" && item.items ? `\n${itemsText(item.items, depth + 1)}` : "";
    return `${"  ".repeat(depth)}- ${text}${children}`;
  }).join("\n");
}

// Plain text of one block, used to match a user's selection to the block it came from.
export function blockText(block) {
  switch (block.type) {
    case "heading": return plain(block.text);
    case "paragraph": case "quote": return plain(`${block.text}${block.cite ? ` ${block.cite}` : ""}`);
    case "list": return plain(itemsText(block.items).replace(/^\s*- /gm, ""));
    case "table": return plain([block.caption, block.columns.map((c) => (typeof c === "string" ? c : c.label)).join(" "), ...block.rows.map((row) => row.join(" ")), block.note, block.source].filter(Boolean).join("\n"));
    case "chart": return plain([block.title, block.caption, ...(block.categories || []), ...(block.series || []).map((s) => s.name), block.note, block.source].filter(Boolean).join(" "));
    case "callout": return plain(`${block.title || ""} ${block.text}`);
    case "equation": return block.latex;
    case "code": return block.text;
    case "stats": return plain(block.items.map((item) => `${item.value} ${item.label} ${item.note || ""}`).join(" "));
    case "cards": case "steps": return plain(block.items.map((item) => `${item.title} ${item.text}`).join(" "));
    case "fields": return plain(block.items.map((item) => `${item.label} ${item.value}`).join(" "));
    case "problem": return plain(`${block.label} ${block.title || ""} ${block.text}`);
    case "answer": return plain(`${block.label} ${block.text}`);
    case "entry": return plain([block.title, block.org, block.location, block.dates, block.subtitle, block.text, ...block.bullets].filter(Boolean).join(" "));
    case "references": return plain(block.items.join(" "));
    case "figure": return plain(block.caption || "");
    default: return "";
  }
}

// DocMarkdown for a spec: what chat search, reading and the markdown editor see.
export function docToMarkdown(doc) {
  const out = [];
  if (doc.title) out.push(`# ${doc.title}`);
  if (doc.subtitle) out.push(`*${doc.subtitle}*`);
  if (doc.meta?.length) out.push(doc.meta.map((item) => `${item.label ? `**${item.label}:** ` : ""}${item.value}`).join(" · "));
  if (doc.contact?.length) out.push(doc.contact.join(" · "));
  for (const block of doc.blocks || []) {
    switch (block.type) {
      case "heading": out.push(`${"#".repeat(block.level + 1)} ${block.text}`); break;
      case "paragraph": out.push(block.text); break;
      case "list": out.push(block.style === "number" ? block.items.map((item, i) => `${i + (block.start || 1)}. ${typeof item === "string" ? item : item.text}`).join("\n") : block.style === "check" ? block.items.map((item) => `- [${item.checked ? "x" : " "}] ${typeof item === "string" ? item : item.text}`).join("\n") : itemsText(block.items)); break;
      case "table": {
        const head = block.columns.map((c) => (typeof c === "string" ? c : c.label));
        out.push([block.caption ? `Table: ${block.caption}` : "", `| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...block.rows.map((row) => `| ${row.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`), block.note ? `Note: ${block.note}` : ""].filter(Boolean).join("\n"));
        break;
      }
      case "chart": {
        const head = ["", ...(block.series || []).map((s) => s.name)];
        const rows = (block.categories || []).map((category, i) => [category, ...(block.series || []).map((s) => s.values[i] ?? "")]);
        out.push([`**Chart: ${block.title || block.caption || block.chart}**${block.unit ? ` (${block.unit})` : ""}`, rows.length ? `| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n${rows.map((row) => `| ${row.join(" | ")} |`).join("\n")}` : (block.points || []).map((p) => `- ${p.label}: (${p.x}, ${p.y})`).join("\n")].join("\n"));
        break;
      }
      case "callout": out.push(`> **${block.title || block.variant}**${block.title ? "" : ""}\n> ${block.text.replace(/\n/g, "\n> ")}`); break;
      case "quote": out.push(`> ${block.text}${block.cite ? `\n> — ${block.cite}` : ""}`); break;
      case "equation": out.push(`$$\n${block.latex}\n$$`); break;
      case "code": out.push(`\`\`\`${block.lang || ""}\n${block.text}\n\`\`\``); break;
      case "stats": out.push(block.items.map((item) => `- **${item.value}** ${item.label}${item.note ? ` (${item.note})` : ""}`).join("\n")); break;
      case "cards": case "steps": out.push(block.items.map((item, i) => `${block.type === "steps" ? `${i + 1}. ` : "- "}**${item.title}**${item.text ? ` ${item.text}` : ""}`).join("\n")); break;
      case "fields": out.push(block.items.map((item) => `- **${item.label}:** ${item.value || "____"}`).join("\n")); break;
      case "problem": out.push(`### ${[block.label, block.title].filter(Boolean).join(": ")}\n${block.text}`); break;
      case "answer": out.push(`**${block.label}:** ${block.text}`); break;
      case "entry": out.push([`**${[block.title, block.org].filter(Boolean).join(", ")}**${block.dates ? ` (${block.dates})` : ""}${block.location ? ` · ${block.location}` : ""}`, block.subtitle || "", block.text || "", ...block.bullets.map((b) => `- ${b}`)].filter(Boolean).join("\n")); break;
      case "references": out.push(`${block.title ? `### ${block.title}\n` : ""}${block.items.map((item) => `- ${item}`).join("\n")}`); break;
      case "figure": out.push(`![${block.caption || ""}](${block.src.startsWith("data:") ? "embedded-image" : block.src})`); break;
      case "divider": out.push("---"); break;
      default: break;
    }
  }
  return out.filter(Boolean).join("\n\n");
}

// DeckSpec normalisation. The deck writer (an LLM) produces this JSON; everything is clamped
// here so a malformed or oversized spec degrades to a smaller slide instead of a broken one.
//
// DeckSpec
//   { theme, title, subtitle, kicker, footer, source, date, author, organization, style,
//     slides: [ { type, section, eyebrow, title, subtitle, takeaway, source, notes, style, ...type fields } ] }
//   style: colour, font and visibility overrides (see style.js); chart.colors: ["RRGGBB", ...]
//
// Slide types and their fields
//   cover       title, subtitle, kicker, kpis[{value,unit,label}], meta[string], tagline
//   agenda      items[{title, body, meta}]
//   section     number, title, subtitle
//   summary     findings[{label, title, body}], kpis[{value,unit,label,note}]
//   chart       chart | charts[<=2], insights[{title,body}] | kpis[]
//   table       table{columns[], rows[][], highlight_row, status_column, align[]}, insights[] | kpis[]
//   kpis        kpis[{value,unit,label,note,delta,status}], body
//   comparison  columns[{title, tag, metric{value,unit,label}, points[], status}], verdict
//   timeline    items[{date, title, body, tag}]
//   process     steps[{title, body, metric}], note
//   cards       cards[{kicker, title, body, metric{value,unit,label}}]
//   statement   statement, attribution, points[{title, body}]
//   bignumber   value, unit, label, body, compare{value,unit,label}, points[{title,body}]
//   matrix      x_axis{low,high,label}, y_axis{low,high,label}, quadrants[4]{title, body, items[]}, highlight
//   decision    items[{title, body, owner, due, status}], rail{title, items[{title, body}]}
//   bullets     points[{title, body}]

import { hex, normalizeStyle } from "./style.js";
import { THEME_NAMES, chooseTheme } from "./themes.js";

const TYPES = new Set([
  "cover", "agenda", "section", "summary", "chart", "table", "kpis", "comparison",
  "timeline", "process", "diagram", "cards", "statement", "bignumber", "matrix", "decision", "bullets"
]);

const TYPE_ALIASES = {
  title: "cover", intro: "cover", "exec-summary": "summary", executive_summary: "summary", executive: "summary",
  overview: "summary", findings: "summary", divider: "section", chapter: "section", metrics: "kpis",
  dashboard: "kpis", stats: "kpis", compare: "comparison", versus: "comparison", options: "comparison",
  roadmap: "timeline", plan: "timeline", milestones: "timeline", flow: "process", steps: "process",
  grid: "cards", pillars: "cards", features: "cards", quote: "statement", big_number: "bignumber",
  hero: "bignumber", "2x2": "matrix", quadrant: "matrix", decisions: "decision", asks: "decision",
  recommendation: "decision", next_steps: "decision", closing: "decision", list: "bullets", text: "bullets",
  content: "bullets", data: "chart", graph: "chart"
};

export function str(value, max = 400) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return "";
  const text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*\n]+)(?<!\*)\*(?!\*)/g, "$1")
    .trim();
  if (text.length <= max) return text;
  // Over the limit: end on a whole word, never mid-word ("input toke").
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

function list(value, max) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined).slice(0, max) : [];
}

function num(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").replace(/[,\s]/g, "").replace(/[−–]/g, "-");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function item(value, { title = 140, body = 320 } = {}) {
  if (typeof value === "string" || typeof value === "number") return { title: "", body: str(value, body) };
  if (!value || typeof value !== "object") return null;
  return {
    label: str(value.label || value.kicker || value.tag, 40),
    title: str(value.title || value.heading || value.name || value.headline, title),
    body: str(value.body || value.text || value.description || value.detail || value.content, body),
    meta: str(value.meta || value.time || value.date || value.owner, 60)
  };
}

function items(value, max, sizes) {
  return list(value, max).map((entry) => item(entry, sizes)).filter((entry) => entry && (entry.title || entry.body));
}

// A unit sits beside the number in a smaller size, so it has to be short ("%", "×", "pts",
// "$/1M"). A phrase such as "per 1M cached input tokens" moves in front of the label instead.
const SHORT_UNIT = /^(?:[%×x$€£¥]|pts?|bps|pp|[kmb]|bn|mn|tn|k\+?|hrs?|h|days?|wks?|mos?|yrs?|ms|s|min|gb|tb|mb|kg|t|km|mi)$/i;

export function splitUnit(unit, label) {
  const text = String(unit || "").trim();
  if (!text || (text.length <= 12 && text.split(/\s+/).length <= 2)) return { unit: text, label };
  const [first, ...rest] = text.split(/\s+/);
  // "million solar masses" keeps its magnitude beside the number: 4 M, then "solar masses".
  const magnitude = { thousand: "k", million: "M", billion: "B", trillion: "T" }[first.toLowerCase()];
  const keep = magnitude || (SHORT_UNIT.test(first) ? first : "");
  const phrase = (keep ? rest.join(" ") : text).trim();
  return { unit: keep, label: [label, phrase].filter(Boolean).join(" · ") };
}

function kpi(value) {
  if (!value || typeof value !== "object") return null;
  const split = splitUnit(str(value.unit || value.suffix, 60), str(value.label || value.title || value.name, 90));
  const out = {
    value: str(value.value ?? value.number ?? value.metric, 24),
    unit: split.unit,
    label: str(split.label, 140),
    note: str(value.note || value.detail || value.body || value.context, 140),
    delta: str(value.delta || value.change, 30),
    status: str(value.status, 30)
  };
  return out.value ? out : null;
}

// A KPI tile states a figure; a word such as "Quarterly" or "High" in the value slot is filler.
function figure(value) {
  const entry = kpi(value);
  return entry && /\d/.test(entry.value) ? entry : null;
}

function kpis(value, max) {
  return list(value, max).map(figure).filter(Boolean);
}

// "2 families", "5 versions compared": a count of what the request itself listed, not a finding.
const SCOPE_COUNT = /\b(famil(?:y|ies)|versions?|variants?|models?|products?|options?|items?|topics?|sections?|slides?|categories|tiers?|compared|covered|in scope|analy[sz]ed|reviewed|evaluated|included)\b/i;

function isScopeCount(entry) {
  return /^\d{1,2}$/.test(entry.value.trim()) && !entry.unit && !entry.delta && SCOPE_COUNT.test(entry.label);
}

// Cells a writer uses when it has no data. A column or row made only of these carries nothing.
// "From CRM" / "From price list" point at a system instead of giving a value; "From Europe" is data.
const PLACEHOLDER_CELL = /^(?:to (?:be )?(?:populate|populated|confirm|confirmed|determine|determined|add|added|come|verify|verified|source|sourced)|tbd|tbc|tba|n\/?a|pending|unknown|placeholder|not (?:yet )?(?:available|known|provided|public)|x{2,}|\?+|[-–—]+|\[[^\]]*\]|(?:pull |sourced? )?from (?:the )?(?:crm|erp|finance|sales|billing|internal|price ?list|pricing (?:page|sheet|team)|data ?(?:team|warehouse|base)|system|source|vendor|client|customer)(?: [a-z]+)?)\.?$/i;

export function isPlaceholderCell(cell) {
  const text = String(cell ?? "").trim();
  return !text || PLACEHOLDER_CELL.test(text);
}

// A placeholder the writer typed in place of data. Blanks, dashes and "N/A" can be real answers
// in a sparse matrix, so they do not count against a table.
export function isWriterGap(cell) {
  const text = String(cell ?? "").trim();
  return Boolean(text) && !/^(?:[-–—]+|n\/?a)\.?$/i.test(text) && PLACEHOLDER_CELL.test(text);
}

function chart(value) {
  if (!value || typeof value !== "object") return null;
  const type = str(value.type || value.kind, 20).toLowerCase().replace(/[\s_-]+/g, "");
  const typeMap = {
    column: "column", columns: "column", vbar: "column", bar: "column", barchart: "column",
    hbar: "hbar", horizontalbar: "hbar", barh: "hbar", ranking: "hbar", ranked: "hbar",
    line: "line", trend: "line", area: "area", combo: "combo", barline: "combo",
    stacked: "stacked", stackedcolumn: "stacked", stackedbar: "stackedbar", stacked100: "stacked100", mix: "stacked100",
    donut: "donut", doughnut: "donut", pie: "pie", waterfall: "waterfall", bridge: "waterfall",
    progress: "progress", bullet: "progress", scatter: "scatter", bubble: "scatter"
  };
  const categories = list(value.categories || value.labels || value.x, 16).map((entry) => str(entry, 40));
  let series = list(value.series, 6).map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    return {
      name: str(entry.name || entry.label, 50) || "Value",
      values: list(entry.values || entry.data, 16).map(num),
      type: str(entry.type, 10).toLowerCase() === "line" ? "line" : "",
      axis: str(entry.axis, 12).toLowerCase() === "secondary" ? "secondary" : ""
    };
  }).filter(Boolean);
  if (!series.length && Array.isArray(value.values)) {
    series = [{ name: str(value.name || value.title, 50) || "Value", values: list(value.values, 16).map(num), type: "", axis: "" }];
  }
  const points = list(value.points || value.items, 16).map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    return {
      label: str(entry.label || entry.name || entry.title, 60),
      value: num(entry.value ?? entry.y),
      x: num(entry.x),
      y: num(entry.y ?? entry.value),
      size: num(entry.size),
      display: str(entry.display || entry.value_label, 30),
      note: str(entry.note || entry.detail, 90),
      status: str(entry.status, 24),
      target: num(entry.target),
      total: Boolean(entry.total)
    };
  }).filter((entry) => entry && entry.label);
  const kind = typeMap[type] || (points.length && !series.length ? "hbar" : "column");
  if (!points.length && (!categories.length || !series.some((entry) => entry.values.some((v) => v !== null)))) return null;
  if (points.length && !categories.length && !series.length && !["hbar", "waterfall", "progress", "scatter", "donut", "pie"].includes(kind)) {
    categories.push(...points.map((point) => point.label));
    series.push({ name: str(value.unit, 40) || "Value", values: points.map((point) => point.value), type: "", axis: "" });
  }
  const highlight = value.highlight ?? value.highlight_index ?? value.focus;
  return {
    type: kind,
    title: str(value.title || value.label, 120),
    unit: str(value.unit || value.y_label || value.value_label, 40),
    categories,
    series: series.map((entry) => ({ ...entry, values: categories.map((_, index) => entry.values[index] ?? null) })),
    points,
    highlight: typeof highlight === "number" ? highlight : str(highlight, 40),
    format: str(value.format || value.number_format, 20),
    note: str(value.note || value.caption, 200),
    target: num(value.target ?? value.threshold),
    targetLabel: str(value.target_label || value.threshold_label, 40),
    xLabel: str(value.x_label || value.x_axis, 40),
    yLabel: str(value.y_label || value.y_axis, 40),
    colors: list(value.colors, 8).map(hex).filter(Boolean)
  };
}

function table(value) {
  if (!value || typeof value !== "object") return null;
  let columns = list(value.columns || value.headers, 8).map((entry) => str(typeof entry === "object" ? entry?.label || entry?.name : entry, 60));
  let rows = list(value.rows || value.data, 14).map((row) => {
    if (Array.isArray(row)) return row.slice(0, 8).map((cell) => str(cell, 180));
    if (row && typeof row === "object") return columns.map((column) => str(row[column], 180));
    return null;
  }).filter(Boolean);
  if (!columns.length && rows.length) {
    columns = rows[0];
    rows = rows.slice(1);
  }
  if (!columns.length || !rows.length) return null;
  rows = rows.map((row) => columns.map((_, index) => row[index] ?? ""));
  // A table that is mostly placeholders has no data behind its title ("Price snapshot" with no
  // prices); pruning it would leave a shell that still claims to show it.
  const cells = rows.flatMap((row) => row.slice(1));
  if (cells.length && cells.filter(isWriterGap).length / cells.length > 0.4) return null;
  // Drop the columns and rows the writer could only fill with placeholders ("To populate"),
  // carrying the highlight and status indexes over to what is left.
  const keptColumns = columns.map((_, index) => index).filter((index) => index === 0 || rows.some((row) => !isPlaceholderCell(row[index])));
  const keptRows = rows.map((_, index) => index).filter((index) => keptColumns.slice(1).some((column) => !isPlaceholderCell(rows[index][column])));
  if (keptColumns.length < 2 || !keptRows.length) return null;
  const highlight = value.highlight_row ?? value.highlight;
  const statusColumn = typeof value.status_column === "number" ? keptColumns.indexOf(value.status_column) : -1;
  columns = keptColumns.map((index) => columns[index]);
  rows = keptRows.map((index) => keptColumns.map((column, at) => (at > 0 && isPlaceholderCell(rows[index][column]) ? "—" : rows[index][column])));
  return {
    title: str(value.title || value.caption, 120),
    columns,
    rows,
    highlightRow: typeof highlight === "number" ? keptRows.indexOf(highlight) : rows.findIndex((row) => str(highlight, 60) && row[0] === str(highlight, 60)),
    statusColumn: typeof value.status_column === "number" ? statusColumn : columns.findIndex((column) => /^(status|state|result|rag|verdict|assessment)$/i.test(column)),
    note: str(value.note, 200)
  };
}

function slide(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  let type = str(raw.type || raw.layout, 30).toLowerCase().replace(/\s+/g, "_");
  type = TYPE_ALIASES[type] || type;
  if (!TYPES.has(type)) type = raw.chart ? "chart" : raw.table ? "table" : index === 0 ? "cover" : "bullets";
  const base = {
    type,
    section: str(raw.section, 40),
    eyebrow: str(raw.eyebrow || raw.kicker_label, 80),
    title: str(raw.title || raw.headline, 180),
    subtitle: str(raw.subtitle || raw.basis || raw.scope, 220),
    takeaway: str(raw.takeaway || raw.so_what || raw.conclusion, 260),
    takeawayLabel: str(raw.takeaway_label, 24),
    source: str(raw.source || raw.sources, 220),
    notes: str(raw.notes || raw.speaker_notes, 3000),
    style: normalizeStyle(raw.style)
  };
  switch (type) {
    case "cover":
      return {
        ...base,
        kicker: str(raw.kicker, 90),
        kpis: kpis(raw.kpis || raw.metrics, 4).filter((entry) => !isScopeCount(entry)),
        meta: list(raw.meta, 4).map((entry) => str(typeof entry === "object" ? `${entry.label || ""}${entry.label ? ": " : ""}${entry.value || ""}` : entry, 80)).filter(Boolean),
        tagline: str(raw.tagline, 160)
      };
    case "agenda":
      return { ...base, items: items(raw.items || raw.points, 7, { title: 90, body: 160 }) };
    case "section":
      return { ...base, number: str(raw.number, 6) };
    case "summary":
      return { ...base, findings: items(raw.findings || raw.points || raw.items, 5, { title: 120, body: 280 }), kpis: kpis(raw.kpis || raw.metrics, 4) };
    case "chart": {
      const charts = [raw.chart, ...list(raw.charts, 2)].map(chart).filter(Boolean).slice(0, 2);
      return { ...base, charts, insights: items(raw.insights || raw.points, 4, { title: 90, body: 240 }), kpis: kpis(raw.kpis || raw.metrics, 4) };
    }
    case "table": {
      const drawn = table(raw.table || raw);
      const source = raw.table || raw;
      // Nothing real behind the table: its insights were written about data that is not there.
      const gap = !drawn && list(source.rows || source.data, 14).some((row) => (Array.isArray(row) ? row : Object.values(row || {})).some(isWriterGap));
      return { ...base, table: drawn, gap, insights: items(raw.insights || raw.points, 4, { title: 90, body: 220 }), kpis: kpis(raw.kpis || raw.metrics, 3) };
    }
    case "kpis":
      return { ...base, kpis: kpis(raw.kpis || raw.metrics || raw.items, 6), body: str(raw.body || raw.text, 400) };
    case "comparison":
      return {
        ...base,
        columns: list(raw.columns || raw.options || raw.items, 3).map((column) => (column && typeof column === "object" ? {
          title: str(column.title || column.name, 60),
          tag: str(column.tag || column.label, 40),
          metric: figure(column.metric || {}),
          points: list(column.points || column.items, 6).map((point) => str(typeof point === "object" ? [point.title, point.body].filter(Boolean).join(": ") : point, 200)).filter(Boolean),
          status: str(column.status, 30),
          highlight: Boolean(column.highlight || column.recommended)
        } : null)).filter((column) => column && column.title),
        verdict: str(raw.verdict, 220)
      };
    case "timeline":
      return { ...base, items: list(raw.items || raw.phases || raw.milestones, 6).map((entry) => (entry && typeof entry === "object" ? {
        date: str(entry.date || entry.when || entry.phase, 40),
        title: str(entry.title || entry.name, 90),
        body: str(entry.body || entry.text || entry.description, 220),
        tag: str(entry.tag || entry.gate || entry.metric, 60),
        highlight: Boolean(entry.highlight || entry.current)
      } : null)).filter((entry) => entry && (entry.title || entry.body)) };
    case "process":
      return { ...base, steps: list(raw.steps || raw.items, 5).map((entry) => (entry && typeof entry === "object" ? {
        title: str(entry.title || entry.name, 70),
        body: str(entry.body || entry.text || entry.description, 220),
        metric: str(entry.metric || entry.tag, 50)
      } : null)).filter((entry) => entry && entry.title), note: str(raw.note, 200) };
    case "diagram": {
      const ids = new Set();
      const nodes = list(raw.nodes, 6).filter((entry) => entry && str(entry.id, 40) && str(entry.label, 80)).map((entry) => ({
        id: str(entry.id, 40), label: str(entry.label, 80), detail: str(entry.detail, 160),
        column: Math.max(0, Math.min(2, Math.round(num(entry.column) ?? 0))),
        row: Math.max(0, Math.min(1, Math.round(num(entry.row) ?? 0)))
      })).filter((node) => { if (ids.has(node.id)) return false; ids.add(node.id); return true; });
      // Two nodes asked for the same cell: the later one takes the next free cell instead of
      // being drawn on top of the first.
      const taken = new Set();
      for (const node of nodes) {
        let cell = node.row * 3 + node.column;
        while (taken.has(cell)) cell = (cell + 1) % 6;
        taken.add(cell);
        node.row = Math.floor(cell / 3);
        node.column = cell % 3;
      }
      const edges = list(raw.edges, 8).filter((edge) => ids.has(edge?.from) && ids.has(edge?.to) && edge.from !== edge.to)
        .map((edge) => ({ from: edge.from, to: edge.to, label: str(edge.label, 80) }))
        // Two arrows for the same pair and direction would draw on top of each other: one arrow, both labels.
        .filter((edge, index, all) => {
          const first = all.findIndex((other) => other.from === edge.from && other.to === edge.to);
          if (first === index) return true;
          if (edge.label) all[first].label = [all[first].label, edge.label].filter(Boolean).join(" · ");
          return false;
        });
      return { ...base, nodes, edges };
    }
    case "cards":
      return { ...base, cards: list(raw.cards || raw.items, 6).map((entry) => (entry && typeof entry === "object" ? {
        kicker: str(entry.kicker || entry.label || entry.tag, 40),
        title: str(entry.title || entry.name, 80),
        body: str(entry.body || entry.text || entry.description, 260),
        metric: figure(entry.metric || {})
      } : null)).filter((entry) => entry && (entry.title || entry.body)) };
    case "statement":
      return { ...base, statement: str(raw.statement || raw.quote || raw.text, 260), attribution: str(raw.attribution || raw.author, 100), points: items(raw.points || raw.items, 3, { title: 60, body: 200 }) };
    case "bignumber": {
      const split = splitUnit(str(raw.unit, 60), str(raw.label, 120));
      return {
        ...base,
        value: str(raw.value ?? raw.number, 16),
        unit: split.unit,
        label: str(split.label, 180),
        body: str(raw.body || raw.text, 360),
        compare: kpi(raw.compare || {}),
        points: items(raw.points || raw.items, 3, { title: 70, body: 200 })
      };
    }
    case "matrix": {
      const axis = (value) => ({ label: str(value?.label, 40), low: str(value?.low, 30), high: str(value?.high, 30) });
      const quadrants = list(raw.quadrants, 4).map((entry) => (entry && typeof entry === "object" ? {
        title: str(entry.title, 60),
        body: str(entry.body || entry.text, 200),
        items: list(entry.items, 5).map((value) => str(typeof value === "object" ? value.title || value.label : value, 60)).filter(Boolean)
      } : { title: "", body: "", items: [] }));
      while (quadrants.length < 4) quadrants.push({ title: "", body: "", items: [] });
      const highlight = num(raw.highlight);
      return { ...base, xAxis: axis(raw.x_axis), yAxis: axis(raw.y_axis), quadrants, highlight: highlight === null ? -1 : highlight };
    }
    case "decision":
      return {
        ...base,
        items: list(raw.items || raw.decisions || raw.asks, 5).map((entry) => (entry && typeof entry === "object" ? {
          title: str(entry.title, 120),
          body: str(entry.body || entry.text, 260),
          owner: str(entry.owner, 50),
          due: str(entry.due || entry.date || entry.deadline, 40),
          status: str(entry.status, 30)
        } : null)).filter((entry) => entry && entry.title),
        rail: raw.rail && typeof raw.rail === "object"
          ? { title: str(raw.rail.title, 50), items: items(raw.rail.items, 4, { title: 70, body: 160 }) }
          : null
      };
    default:
      return { ...base, type: "bullets", points: items(raw.points || raw.bullets || raw.items, 8, { title: 90, body: 260 }) };
  }
}

// Drop slides that ended up with nothing to show, so the renderer never draws an empty frame.
function hasBody(entry) {
  switch (entry.type) {
    case "cover":
    case "section": return Boolean(entry.title);
    case "agenda": return entry.items.length > 0;
    case "summary": return entry.findings.length > 0;
    case "chart": return entry.charts.length > 0;
    case "table": return Boolean(entry.table);
    case "kpis": return entry.kpis.length > 0;
    case "comparison": return entry.columns.length >= 2;
    case "timeline": return entry.items.length >= 2;
    case "process": return entry.steps.length >= 2;
    case "diagram": return entry.nodes.length >= 2 && entry.edges.length > 0;
    case "cards": return entry.cards.length >= 2;
    case "statement": return Boolean(entry.statement);
    case "bignumber": return Boolean(entry.value);
    case "matrix": return entry.quadrants.some((quadrant) => quadrant.title || quadrant.body);
    case "decision": return entry.items.length > 0;
    default: return entry.points.length > 0;
  }
}

// A slide whose body failed validation still carries its text; keep that text as bullets.
function salvage(entry, raw) {
  if (entry.gap) return null;
  const points = [];
  const push = (value) => {
    const text = str(typeof value === "object" && value ? [value.title || value.label, value.body || value.text || value.value].filter(Boolean).join(": ") : value, 260);
    if (text) points.push({ title: "", body: text });
  };
  for (const key of ["points", "items", "findings", "insights", "cards", "steps", "kpis", "bullets"]) {
    for (const value of list(raw?.[key], 8)) push(value);
  }
  if (!points.length && entry.takeaway) points.push({ title: "", body: entry.takeaway });
  return points.length ? { ...entry, type: "bullets", points: points.slice(0, 8) } : null;
}

// The raw spec reshaped so slide N is page N of the rendered deck: slides the renderer would
// drop are removed, salvaged ones become bullets, and a missing cover is added. Edits address
// pages, so the stored spec must line up with them.
function alignSlide(entry, index) {
  const normalized = slide(entry, index);
  if (!normalized) return null;
  if (hasBody(normalized)) return normalized.type === "chart" ? alignCharts({ ...entry, type: "chart" }) : { ...entry, type: normalized.type };
  const rescued = salvage(normalized, entry);
  return rescued && rescued.title ? { ...entry, type: "bullets", points: rescued.points } : null;
}

// Chart slides are stored one way so edit paths match what is drawn: "chart" when the slide has
// one chart, "charts" (two entries) when it has two. The renderer draws chart then charts[],
// skipping invalid ones, at most two.
function alignCharts(entry) {
  const drawn = [entry.chart, ...list(entry.charts, 2)].filter((value) => chart(value)).slice(0, 2);
  const { chart: _chart, charts: _charts, ...rest } = entry;
  return drawn.length === 1 ? { ...rest, chart: drawn[0] } : { ...rest, charts: drawn };
}

// 1-based positions of slides alignDeck would drop because nothing drawable is left on them.
export function emptySlides(raw) {
  const slides = Array.isArray(raw?.slides) ? raw.slides : [];
  return slides.map((entry, index) => (alignSlide(entry, index) ? 0 : index + 1)).filter(Boolean);
}

export function alignDeck(raw, fallback = {}) {
  const deck = raw && typeof raw === "object" ? raw : {};
  const slides = [];
  list(deck.slides, 24).forEach((entry, index) => {
    const kept = alignSlide(entry, index);
    if (kept) slides.push(kept);
  });
  if (!slides.length || slides[0].type !== "cover") {
    slides.unshift({ type: "cover", title: str(deck.title || fallback.title, 180) || "Presentation", subtitle: str(deck.subtitle || fallback.subtitle, 220), kicker: str(deck.kicker, 90) });
  }
  return { ...deck, slides };
}

export function normalizeDeck(raw, fallback = {}) {
  const deck = raw && typeof raw === "object" ? raw : {};
  const rawSlides = list(deck.slides, 24);
  const slides = [];
  rawSlides.forEach((entry, index) => {
    const normalized = slide(entry, index);
    if (!normalized) return;
    if (hasBody(normalized)) slides.push(normalized);
    else {
      const rescued = salvage(normalized, entry);
      if (rescued && rescued.title) slides.push(rescued);
    }
  });
  const title = str(deck.title || fallback.title, 180) || slides.find((entry) => entry.type === "cover")?.title || "Presentation";
  if (!slides.length || slides[0].type !== "cover") {
    slides.unshift({ type: "cover", title, subtitle: str(deck.subtitle || fallback.subtitle, 220), kicker: str(deck.kicker, 90), kpis: [], meta: [], tagline: "", section: "", eyebrow: "", takeaway: "", source: "", notes: "", style: null });
  }
  // A "source" that is just this deck's own name cites nothing.
  const own = (value) => String(value || "").replace(/\*\*/g, "").toLowerCase().replace(/^source:\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const selfCited = (value) => value && [title, fallback.title, deck.footer].some((name) => name && own(name) === own(value));
  for (const entry of slides) if (selfCited(entry.source)) entry.source = "";
  const deckSource = selfCited(str(deck.source, 220)) ? "" : str(deck.source, 220);
  const text = [title, deck.subtitle, fallback.instructions, ...slides.map((entry) => entry.title)].join(" ");
  const theme = THEME_NAMES.includes(String(deck.theme || "").toLowerCase()) ? String(deck.theme).toLowerCase() : chooseTheme(text);
  return {
    theme,
    title,
    subtitle: str(deck.subtitle || fallback.subtitle, 220),
    kicker: str(deck.kicker, 90),
    footer: str(deck.footer || deck.running_title, 90) || title.slice(0, 90),
    source: deckSource,
    date: str(deck.date, 40),
    author: str(deck.author || deck.organization || deck.org, 80),
    style: normalizeStyle(deck.style),
    slides
  };
}

// The deck exactly as the renderer lays it out: normalized, with the chapter list and the
// comparison verdict standing in for a missing takeaway.
export function prepareDeck(raw, fallback = {}) {
  const deck = normalizeDeck(raw, fallback);
  deck.sections = [];
  for (const slide of deck.slides) {
    if (slide.type === "comparison" && !slide.takeaway && slide.verdict) slide.takeaway = slide.verdict;
    if (slide.section && slide.type !== "cover" && !deck.sections.includes(slide.section)) deck.sections.push(slide.section);
  }
  return deck;
}

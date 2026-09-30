// Deck renderer entry: DeckSpec JSON -> editable .pptx (native text, shapes, tables, charts).
import pptxgen from "pptxgenjs";

import { Painter, W, H } from "./core.js";
import { renderSlide } from "./layouts.js";
import { normalizeDeck, str } from "./spec.js";
import { styledTheme } from "./style.js";
import { THEMES } from "./themes.js";

export function prepareDeck(raw, fallback = {}) {
  const deck = normalizeDeck(raw, fallback);
  deck.sections = [];
  for (const slide of deck.slides) {
    if (slide.type === "comparison" && !slide.takeaway && slide.verdict) slide.takeaway = slide.verdict;
    if (slide.section && slide.type !== "cover" && !deck.sections.includes(slide.section)) deck.sections.push(slide.section);
  }
  return deck;
}

export async function renderDeck(raw, outputPath, fallback = {}) {
  const deck = prepareDeck(raw, fallback);
  const theme = THEMES[deck.theme];
  const pptx = new pptxgen();
  pptx.defineLayout({ name: "KLUI_WIDE", width: W, height: H });
  pptx.layout = "KLUI_WIDE";
  pptx.author = deck.author || "Klui";
  pptx.company = "Klui";
  pptx.title = deck.title;
  pptx.subject = deck.subtitle || deck.title;
  const deckTheme = styledTheme(theme, deck.style, null);
  pptx.theme = { headFontFace: deckTheme.fonts.title, bodyFontFace: deckTheme.fonts.body };
  const ctx = { exhibit: 0 };
  const warnings = [];
  deck.slides.forEach((spec, index) => {
    const slide = pptx.addSlide();
    const slideTheme = styledTheme(theme, deck.style, spec.style);
    let painter = new Painter(pptx, slide, slideTheme, deck);
    try {
      renderSlide(painter, deck, spec, index, deck.slides.length, ctx);
    } catch (error) {
      // Never ship a half-drawn slide: wipe it and redraw its text as a plain bullet slide.
      const fallback = fallbackSlide(spec);
      if (!fallback) throw new Error(`slide ${index + 1} (${spec.type}) could not be rendered: ${error?.message || error}`);
      slide._slideObjects.length = 0;
      painter = new Painter(pptx, slide, slideTheme, deck);
      try {
        renderSlide(painter, deck, fallback, index, deck.slides.length, ctx);
      } catch (retryError) {
        throw new Error(`slide ${index + 1} (${spec.type}) could not be rendered: ${retryError?.message || retryError}`);
      }
      warnings.push(`slide ${index + 1}: ${spec.type} layout failed (${error?.message || error}); shown as bullets`);
    }
    warnings.push(...painter.warnings.map((warning) => `slide ${index + 1}: ${warning}`));
    if (spec.notes) slide.addNotes(spec.notes);
  });
  await pptx.writeFile({ fileName: outputPath });
  return { deck, warnings };
}

// Every text field of a slide that failed to lay out, as points for the bullets layout.
function fallbackSlide(spec) {
  const points = [];
  const seen = new Set();
  const walk = (value, depth = 0) => {
    if (points.length >= 6 || depth > 3 || value == null) return;
    if (typeof value === "string" || typeof value === "number") {
      const text = str(value, 260);
      if (text && !seen.has(text)) {
        seen.add(text);
        points.push({ title: "", body: text });
      }
      return;
    }
    if (Array.isArray(value)) value.forEach((item) => walk(item, depth + 1));
    else if (typeof value === "object") {
      const joined = [value.title || value.label || value.name, value.body || value.text || value.value || value.detail].filter(Boolean).join(": ");
      if (joined) walk(joined, depth + 1);
    }
  };
  for (const key of ["points", "items", "cards", "steps", "events", "kpis", "quadrants", "options", "columns", "left", "right", "body", "statement", "value"]) walk(spec[key]);
  const title = spec.title || spec.statement || "";
  if (!title && !points.length) return null;
  return { ...spec, type: "bullets", title: title || "Summary", points: points.length ? points : [{ title: "", body: spec.takeaway || title }] };
}

// ---------------------------------------------------------------------------------------------
// Markdown / sections input (no deck spec) -> DeckSpec, so every PPTX request uses the new
// renderer even when the deck writer was unavailable.

function splitLead(text) {
  const value = str(text, 320);
  const match = value.match(/^([^:.!?]{3,60}):\s+(.+)$/);
  return match ? { title: match[1], body: match[2] } : { title: "", body: value };
}

export function deckFromMarkdown(input) {
  const title = str(input.title, 180) || "Presentation";
  const text = String(input.content || input.source_text || input.data?.content || "").replace(/\r\n?/g, "\n");
  const slides = [{ type: "cover", title, subtitle: str(input.instructions, 200) }];
  let current = null;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      const headingText = str(heading[1], 180);
      if (!slides.length || headingText.toLowerCase() !== title.toLowerCase()) {
        current = { type: "bullets", title: headingText, points: [] };
        slides.push(current);
      }
      continue;
    }
    if (line.includes("|") && /^\|?\s*:?-{3,}/.test((lines[index + 1] || "").trim())) {
      const split = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const columns = split(line);
      const rowsData = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        rowsData.push(split(lines[index]));
        index += 1;
      }
      index -= 1;
      const tableSlide = { type: "table", title: current?.title || "Key figures", table: { columns, rows: rowsData } };
      if (current && !current.points.length) slides[slides.indexOf(current)] = tableSlide;
      else slides.push(tableSlide);
      current = null;
      continue;
    }
    const bullet = line.replace(/^([-*•]|\d+[.)])\s+/, "");
    if (!current) {
      current = { type: "bullets", title: "Overview", points: [] };
      slides.push(current);
    }
    current.points.push(splitLead(bullet));
  }
  for (const section of Array.isArray(input.sections) ? input.sections.slice(0, 20) : []) {
    const points = String(section.content || section.text || "").split(/\n+/).map((entry) => entry.replace(/^([-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean).map(splitLead);
    if (points.length) slides.push({ type: "bullets", title: str(section.heading || section.title, 180), points });
  }
  for (const table of Array.isArray(input.tables) ? input.tables.slice(0, 6) : []) {
    const columns = table.headers || table.columns;
    if (Array.isArray(columns) && Array.isArray(table.rows)) slides.push({ type: "table", title: str(table.title || table.caption, 180) || "Data", table: { columns, rows: table.rows } });
  }
  // Long bullet runs split so no slide carries more than six points.
  const out = [];
  for (const slide of slides) {
    if (slide.type === "bullets" && slide.points.length > 6) {
      for (let start = 0; start < slide.points.length; start += 6) {
        out.push({ ...slide, title: start ? `${slide.title} (continued)` : slide.title, points: slide.points.slice(start, start + 6) });
      }
    } else if (slide.type !== "bullets" || slide.points.length) {
      out.push(slide);
    }
  }
  return { theme: input.theme && THEMES[input.theme] ? input.theme : "", title, slides: out };
}

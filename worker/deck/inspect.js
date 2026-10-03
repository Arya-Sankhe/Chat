// Dry-run layout: runs every slide through the real layouts against a stub slide, so the deck
// writer can see which text would be clipped and which table rows would not fit before anything
// is rendered. Needs no pptxgenjs, so the server can call it too.
import { Painter } from "./core.js";
import { renderSlide } from "./layouts.js";
import { prepareDeck } from "./spec.js";
import { styledTheme } from "./style.js";
import { THEMES } from "./themes.js";

const names = new Proxy({}, { get: (_, key) => String(key) });

function stubSlide() {
  return { background: null, _slideObjects: [], addText() {}, addShape() {}, addChart() {}, addTable() {}, addImage() {}, addNotes() {} };
}

// Returns [{ page, type, title, warnings: [..] }] for pages with layout problems.
export function inspectDeck(raw, fallback = {}) {
  const deck = prepareDeck(raw, fallback);
  const theme = THEMES[deck.theme];
  const pptx = { ShapeType: names, ChartType: names, shapes: names, charts: names };
  const ctx = { exhibit: 0 };
  const problems = [];
  deck.slides.forEach((spec, index) => {
    const painter = new Painter(pptx, stubSlide(), styledTheme(theme, deck.style, spec.style), deck);
    let warnings;
    try {
      renderSlide(painter, deck, spec, index, deck.slides.length, ctx);
      warnings = painter.warnings;
    } catch (error) {
      warnings = [`layout failed (${error?.message || error}); it would be drawn as plain bullets`];
    }
    if (warnings.length) problems.push({ page: index + 1, type: spec.type, title: spec.title, warnings: [...new Set(warnings)] });
  });
  return { deck, problems };
}

// What each slide draws, as one string per slide: every shape, text, chart, table and image call
// with its options, plus the background. Two decks whose strings match for a slide render that
// slide the same, so an edit can be checked against every place the renderer repeats a field
// (the cover's agenda, the section navigation, figure numbers, the deck footer and theme).
export function slideDrawings(raw, fallback = {}) {
  const deck = prepareDeck(raw, fallback);
  const theme = THEMES[deck.theme];
  const pptx = { ShapeType: names, ChartType: names, shapes: names, charts: names };
  const ctx = { exhibit: 0 };
  return deck.slides.map((spec, index) => {
    const calls = [];
    const record = (kind) => (...args) => { calls.push([kind, ...args]); };
    const slide = { background: null, _slideObjects: [], addText: record("text"), addShape: record("shape"), addChart: record("chart"), addTable: record("table"), addImage: record("image"), addNotes() {} };
    try {
      renderSlide(new Painter(pptx, slide, styledTheme(theme, deck.style, spec.style), deck), deck, spec, index, deck.slides.length, ctx);
    } catch (error) {
      calls.push(["failed", String(error?.message || error)]);
    }
    return JSON.stringify([slide.background, calls]);
  });
}

// Deck review: reads the writer's draft the way an editor would before it ships, and lists what
// is wrong in plain notes the writer can act on (placeholders, filler numbers, text that will not
// fit, slides that repeat or that the renderer would drop, figures the material never gave).
// deckWriter.js sends these notes back for bounded revisions.
import { inspectDeck } from "../../worker/deck/inspect.js";
import { emptySlides, isWriterGap, str, normalizeDeck } from "../../worker/deck/spec.js";

const PLACEHOLDER_TEXT = /\b(to be (?:populated|confirmed|determined|added|sourced)|to (?:populate|confirm)|tbd|tbc|\[(?:insert|add|tbd|placeholder)[^\]]*\]|placeholder|lorem ipsum|left to populate|data (?:not yet|pending))\b/i;
const CADENCE = /\b(?:quarterly|monthly|weekly|annual|bi-?weekly)\s+(?:refresh|review|cadence|update|check-?in|sync|reporting)\b/i;
const KPI_KEYS = ["kpis", "metrics"];
// Research hedges that belong in speaker notes, not on a slide the audience reads.
const HEDGE = /\b(?:unverified|not (?:yet )?(?:verified|established|stated)|could not (?:be )?(?:verified|confirmed|established)|cannot be (?:verified|confirmed)|unclear from (?:the )?sources?|no (?:public|published) (?:data|figure|price)s?)\b/i;
// The writer's own framing leaking onto slides.
const META_TALK = /\b(?:(?:the|supplied|provided|given|source|course|class|lecture) materials?|(?:supplied|provided) (?:benchmark(?:s)?|recommendations?|figures|data|(?:business |decision |project )?brief)|(?:business|decision) brief|in the brief|the brief|(?:as )?(?:cited|listed|named) in the (?:provided |supplied )?material)\b/i;

function slideLabel(index, slide) {
  const title = str(slide?.title || slide?.statement || "", 60).replace(/\*\*/g, "");
  return `Slide ${index + 1}${title ? ` ("${title}")` : ""}`;
}

// Index fields hold positions, not data.
const INDEX_KEYS = new Set(["highlight", "highlight_row", "highlight_index", "status_column", "number", "size"]);

// Every text value of a slide, plus chart numbers when withNumbers is set.
function strings(value, out = [], { depth = 0, key = "", withNumbers = false } = {}) {
  if (depth > 6 || value == null || INDEX_KEYS.has(key)) return out;
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number" && withNumbers) out.push(String(value));
  else if (Array.isArray(value)) value.forEach((entry) => strings(entry, out, { depth: depth + 1, key, withNumbers }));
  else if (typeof value === "object") Object.entries(value).forEach(([name, entry]) => name !== "style" && strings(entry, out, { depth: depth + 1, key: name, withNumbers }));
  return out;
}

// Every KPI-like value on a slide: rails, card and comparison metrics, the big number.
function metricValues(slide) {
  const values = [];
  for (const key of KPI_KEYS) for (const entry of Array.isArray(slide?.[key]) ? slide[key] : []) values.push(entry);
  for (const card of Array.isArray(slide?.cards) ? slide.cards : []) if (card?.metric) values.push(card.metric);
  for (const column of Array.isArray(slide?.columns) && slide.type === "comparison" ? slide.columns : []) if (column?.metric) values.push(column.metric);
  return values.filter((entry) => entry && typeof entry === "object" && String(entry.value ?? "").trim());
}

function titleKey(text) {
  return str(text, 200).replace(/\*\*/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

// Numbers worth checking against the material: skips years, small counts and page references.
function figures(text) {
  const out = [];
  for (const match of String(text || "").matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![\w.])/g)) {
    const value = match[1].replace(/,/g, "");
    const number = Number(value);
    if (!Number.isFinite(number)) continue;
    if (Number.isInteger(number) && number <= 12) continue;
    if (Number.isInteger(number) && number >= 1900 && number <= 2100) continue;
    if (/p\.\s*$/i.test(String(text).slice(Math.max(0, match.index - 3), match.index))) continue;
    out.push(value.replace(/\.0+$/, ""));
  }
  return out;
}

function sourceFigures(material) {
  const known = new Set();
  for (const value of figures(material)) {
    known.add(value);
    const number = Number(value);
    // Rounded forms the writer may use for a material figure (4.25 -> 4.3, 4).
    known.add(String(Math.round(number)));
    known.add(String(Math.round(number * 10) / 10));
  }
  return known;
}

/**
 * Review a raw deck (the writer's JSON). `material` is everything the writer was given, used to
 * spot figures and process details it made up. Returns { notes: [string], score, errors } where a higher
 * score is a worse deck; an empty list means nothing to fix.
 */
export function reviewDeck(deck, { material = "", userRequest = "" } = {}) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const notes = [];
  let score = 0;
  let errors = 0;
  const note = (text, weight = 1) => {
    notes.push(text);
    score += weight;
  };
  const requested = userRequest.match(/\b(?:(under|fewer than|less than|at most|max(?:imum)?|up to|no more than|about|around|roughly|approximately|~)\s*)?(\d{1,2})[ -](?:slides?|pages?)\b/i);
  if (requested) {
    const count = Number(requested[2]);
    const bound = String(requested[1] || "").toLowerCase();
    const [low, high] = /^(under|fewer|less)/.test(bound) ? [1, count - 1]
      : /^(at most|max|up to|no more)/.test(bound) ? [1, count]
      : /^(about|around|roughly|approx|~)/.test(bound) ? [count - 1, count + 1]
      : [count, count];
    if (slides.length < low || slides.length > high) {
      // A missed count is a requirement, so it earns the second revision like a factual error.
      errors += 1;
      note(`FACT / REQUIREMENT: The user asked for ${requested[0].trim()} (including the cover); the draft has ${slides.length}. ${slides.length < low ? "Add a slide with real evidence (a chart, worked example or comparison the deck lacks), not a recap or filler." : "Merge or cut the weakest slides."}`, 3);
    }
  }

  slides.forEach((slide, index) => {
    if (!slide || typeof slide !== "object") return;
    const label = slideLabel(index, slide);
    const rows = Array.isArray(slide.table?.rows) ? slide.table.rows : [];
    const gaps = rows.flatMap((row) => (Array.isArray(row) ? row : Object.values(row || {}))).filter(isWriterGap);
    if (gaps.length) note(`${label}: ${gaps.length} table cells are placeholders (e.g. "${str(gaps[0], 40)}"). Fill them from the material or drop those rows/columns; if the table has no real data, use another exhibit or cut the slide.`, 3);
    const text = strings({ ...slide, notes: undefined, table: slide.table ? { ...slide.table, rows: [] } : undefined });
    for (const [key, limit] of Object.entries({ title: 180, subtitle: 220, takeaway: 260, source: 220 })) {
      if (typeof slide[key] === "string" && slide[key].length > limit) note(`${label}: ${key} exceeds ${limit} characters and normalization will truncate it. Shorten the visible text and move the detail to notes.`, 2);
    }
    const placeholder = text.find((value) => PLACEHOLDER_TEXT.test(value));
    if (placeholder && !gaps.length) note(`${label}: contains placeholder text ("${str(placeholder, 60)}"). Write the real content or remove it.`, 3);
    const wordy = metricValues(slide).filter((entry) => !/\d/.test(String(entry.value)));
    if (wordy.length) note(`${label}: metric "${str(wordy[0].value, 30)}" is a word, not a figure. Show a number from the material or leave the metric out.`, 2);
    if (slide.type === "cover") {
      const counts = (Array.isArray(slide.kpis) ? slide.kpis : []).filter((entry) => /^\d{1,2}$/.test(String(entry?.value ?? "").trim()) && !entry?.unit);
      if (counts.length) note(`${label}: cover KPI "${counts.map((entry) => `${entry.value} ${entry.label || ""}`.trim()).join('", "')}" just counts what the request listed. Use headline findings or no KPIs.`, 2);
    }
    if (slide.type === "bignumber" && slide.compare) {
      const amount = (entry) => `${entry.unit || ""}${entry.value || ""}`.replace(/[ ,]/g, "");
      if (amount(slide) === amount(slide.compare)) note(`${label}: the hero and comparison repeat the identical value. Use one figure labelled for both periods and remove the redundant comparison rail.`, 2);
    }
    const hedge = text.find((value) => HEDGE.test(value));
    if (hedge) note(`${label}: "${str(hedge, 70)}" puts a research caveat on the slide. Show what is known; drop the unknown item or say it once in plain words (e.g. "Price not published"), and keep verification detail in notes.`, 2);
    const meta = text.find((value) => META_TALK.test(value));
    if (meta) note(`${label}: "${str(meta, 70)}" talks about the brief ("the material", "user-provided"), which the audience never sees. Name the real source (e.g. the site or document the figures came from) or leave it out.`, 1);
    const cadence = text.map((value) => value.match(CADENCE)?.[0]).find(Boolean);
    if (cadence && !new RegExp(cadence.replace(/[-\s]+/g, "[-\\s]*"), "i").test(material)) note(`${label}: "${cadence}" is a process detail the material never mentions. Remove it unless the user asked for a process.`, 2);
  });

  // Slides the renderer would drop or flatten, and titles that repeat.
  for (const page of emptySlides(deck)) note(`${slideLabel(page - 1, slides[page - 1])}: has nothing the renderer can draw (empty or invalid exhibit) and would be dropped. Give it real content or cut it.`, 2);
  const seen = new Map();
  slides.forEach((slide, index) => {
    const key = titleKey(slide?.title);
    if (!key) return;
    if (seen.has(key)) note(`${slideLabel(index, slide)} repeats the title of slide ${seen.get(key) + 1}. Merge them or make each say something new.`, 2);
    else seen.set(key, index);
  });
  const types = slides.map((slide) => String(slide?.type || "").toLowerCase());
  for (let index = 2; index < types.length; index += 1) {
    if (types[index] && types[index] === types[index - 1] && types[index] === types[index - 2]) {
      note(`Slides ${index - 1}-${index + 1} are all "${types[index]}" layouts in a row. Vary the exhibits so each slide shows its point the best way.`, 1);
      break;
    }
  }

  // Comparable numbers shown only as a table: the pattern is what the audience remembers.
  const rendered = normalizeDeck(deck).slides;
  // A diagram box with no arrow in or out is a fact card, not part of the mechanism.
  rendered.forEach((slide, index) => {
    if (slide.type !== "diagram") return;
    const linked = new Set(slide.edges.flatMap((edge) => [edge.from, edge.to]));
    const loose = slide.nodes.filter((node) => !linked.has(node.id));
    if (loose.length) note(`${slideLabel(index, slide)}: diagram node${loose.length > 1 ? "s" : ""} "${loose.map((node) => str(node.label, 40)).join('", "')}" ${loose.length > 1 ? "have" : "has"} no arrow. Connect ${loose.length > 1 ? "them" : "it"} with a real relationship (an edge with a short label) or remove ${loose.length > 1 ? "them" : "it"} and say it in the takeaway.`, 2);
  });
  // Parallel items whose bodies are a few words read as an empty slide; they need the example,
  // figure or consequence that makes each one worth a box.
  rendered.forEach((slide, index) => {
    const entries = slide.type === "cards" ? slide.cards : slide.type === "process" ? slide.steps : slide.type === "summary" ? slide.findings : slide.type === "timeline" ? slide.items : [];
    const bodies = (entries || []).map((entry) => String(entry.body || "").replace(/\*\*/g, "").trim().split(/\s+/).filter(Boolean).length);
    if (bodies.length >= 2 && bodies.reduce((a, b) => a + b, 0) / bodies.length < 11) {
      note(`${slideLabel(index, slide)}: the ${slide.type === "process" ? "step" : "item"} bodies average under 11 words, so the slide reads empty. Give each one sentence or two with a concrete figure, example or consequence (key fact in **bold**), or merge the slide into a neighbour.`, 1);
    }
  });
  const content = rendered.filter((slide) => !["cover", "section", "agenda"].includes(slide.type));
  // One layout repeated across the deck reads like a template, whatever the content.
  const counts = new Map();
  for (const slide of content) counts.set(slide.type, (counts.get(slide.type) || 0) + 1);
  for (const [type, count] of counts) {
    if (type !== "chart" && type !== "table" && count >= 4 && count / content.length > 0.3) {
      note(`${count} of ${content.length} content slides are "${type}" layouts. Rebuild at least two of them as a different exhibit (diagram, statement with a quotation, timeline, comparison, matrix or chart) that shows their point better.`, 2);
    }
  }
  // A deck that is mostly tables reads like a spreadsheet; some of them belong in a chart,
  // comparison or big number.
  const tableSlides = content.filter((slide) => slide.type === "table").length;
  if (content.length >= 5 && tableSlides >= 3 && tableSlides / content.length > 0.34) {
    note(`${tableSlides} of ${content.length} content slides are tables. Keep the one table that carries exact values and turn the others into the exhibit that shows their point (a chart for numbers, a comparison for options, a bignumber for one decisive figure).`, 2);
  }
  // A rail beside a chart, table or big number is where the reading of the data goes; one with
  // no figure at all is filler ("Momentum is concentrated").
  rendered.forEach((slide, index) => {
    if (!["chart", "table", "bignumber"].includes(slide.type)) return;
    const rail = slide.type === "bignumber" ? slide.points : slide.insights;
    if (rail?.length >= 2 && !rail.some((entry) => /\d/.test(`${entry.title} ${entry.body}`))) {
      note(`${slideLabel(index, slide)}: the insights beside the exhibit carry no figures. Give each insight the number from the exhibit or material that supports it (in **bold**), or cut the rail.`, 1);
    }
  });
  // The same headline figure repeated as a KPI on several slides, or a year posing as a KPI. A cover
  // may preview one finding that a later slide shows; anything beyond that is padding.
  const metricSlides = new Map();
  rendered.forEach((slide, index) => {
    const values = [...metricValues(slide), ...(slide.type === "bignumber" && slide.value ? [{ value: slide.value, unit: slide.unit }] : [])];
    for (const entry of values) {
      const value = String(entry.value ?? "").trim();
      if (/^(?:19|20)\d{2}$/.test(value) && !entry.unit) {
        note(`${slideLabel(index, slide)}: KPI "${value}" is a year, not a finding. Put the year in a label and show a figure, or drop the KPI.`, 2);
        continue;
      }
      const key = `${value}${String(entry.unit || "").trim()}`.toLowerCase().replace(/\s+/g, "");
      const where = metricSlides.get(key) || [];
      if (!where.includes(index)) where.push(index);
      metricSlides.set(key, where);
    }
  });
  for (const [key, where] of metricSlides) {
    const repeats = where.filter((index) => rendered[index].type !== "cover");
    if (repeats.length < 2) continue;
    note(`KPI "${key}" is shown as a headline figure on slides ${where.map((index) => index + 1).join(", ")}. Show each figure once (a cover may preview one); give the other slides a different finding or no KPI.`, 2);
  }
  rendered.forEach((slide, index) => {
    const clipped = strings({ ...slide, notes: undefined }).find((text) => text.endsWith("…"));
    if (clipped) note(`${slideLabel(index, slide)}: normalized visible text ends in an ellipsis ("${str(clipped, 70)}"). Shorten it rather than letting the renderer cut the claim or caveat.`, 2);
  });
  // A chart needs at least two values to compare; one bar (or a bar for "roughly 2x") is a
  // number dressed up as an exhibit.
  rendered.forEach((slide, index) => {
    for (const chart of slide.type === "chart" ? slide.charts : []) {
      const values = chart.points?.length ? chart.points.filter((point) => Number.isFinite(point.value) || Number.isFinite(point.y)).length
        : Math.max(0, ...(chart.series || []).map((series) => (series.values || []).filter(Number.isFinite).length)) * Math.max(1, (chart.series || []).length);
      if (values < 2) {
        note(`${slideLabel(index, slide)}: the chart plots a single value. Show it as a bignumber (or a figure in the title) and use the chart only when there are values to compare.`, 2);
        break;
      }
    }
  });
  // Series of very different size on one axis: the small one flattens into the baseline.
  rendered.forEach((slide, index) => {
    for (const chart of slide.type === "chart" ? slide.charts : []) {
      if (!["column", "bar", "line", "area", "combo"].includes(chart.type) || !Array.isArray(chart.series) || chart.series.length < 2) continue;
      const peaks = chart.series.filter((series) => !series.axis && !(chart.type === "combo" && series.type === "line")).map((series) => Math.max(...(series.values || []).map((value) => Math.abs(Number(value) || 0)))).filter((peak) => peak > 0);
      if (peaks.length >= 2 && Math.max(...peaks) / Math.min(...peaks) >= 8) {
        note(`${slideLabel(index, slide)}: one chart puts series of very different size on one axis (largest ${Math.round(Math.max(...peaks) / Math.min(...peaks))}× the smallest), so the small one is unreadable. Split it into two charts or chart the change instead.`, 2);
        break;
      }
    }
  });
  const charted = rendered.some((slide) => slide.type === "chart" && slide.charts.length);
  if (!charted) {
    const numeric = rendered.map((slide, index) => ({ slide, index })).find(({ slide }) => {
      const rows = Array.isArray(slide?.table?.rows) ? slide.table.rows.filter(Array.isArray) : [];
      if (rows.length < 3) return false;
      const width = Math.max(...rows.map((row) => row.length));
      for (let column = 1; column < width; column += 1) {
        if (rows.filter((row) => /^[^\d]{0,3}\d[\d,.]*\s*[%×xkmb]?$/i.test(String(row[column] ?? "").trim())).length >= 3) return true;
      }
      return false;
    });
    if (numeric) note(`${slideLabel(numeric.index, numeric.slide)} holds comparable numbers but the deck has no chart. Add a chart slide (column or hbar; scatter if two metrics trade off) for the figure the deck is about, and keep the table for exact values.`, 2);
  }
  // A slide that only lists sources: citations belong in each slide's "source" field.
  slides.forEach((slide, index) => {
    const text = strings({ ...slide, source: undefined, notes: undefined, title: undefined, eyebrow: undefined });
    const links = text.filter((value) => /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|org|net|io|ai|gov|edu)\/)/i.test(value)).length;
    if (links >= 2 && links >= text.length * 0.25) note(`${slideLabel(index, slide)} spends a slide listing sources. Put each source in the "source" field of the slide that uses it, and move any caveat into a takeaway or notes; then cut this slide.`, 2);
  });

  // Figures that appear nowhere in what the writer was given.
  if (String(material || "").trim()) {
    const known = sourceFigures(material);
    const unsupported = new Set();
    slides.forEach((slide) => {
      for (const value of figures(strings(slide, [], { withNumbers: true }).join(" \n "))) if (!known.has(value)) unsupported.add(value);
    });
    if (unsupported.size >= 3) {
      note(`These figures do not appear in the material: ${[...unsupported].slice(0, 8).join(", ")}. Keep a figure only if it is computed from material figures (say how, e.g. in the subtitle or chart note); otherwise remove it.`, Math.min(4, unsupported.size - 1));
    }
  }

  // What will not fit when laid out.
  try {
    const { problems } = inspectDeck(deck);
    for (const problem of problems.slice(0, 8)) {
      const clipped = problem.warnings.filter((warning) => warning.startsWith("clipped")).map((warning) => warning.replace(/^clipped:\s*/, ""));
      const others = problem.warnings.filter((warning) => !warning.startsWith("clipped"));
      const where = `Page ${problem.page} (${problem.type}${problem.title ? `, "${str(problem.title, 50).replace(/\*\*/g, "")}"` : ""})`;
      if (clipped.length) note(`${where}: text does not fit and would be cut off: "${clipped.slice(0, 2).join('", "')}". Shorten it or move detail to the notes.`, 1);
      for (const warning of others) {
        const overlap = /(?:text|nodes) overlap/.test(warning);
        if (overlap) errors += 1;
        note(`${overlap ? "FACT / REQUIREMENT: " : ""}${where}: ${warning}. ${overlap ? "Separate these elements or change the layout before exporting." : "Use fewer rows or split the content."}`, overlap ? 5 : 1);
      }
    }
  } catch (error) {
    note(`The deck could not be laid out (${error?.message || error}). Check the JSON shape of each slide.`, 3);
  }

  return { notes, score, errors };
}

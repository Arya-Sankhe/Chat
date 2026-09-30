// Deck editor: precise edits to a generated PPTX. The deck's DeckSpec is stored with the job
// that rendered it; an edit turns the request into small path operations on that spec
// ("slides.4.title", "style.hide", "slides.6.points.2.body"), applies them exactly, and the
// worker re-renders. Everything not addressed by an operation stays byte-for-byte the same.
import { HttpError } from "../http/responses.js";
import { OPENROUTER_PRO_MODEL, OPENROUTER_TEXT_MODEL, resolveProvider } from "../providers.js";
import { streamProviderAndAccumulate } from "../saas/messages/stream.js";
import { alignDeck, emptySlides, normalizeDeck } from "../../worker/deck/spec.js";
import { FONT_CHOICES, HIDEABLE } from "../../worker/deck/style.js";
import { THEMES, THEME_NAMES } from "../../worker/deck/themes.js";
import { DECK_SCHEMA } from "./deckWriter.js";

const MAX_OPERATIONS = 80;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export const DECK_EDITOR_SYSTEM = `You edit an existing slide deck with surgical precision. The deck is JSON (schema below); a renderer redraws every slide from it with the deck's design system, so any text or style you change is laid out and fitted automatically. Output ONLY one JSON object, no fences:
{"summary": "one short sentence saying exactly what changed", "operations": [ ... ]}

# Addressing
Paths are dot-separated. Slide and list positions are 1-based and match what the user sees: "slides.1" is the cover (page 1), "slides.4.title" is the title on page 4, "slides.4.points.2.body" is the body of the 2nd point on page 4, "slides.5.chart.series.1.values.3" is the 3rd value of the first series. A chart slide has either "chart" (one chart) or "charts" (two charts: "slides.5.charts.2.type" is the second chart's type); use whichever the slide has. Deck-level fields: "title", "subtitle", "kicker", "footer" (the running label in the footer), "source" (default source line), "date", "author", "theme", "style".
The deck you receive shows "page" on each slide for reference only; never set or remove "page".

# Operations
- {"op": "set", "path": "...", "value": <any JSON>}  replace a field, or create it (and any missing parent objects)
- {"op": "remove", "path": "..."}  delete a field or one list item; a whole slide is "slides.5"
- {"op": "insert", "path": "slides.5", "value": {...}}  insert a list item at that position; later items shift down; position (length + 1) appends
- {"op": "move", "from": "slides.6", "to": "slides.3"}  reorder within one list

# Precision rules
- Change only what was asked. Every other word, number, emphasis marker and slide stays exactly as it is. Use the narrowest path ("slides.4.subtitle", not the whole slide).
- Titles are claims with **emphasis** markers; keep the markers in text you rewrite unless told otherwise.
- The user may quote text, describe a screenshot, or say "this line"/"the second card": find the field whose current text matches and edit that field. Page numbers in the request refer to "page".
- A change meant for every slide (all titles dark green, no footer anywhere, a new accent colour) goes in the deck-level "style" as one operation, not one per slide. Use "slides.N.style" only for particular pages. Text changes on several pages need one operation per page.
- Rewrites keep the original language and roughly the original length unless the user asks otherwise. Never invent numbers or facts that are not in the deck or the request.
- Deleting content: remove the field or list item. Hiding deck furniture (footer, page numbers, source line, eyebrow labels, takeaway bars, decorations): use style.hide, which keeps the text recoverable.
- Adding a slide: insert a complete slide of a fitting type using the schema, in the deck's voice.
- The cover (page 1) always stays first and is the only cover: never remove, move or insert before it; change its text with set.
- If the request cannot be done or you cannot tell which element is meant, return "operations": [] and ask a short clarifying question in "summary".

# Style (colours, fonts, visibility)
"style" at deck level applies to every slide; "slides.N.style" to page N only (it overrides the deck style).
- colors: {accent, accent2, accent3, ink, body, muted, faint, bg, surface, surfaceStrong, rule, positive, negative, warn} as "RRGGBB". These are theme tokens: accent = highlights, emphasis words, key bars; accent2 = secondary brand colour (bands, panels); ink = titles and strong text; body = paragraph text; muted = subtitles, labels, footer; bg = page background; surface = cards and panels.
- One element: title_color, subtitle_color, eyebrow_color, body_color, takeaway_color (text), takeaway_fill (panel), footer_color, background.
- chart_colors: ["RRGGBB", ...] for series and bars on every chart; "slides.N.chart.colors" for one chart.
- title_font, body_font: one of ${FONT_CHOICES.join(", ")}.
- hide: any of ${HIDEABLE.join(", ")}. At slide level, "show" re-enables something the deck style hides.
- Whole new look: set "theme" to one of ${THEME_NAMES.join(", ")}.
Only put what the user asked to change into style; never copy the current theme colours into it. When the deck already has a style.hide list or style.colors object, set the individual key ("style.colors.accent") or include the existing entries so nothing is lost. Convert colour names to hex (e.g. dark green 1B5E20, navy 0A1F44, red C62828).

# Examples
- "remove the footer" -> {"op": "set", "path": "style.hide", "value": ["footer"]}
- "no page numbers on the cover and page 2" -> set "slides.1.style.hide" ["page_number"] and "slides.2.style.hide" ["page_number"]
- "make the title on slide 3 dark blue" -> {"op": "set", "path": "slides.3.style.title_color", "value": "0A1F44"}
- "change 'Q3 revenue' to 'Q4 revenue' in the chart" -> set the chart title / category that contains it
- "the footer should say Acme Confidential" -> {"op": "set", "path": "footer", "value": "Acme Confidential"}
- "swap slides 4 and 5" -> {"op": "move", "from": "slides.5", "to": "slides.4"}

${DECK_SCHEMA}`;

function parsePath(path) {
  const parts = String(path || "").trim().replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  if (!parts.length) throw new Error("empty path");
  return parts.map((part) => {
    if (FORBIDDEN_KEYS.has(part)) throw new Error(`invalid path segment "${part}"`);
    return /^\d+$/.test(part) ? { index: Number(part) - 1 } : { key: part };
  });
}

function child(container, segment) {
  if (segment.index !== undefined) return Array.isArray(container) ? container[segment.index] : undefined;
  return container && typeof container === "object" && !Array.isArray(container) && Object.hasOwn(container, segment.key) ? container[segment.key] : undefined;
}

// Walk to the parent of the last segment, creating objects/lists on the way when asked.
function parentOf(root, parts, create) {
  let node = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const segment = parts[index];
    let next = child(node, segment);
    if (next === undefined || next === null || typeof next !== "object") {
      if (!create) throw new Error(`path not found at "${segment.key ?? segment.index + 1}"`);
      if (segment.index !== undefined) throw new Error(`list item ${segment.index + 1} does not exist`);
      next = parts[index + 1].index !== undefined ? [] : {};
      node[segment.key] = next;
    }
    node = next;
  }
  return node;
}

function checkIndex(list, index, { allowEnd = false } = {}) {
  const max = allowEnd ? list.length : list.length - 1;
  if (!Number.isInteger(index) || index < 0 || index > max) throw new Error(`position ${index + 1} is out of range (1-${max + 1})`);
}

function applyOne(deck, op) {
  const kind = String(op?.op || "").toLowerCase();
  if (kind === "move") {
    const from = parsePath(op.from);
    const to = parsePath(op.to);
    const list = parentOf(deck, from, false);
    if (!Array.isArray(list) || parentOf(deck, to, false) !== list) throw new Error("move needs two positions in the same list");
    const fromIndex = from.at(-1).index;
    const toIndex = to.at(-1).index;
    checkIndex(list, fromIndex);
    checkIndex(list, toIndex);
    const [item] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, item);
    return;
  }
  const parts = parsePath(op.path);
  if (parts[parts.length - 1].key === "page") throw new Error("page is not part of the deck");
  const last = parts[parts.length - 1];
  if (kind === "set") {
    if (!("value" in op)) throw new Error("set needs a value");
    const parent = parentOf(deck, parts, true);
    if (last.index !== undefined) {
      if (!Array.isArray(parent)) throw new Error("not a list");
      checkIndex(parent, last.index, { allowEnd: true });
      parent[last.index] = op.value;
    } else {
      parent[last.key] = op.value;
    }
    return;
  }
  if (kind === "remove") {
    const parent = parentOf(deck, parts, false);
    if (last.index !== undefined) {
      if (!Array.isArray(parent)) throw new Error("not a list");
      checkIndex(parent, last.index);
      parent.splice(last.index, 1);
    } else if (parent && typeof parent === "object" && Object.hasOwn(parent, last.key)) {
      delete parent[last.key];
    } else {
      throw new Error("nothing to remove there");
    }
    return;
  }
  if (kind === "insert") {
    if (last.index === undefined) throw new Error("insert needs a list position");
    if (!("value" in op)) throw new Error("insert needs a value");
    const parent = parentOf(deck, parts, true);
    if (!Array.isArray(parent)) throw new Error("not a list");
    checkIndex(parent, last.index, { allowEnd: true });
    parent.splice(last.index, 0, op.value);
    return;
  }
  throw new Error(`unknown op "${op?.op}"`);
}

export function isDeckOperation(op) {
  return Boolean(op && typeof op === "object" && ["set", "remove", "insert", "move"].includes(String(op.op || "").toLowerCase()));
}

// Apply operations to a copy of the deck. Returns { deck, applied, errors }.
export function applyDeckOperations(deck, operations) {
  const next = structuredClone(deck);
  const errors = [];
  let applied = 0;
  const list = Array.isArray(operations) ? operations : [];
  if (list.length > MAX_OPERATIONS) {
    errors.push(`${list.length} operations is more than the ${MAX_OPERATIONS} allowed in one edit; split the request`);
  }
  list.slice(0, MAX_OPERATIONS).forEach((op, index) => {
    try {
      applyOne(next, op);
      applied += 1;
    } catch (error) {
      errors.push(`operation ${index + 1} (${op?.op || "?"} ${op?.path || op?.from || ""}): ${error.message}`);
    }
  });
  if (!Array.isArray(next.slides) || !next.slides.length) throw new HttpError(400, "That edit would leave the deck without slides.");
  if (next.slides.length > 24) throw new HttpError(400, "Decks are limited to 24 slides.");
  return { deck: next, applied, errors };
}

// The deck as the editor sees it: aligned to pages, with page numbers for reference.
export function deckForEditor(deck) {
  return { ...deck, slides: deck.slides.map((slide, index) => ({ page: index + 1, ...slide })) };
}

function themeColorsNote(deck) {
  const normalized = normalizeDeck(deck);
  const colors = THEMES[normalized.theme]?.colors || {};
  const shown = ["accent", "accent2", "accent3", "ink", "body", "muted", "bg", "surface"].map((key) => `${key} ${colors[key]}`).join(", ");
  return `For reference only (do not copy into style), theme "${normalized.theme}" colours: ${shown}.`;
}

function parseEditorJson(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function requestOperations({ config, modelClient, signal, deck, instructions, userRequest, timeoutMs, previous = null }) {
  if (!modelClient?.streamChatCompletion) throw new HttpError(503, "Deck editing is not available right now.");
  const provider = resolveProvider("openrouter", config);
  const configured = String(config?.documents?.deckModel || "").trim();
  const models = [...new Set([configured || OPENROUTER_PRO_MODEL, OPENROUTER_TEXT_MODEL].filter(Boolean))];
  const user = [
    userRequest ? `USER REQUEST (their words):\n${String(userRequest).slice(0, 4000)}` : "",
    instructions ? `EDIT INSTRUCTIONS FROM THE ASSISTANT:\n${String(instructions).slice(0, 8000)}` : "",
    themeColorsNote(deck),
    `CURRENT DECK:\n${JSON.stringify(deckForEditor(deck))}`,
    previous ? `YOUR PREVIOUS OPERATIONS WERE REJECTED AND NOTHING WAS CHANGED:\n${JSON.stringify(previous.operations).slice(0, 6000)}\nProblems:\n- ${previous.problems.join("\n- ")}\nReturn a corrected, complete set of operations for the whole request.` : "",
    "Return the edit JSON now."
  ].filter(Boolean).join("\n\n");
  let lastError = null;
  for (const model of models) {
    // Abort events are not replayed, so a turn cancelled before this attempt must stop here.
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener?.("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("deck editor timeout")), Math.max(20_000, Number(timeoutMs || config?.documents?.deckWriterTimeoutMs || 150_000)));
    try {
      const upstream = await modelClient.streamChatCompletion({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        providerId: provider.id,
        signal: controller.signal,
        body: {
          model,
          messages: [
            { role: "system", content: DECK_EDITOR_SYSTEM },
            { role: "user", content: user }
          ],
          temperature: 0.1,
          max_tokens: 12_000,
          ...(model === OPENROUTER_PRO_MODEL ? { reasoning: { effort: "low", exclude: true } } : { reasoning: { enabled: false } })
        }
      });
      const result = await streamProviderAndAccumulate(upstream, () => {});
      const parsed = parseEditorJson(result?.content);
      if (parsed && Array.isArray(parsed.operations)) return { ...parsed, model };
      lastError = new Error(`${model} returned no operations`);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
    console.warn(`deck editor: ${lastError?.message || lastError}`);
  }
  throw new HttpError(502, "The deck editor could not prepare this edit. Try again.");
}

// Why a planned edit cannot be applied as a whole: failed operations, or slides left with
// nothing drawable (the renderer would silently drop them). Empty means it is safe.
function editProblems(result, before) {
  const problems = [...result.errors];
  for (const page of emptySlides(result.deck)) {
    problems.push(`page ${page} would be left without any content and disappear; remove that slide explicitly or keep content on it`);
  }
  // Decks always open with exactly one cover; the renderer would silently put a new one back.
  const slides = Array.isArray(result.deck?.slides) ? result.deck.slides : [];
  if (slides[0]?.type !== "cover" || slides.slice(1).some((entry) => entry?.type === "cover")) {
    problems.push("the cover must stay on page 1 and be the only cover; it cannot be removed or moved, so edit its text with set operations instead");
  }
  slides.forEach((entry, index) => {
    if (entry?.chart && Array.isArray(entry.charts) && entry.charts.length) {
      problems.push(`page ${index + 1} holds its charts in "charts"; address them as slides.${index + 1}.charts.1 and slides.${index + 1}.charts.2, not "chart"`);
    }
  });
  // Operations that land on fields the renderer never reads would report success for nothing.
  if (!problems.length && JSON.stringify(normalizeDeck(result.deck)) === JSON.stringify(normalizeDeck(before))) {
    problems.push("these operations change nothing that is drawn on the slides; check each path against the current deck");
  }
  return problems;
}

/**
 * Edit a stored DeckSpec. Explicit deck operations are applied as given; otherwise the editor
 * model plans them from the instructions. Edits are all-or-nothing: if any operation fails or
 * would empty a slide, nothing is changed (a planned edit gets one corrected attempt first).
 * Returns { deck, summary, applied, model }.
 */
export async function editDeck({ config, modelClient, signal, deck, instructions = "", operations = [], userRequest = "", timeoutMs } = {}) {
  const current = alignDeck(deck);
  const given = Array.isArray(operations) ? operations : [];
  const explicit = given.filter(isDeckOperation);
  const unsupported = given.filter((op) => !isDeckOperation(op));
  // A partly-supported explicit edit would apply only some of what was asked, so reject it whole.
  if (explicit.length && unsupported.length) {
    throw new HttpError(422, `The edit was not applied, nothing changed: ${unsupported.length} operation(s) are not deck operations (use set, remove, insert or move).`);
  }
  // Only non-deck operations (e.g. replace_text): let the editor model translate them.
  if (unsupported.length) {
    instructions = [instructions, `Carry out these requested operations: ${JSON.stringify(unsupported).slice(0, 6000)}`].filter(Boolean).join("\n\n");
  }
  const plan = (previous) => explicit.length
    ? { operations: explicit, summary: "", model: "" }
    : requestOperations({ config, modelClient, signal, deck: current, instructions, userRequest, timeoutMs, previous });
  let planned = await plan(null);
  let result = null;
  let problems = [];
  for (let attempt = 0; attempt < (explicit.length ? 1 : 2); attempt += 1) {
    if (attempt) planned = await plan({ operations: planned.operations, problems });
    if (!planned.operations.length) {
      throw new HttpError(422, String(planned.summary || "No change was identified for that request.").slice(0, 400));
    }
    result = applyDeckOperations(current, planned.operations);
    problems = editProblems(result, current);
    if (!problems.length) break;
  }
  if (problems.length) {
    throw new HttpError(422, `The edit was not applied, nothing changed: ${problems.slice(0, 3).join("; ")}`.slice(0, 600));
  }
  const edited = alignDeck(result.deck);
  if (normalizeDeck(edited).slides.length < 1) {
    throw new HttpError(422, "That edit would leave the deck empty.");
  }
  return { deck: edited, summary: String(planned.summary || "").slice(0, 400), applied: result.applied, model: planned.model };
}

// File editor: precise, format-preserving edits to a PDF or Word file the user uploaded (or any
// document Klui did not design). The worker first reads the file's structure (paragraph and
// line ids, form fields, content controls); the model turns the request into operations against
// those ids; the worker applies them in place (worker/docx_edit.py, worker/pdf_edit.py), so
// fonts, layout and everything not addressed stay exactly as they were.
import { HttpError } from "../http/responses.js";
import { OPENROUTER_PRO_MODEL, resolveProvider } from "../providers.js";
import { runEditorModel } from "./editorModel.js";
import { salvageJsonObjects } from "../study/jsonSalvage.js";
import { DOC_MODELS } from "./docWriter.js";

const DOCX_OPS = new Set(["replace_text", "set_text", "insert_after", "insert_before", "delete", "fill_blank", "check", "set_cell", "add_row", "delete_row", "fill_control"]);
const PDF_OPS = new Set(["fill_field", "replace_text", "rewrite_lines", "insert_text", "delete_text"]);

const COMMON = `You edit an existing file with surgical precision while keeping its exact formatting. You receive the file's structure as JSON and a request. Output ONLY one JSON object, no fences:
{"summary": "one short sentence saying exactly what changed", "operations": [ ... ]}
Rules:
- Change only what was asked; everything else stays byte-for-byte the same. Prefer the narrowest operation ("replace_text" on a phrase rather than rewriting a paragraph).
- "find" text must be copied exactly from the structure (same spelling, punctuation and spaces).
- Filling a form: put each value in its field or blank; keep labels as they are; use the details the user gave and never invent personal data (names, IDs, dates, signatures). Leave a field empty when the user gave no value for it, and say which fields are still empty in the summary.
- When a SELECTION is given, edit only the text inside it (the paragraphs/lines that contain it).
- Rewritten text keeps the language, tone and roughly the length unless the user asks otherwise.
- If the request cannot be done in place (for example a scanned page with no text), return "operations": [] and say why in "summary".`;

export const DOCX_EDITOR_SYSTEM = `${COMMON}

The structure lists paragraphs with ids: body paragraphs "p12", table cells "t2.r3.c1.p1" (table 2, row 3, column 1, paragraph 1; 1-based), headers "h1.p1", footers "f1.p1"; "blank": true marks a fill-in line (____), "checkbox": true a ☐ box; "controls" are Word content controls (form fields) by tag.
Operations:
- {"type": "replace_text", "find": "...", "replace": "...", "id": "p12" (optional: limit to one paragraph), "all": true|false}
- {"type": "set_text", "id": "p12", "text": "new paragraph text, **bold** and *italic* allowed"}  (keeps the paragraph's style)
- {"type": "insert_after", "id": "p12", "text": "..."} / "insert_before"; "texts": ["...", "..."] inserts several; "like": "p9" copies another paragraph's formatting (e.g. a bullet item or heading)
- {"type": "delete", "id": "p12"}
- {"type": "fill_blank", "id": "p4" or "label": "Name:", "value": "..."}  replaces the ____ after the label
- {"type": "check", "id": "p7" or "label": "I agree", "checked": true}
- {"type": "set_cell", "table": 2, "row": 3, "col": 2, "text": "..."}  (1-based; for empty form cells next to a label)
- {"type": "add_row", "table": 2, "after": 4, "cells": ["...", "..."]}  ·  {"type": "delete_row", "table": 2, "row": 5}
- {"type": "fill_control", "tag": "...", "value": "..."}`;

export const PDF_EDITOR_SYSTEM = `${COMMON}

The structure has "fields" (interactive AcroForm fields: name, type text/checkbox/choice, options, and "widgets": where each is drawn, page and x/y/w/h; a value fills every widget of its field) and "pages" of text lines with ids "p2.l14" (page 2, line 14), position (x, y from the top-left, in points), font size and bold.
Operations:
- {"type": "fill_field", "name": "exact field name", "value": "..."}  interactive form fields (checkbox: "Yes"/"Off" or an option name). Always prefer this when the PDF has fields.
- {"type": "replace_text", "find": "...", "replace": "...", "page": 2 (optional), "line": "p2.l14" (optional), "all": true|false}  same font, size and position; a line stays on its line
- {"type": "rewrite_lines", "lines": ["p2.l14", "p2.l15", "p2.l16"], "text": "new paragraph"}  rewraps a whole paragraph into the same box (use for longer rewrites)
- {"type": "insert_text", "page": 1, "anchor": "Name:", "line": "p1.l4" (the label's line), "text": "Jane Doe", "position": "right"|"below"}  writes next to a label on a flat (non-interactive) form; or {"type": "insert_text", "page": 1, "x": 120, "y": 300, "text": "...", "size": 10} at a position (points from the top-left; y is the top of the text, like the line positions). To tick a drawn checkbox, insert "✓" at the box's position, just left of its label line (x about 15 points less than the label's x, same y).
- {"type": "delete_text", "find": "...", "page": 2}
For a flat form line like "Name: ____________", replace the underscores: {"type": "replace_text", "find": "Name: ____________", "replace": "Name: Jane Doe"}.`;

function stripFences(text) {
  return String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseReply(text) {
  const raw = stripFences(text);
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        // salvage below
      }
    }
  }
  const operations = salvageJsonObjects(raw).filter((entry) => entry && typeof entry.type === "string");
  return operations.length ? { summary: "", operations } : null;
}

// Keep only operations the worker understands for this kind of file.
export function validFileOperations(kind, operations) {
  const allowed = kind === "pdf" ? PDF_OPS : DOCX_OPS;
  return (Array.isArray(operations) ? operations : [])
    .filter((op) => op && typeof op === "object" && allowed.has(String(op.type || "")))
    .slice(0, 150);
}

const squash = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
// Text reduced to letters, digits and underscores (form blanks), so spacing, punctuation, bullets
// and list numbers drawn differently by the viewer do not stop a match.
const plain = (value) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, "");
const linePage = (id) => Number(String(id).split(".")[0].slice(1)) || null;

function commonSuffix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

function commonPrefix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

function occurrences(haystack, needle) {
  const found = [];
  for (let at = haystack.indexOf(needle); at >= 0 && found.length < 500; at = haystack.indexOf(needle, at + 1)) found.push(at);
  return found;
}

// The one occurrence whose surroundings best match the text around the selection; null when two
// fit equally well (the same phrase twice with nothing to tell them apart).
function bestOccurrence(text, found, length, before, after) {
  if (found.length === 1) return found[0];
  const scored = found.map((at) => ({
    at,
    score: (before ? commonSuffix(text.slice(Math.max(0, at - before.length), at), before) : 0)
      + (after ? commonPrefix(text.slice(at + length, at + length + after.length), after) : 0)
  }));
  const top = Math.max(...scored.map((entry) => entry.score));
  const best = scored.filter((entry) => entry.score === top);
  return best.length === 1 ? best[0].at : null;
}

// A marker starts the text, follows a space, or follows the end of the item before it with no
// space at all: a PDF text layer's line break (<br>) adds none ("1. Call Alice.2. Email Bob.").
const LIST_MARKER = /(^|\s|[.!?;:,)\]"'”’])\(?(?:\d{1,3}(?:\.\d{1,3})*|[a-z]|[ivxlcdm]{1,6})[.)]\s+|(^|\s|[.!?;:,)\]"'”’])[•◦▪‣·●○■□–-]\s+/gi;

// The selection with the list numbers Word drew ("1.", "a)", "iv.") taken out. The viewer sends
// the selection with all whitespace collapsed (public/js/documentSelection.js), so a marker can sit
// anywhere; one is removed only where the words after it start a paragraph Word numbers itself
// ("list": true in the outline). Callers try the text as sent first, so a number typed into the
// text ("2. Pay within 30 days") still matches as written.
function withoutListMarkers(text, entries) {
  const starts = entries.filter((entry) => entry.list).map((entry) => plain(entry.text)).filter(Boolean);
  const value = String(text || "").replace(/\s+/g, " ");
  if (!starts.length) return value;
  return value.replace(LIST_MARKER, (marker, lead1, lead2, offset) => {
    const rest = plain(value.slice(offset + marker.length, offset + marker.length + 40));
    // Compared over at most 16 characters, or the whole item when it is shorter ("Call Alice.").
    const begins = (start) => {
      const n = Math.min(16, start.length);
      return rest.length >= n ? rest.slice(0, n) === start.slice(0, n) : rest.length >= 4 && start.startsWith(rest);
    };
    return rest && starts.some(begins) ? (lead1 ?? lead2 ?? "") : marker;
  });
}

// Where `needle` sits in the file's text: { range } or { reason }.
function placeText(text, needle, before, after) {
  const whole = occurrences(text, needle);
  if (whole.length) {
    const at = bestOccurrence(text, whole, needle.length, before, after);
    return at === null ? { reason: "ambiguous" } : { range: [at, at + needle.length] };
  }
  if (needle.length <= 48) return { reason: "not_found" };
  // The viewer drew something between the ends (a list number, a header): place the first and
  // last stretch of the selection. Every start/end pair about as long as the selection is a
  // candidate; the text around the selection decides, and a tie is refused rather than guessed.
  const head = needle.slice(0, 24);
  const tail = needle.slice(-24);
  const tails = occurrences(text, tail);
  const pairs = [];
  for (const start of occurrences(text, head)) {
    for (const at of tails) {
      const span = at + tail.length - start;
      if (at <= start || span < needle.length * 0.9 || span > needle.length * 1.5 + 200) continue;
      const score = (before ? commonSuffix(text.slice(Math.max(0, start - before.length), start), before) : 0)
        + (after ? commonPrefix(text.slice(at + tail.length, at + tail.length + after.length), after) : 0);
      pairs.push({ range: [start, at + tail.length], score });
    }
  }
  if (!pairs.length) return { reason: "not_found" };
  const top = Math.max(...pairs.map((pair) => pair.score));
  const best = pairs.filter((pair) => pair.score === top);
  return best.length > 1 ? { reason: "ambiguous" } : { range: best[0].range };
}

// Where a selection sits in the file: { ids } of every paragraph/line it covers (a selection that
// starts or ends part-way through one includes that one), or { reason } when it cannot be placed
// exactly ("not_found", or "ambiguous" when the selected text appears more than once).
export function resolveSelection(outline, selection) {
  // No selection at all is null (edit the whole file); a selection made only of symbols ("☐ ☐")
  // cannot be placed, so it is refused rather than treated as no selection.
  if (!String(selection?.text || "").trim()) return null;
  if (!plain(selection.text)) return { ids: new Set(), reason: "no_words" };
  const page = Number(selection?.page) || null;
  const entries = outline?.kind === "pdf"
    ? (outline.pages || []).filter((entry) => !page || entry.page === page).flatMap((entry) => entry.lines || [])
    : outline?.paragraphs || [];
  let text = "";
  const spans = [];
  for (const entry of entries) {
    const value = plain(entry.text);
    if (!value) continue;
    spans.push({ id: String(entry.id), start: text.length, end: text.length + value.length });
    text += value;
  }
  // The text as sent first; then without the list numbers the viewer drew.
  const sent = placeText(text, plain(selection.text), plain(selection?.before).slice(-120), plain(selection?.after).slice(0, 120));
  let placed = sent;
  if (sent.reason === "not_found") {
    const needle = plain(withoutListMarkers(selection.text, entries));
    const before = plain(withoutListMarkers(selection?.before, entries)).slice(-120);
    const after = plain(withoutListMarkers(selection?.after, entries)).slice(0, 120);
    if (needle && needle !== plain(selection.text)) placed = placeText(text, needle, before, after);
  }
  if (placed.reason) return { ids: new Set(), reason: placed.reason };
  const { range } = placed;
  const ids = new Set(spans.filter((span) => span.start < range[1] && span.end > range[0]).map((span) => span.id));
  return ids.size ? { ids } : { ids, reason: "not_found" };
}

export function selectionEntryIds(outline, selection) {
  return resolveSelection(outline, selection)?.ids || null;
}

export function selectionError(reason) {
  if (reason === "ambiguous") return new HttpError(409, "The selected text appears more than once in this file. Select a little more around it so Klui knows which one to change.");
  if (reason === "no_words") return new HttpError(409, "The selection has no words Klui can place. Select the text around it too and retry.");
  return new HttpError(409, "The selected text could not be found in this file. Select it again and retry.");
}

// A form field drawn only beside selected lines: every one of its widgets is on a selected line's
// page, level with it, and from just left of it to a little past its end (the box after a label).
// A value fills every widget of the field, so one drawn anywhere else (another page, another row)
// is outside the selection. Names prove nothing ("student.Name" and "guardian.Name" both end in
// "Name", two fields can hold "Jane"), and a field with no known or only partly known position is
// never in a selection.
function fieldInSelection(outline, name, selectedLines) {
  const matches = (outline?.fields || []).filter((entry) => entry.name === name);
  if (matches.length !== 1 || matches[0].widgets_partial) return false;
  const widgets = Array.isArray(matches[0].widgets) ? matches[0].widgets : [];
  return widgets.length > 0 && widgets.every((widget) => selectedLines.some((line) => {
    const size = Number(line.size) || 12;
    const top = Number(widget.y);
    const left = Number(widget.x);
    const values = [top, left, Number(widget.w), Number(widget.h), Number(line.x), Number(line.y), Number(line.w)];
    if (!values.every(Number.isFinite) || Number(widget.page) !== linePage(line.id)) return false;
    const level = top <= Number(line.y) + size * 1.5 && top + Number(widget.h) >= Number(line.y) - size * 0.5;
    const beside = left <= Number(line.x) + Number(line.w) + size * 4 && left + Number(widget.w) >= Number(line.x) - size * 2;
    return level && beside;
  }));
}

// Keep only operations that stay inside the selection. Operations without an id are pinned to the
// selected paragraph/line that holds their text; anything that would reach outside is dropped.
export function scopeFileOperations(kind, outline, selection, operations) {
  const resolved = resolveSelection(outline, selection);
  if (!resolved) return { operations, dropped: 0 };
  const { ids } = resolved;
  const entries = kind === "pdf"
    ? (outline.pages || []).flatMap((entry) => entry.lines || [])
    : outline?.paragraphs || [];
  const textOf = new Map(entries.map((entry) => [String(entry.id), squash(entry.text)]));
  const holder = (needle) => {
    const value = squash(needle);
    if (!value) return null;
    return [...ids].find((id) => (textOf.get(id) || "").includes(value)) || null;
  };
  const selectedLines = entries.filter((entry) => ids.has(String(entry.id)));
  const scoped = [];
  for (const op of operations) {
    const type = String(op.type);
    if (kind === "pdf") {
      if (type === "fill_field") {
        if (fieldInSelection(outline, op.name, selectedLines)) scoped.push(op);
      } else if (type === "replace_text" || type === "delete_text") {
        const line = op.line ? (ids.has(String(op.line)) ? String(op.line) : null) : holder(op.find);
        if (line) scoped.push({ ...op, line, page: linePage(line) });
      } else if (type === "rewrite_lines") {
        const lines = Array.isArray(op.lines) ? op.lines.map(String) : [];
        if (lines.length && lines.every((line) => ids.has(line))) scoped.push(op);
      } else if (type === "insert_text") {
        if (op.anchor) {
          // Pinned to the selected line that holds the label, so the worker never picks the same
          // label elsewhere on the page.
          const anchor = squash(op.anchor);
          const line = op.line
            ? (ids.has(String(op.line)) && (textOf.get(String(op.line)) || "").includes(anchor) ? String(op.line) : null)
            : holder(op.anchor);
          if (line) scoped.push({ ...op, line, page: linePage(line) });
          continue;
        }
        // A position: on a selected line's page, within a line above or below it and from just
        // left of it (a checkbox) to a little past its end (a blank after a label).
        const x = Number(op.x);
        const y = Number(op.y);
        const near = selectedLines.find((entry) => {
          const size = Number(entry.size) || 12;
          const left = Number(entry.x);
          const width = Number(entry.w);
          return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(left) && Number.isFinite(width)
            && (!op.page || Number(op.page) === linePage(entry.id))
            && y >= Number(entry.y) - size && y <= Number(entry.y) + size
            && x >= left - size * 2 && x <= left + width + size * 4;
        });
        if (near) scoped.push({ ...op, page: linePage(near.id) });
      }
      continue;
    }
    if (type === "set_cell") {
      if (ids.has(`t${op.table}.r${op.row}.c${op.col}.p1`)) scoped.push(op);
    } else if (type === "replace_text" || type === "fill_blank" || type === "check") {
      const id = op.id ? (ids.has(String(op.id)) ? String(op.id) : null) : holder(type === "replace_text" ? op.find : op.label);
      if (id) scoped.push({ ...op, id });
    } else if (["set_text", "insert_after", "insert_before", "delete"].includes(type)) {
      if (ids.has(String(op.id))) scoped.push(op);
    }
    // add_row, delete_row and fill_control reach beyond a text selection.
  }
  return { operations: scoped, dropped: operations.length - scoped.length };
}

function compactOutline(outline, selection) {
  // Pages near a selection come first, so a long document still shows what matters.
  if (outline?.kind === "pdf" && selection?.page) {
    const page = Number(selection.page);
    const pages = [...(outline.pages || [])].sort((a, b) => Math.abs(a.page - page) - Math.abs(b.page - page));
    return JSON.stringify({ ...outline, pages }).slice(0, 140_000);
  }
  return JSON.stringify(outline).slice(0, 140_000);
}

export async function editUploadedFile({ config, modelClient, websearch = null, signal, kind, outline, instructions = "", userRequest = "", selection = null }) {
  if (!outline?.has_text && !(outline?.fields || []).length && !(outline?.controls || []).length) {
    throw new HttpError(422, "This file has no editable text (it may be a scanned image). Ask Klui to recreate it as a new document instead.");
  }
  if (!modelClient?.streamChatCompletion) throw new HttpError(503, "Document editing is not configured.");
  const placed = resolveSelection(outline, selection);
  if (placed?.reason) throw selectionError(placed.reason);
  const provider = resolveProvider("openrouter", config);
  const request = [
    userRequest && userRequest !== instructions ? `USER MESSAGE (their words):\n${String(userRequest).slice(0, 4000)}` : "",
    instructions ? `EDIT REQUEST:\n${String(instructions).slice(0, 6000)}` : "",
    selection?.text ? `SELECTION${selection.page ? ` (page ${selection.page})` : ""}: the user selected this text; edit only it:\n"${String(selection.text).slice(0, 3000)}"${placed?.ids?.size ? `\nIt is in ${[...placed.ids].slice(0, 60).join(", ")}; operations must target only these.` : ""}` : "",
    `FILE STRUCTURE:\n${compactOutline(outline, selection)}`
  ].filter(Boolean).join("\n\n");
  let lastError = null;
  for (const model of DOC_MODELS) {
    try {
      const result = await runEditorModel({
        config,
        modelClient,
        provider,
        websearch,
        signal,
        body: {
          model,
          messages: [{ role: "system", content: kind === "pdf" ? PDF_EDITOR_SYSTEM : DOCX_EDITOR_SYSTEM }, { role: "user", content: request }],
          temperature: 0.1,
          max_tokens: 12_000,
          ...(model === OPENROUTER_PRO_MODEL ? { reasoning: { effort: "low", exclude: true } } : { reasoning: { enabled: false } })
        }
      });
      const parsed = parseReply(result?.content);
      if (!parsed) throw new Error("editor reply was not JSON");
      let operations = validFileOperations(kind, parsed.operations);
      if (selection?.text && operations.length) {
        const scoped = scopeFileOperations(kind, outline, selection, operations);
        if (!scoped.operations.length) {
          throw new HttpError(409, "That edit would change text outside your selection. Select the text to change, or ask without a selection.");
        }
        operations = scoped.operations;
      }
      return { operations, summary: String(parsed.summary || "").slice(0, 400), model, citations: result.citations };
    } catch (error) {
      if (signal?.aborted || error instanceof HttpError) throw error;
      lastError = error;
      console.warn(`file editor: ${model} failed: ${error?.message || error}`);
    }
  }
  throw new HttpError(502, `The edit could not be prepared: ${lastError?.message || "model error"}`);
}

// Doc editor: precise edits to a Klui document. The document's DocSpec is stored with the job
// that rendered it; an edit turns the request into small operations addressed by block id
// ("replace" a phrase in b12, "set" b7's text, insert a block after b4, change the accent colour),
// applies them exactly, and the worker re-renders. Blocks no operation touches stay identical.
// With a selection, only the selected blocks may change.
import { HttpError } from "../http/responses.js";
import { OPENROUTER_PRO_MODEL, resolveProvider } from "../providers.js";
import { streamProviderAndAccumulate } from "../saas/messages/stream.js";
import { salvageJsonObjects } from "../study/jsonSalvage.js";
import { blockText, normalizeBlock, normalizeDoc, parseDocMarkdown, plain } from "../../worker/doc/spec.js";
import { STYLE_NAMES } from "../../worker/doc/themes.js";
import { DOC_MODELS, DOC_SYNTAX } from "./docWriter.js";

const MAX_OPERATIONS = 80;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

export const DOC_EDITOR_SYSTEM = `You edit an existing document with surgical precision. The document is JSON: document fields (title, subtitle, kicker, author, date, meta, contact, style, page, header, footer, overrides) and "blocks", each with a stable "id". A renderer redraws the document from it, so any text or style you change is laid out automatically. Output ONLY one JSON object, no fences:
{"summary": "one short sentence saying exactly what changed", "operations": [ ... ]}

# Operations
- {"op": "replace", "block": "b12", "find": "exact current text", "replace": "new text"}  change a phrase inside one block (any of its text fields, table cells and list items). Best for small edits.
- {"op": "set", "block": "b12", "path": "text", "value": "..."}  replace a field of a block. Paths inside a block are dot-separated with 0-based indexes: "text", "title", "items.2", "rows.3.1" (row 4, column 2 of a table's body), "columns.0", "series.0.values.4", "categories.2", "bullets.1", "level", "variant", "chart".
- {"op": "remove", "block": "b12"}  delete a block.  {"op": "remove", "block": "b12", "path": "items.3"}  delete one list item, table row ("rows.2"), bullet or card.
- {"op": "insert_after", "block": "b12", "markdown": "DocMarkdown for one or more new blocks"}  (also "insert_before"). Use the DocMarkdown syntax below (no front matter). Use "block": "start" or "end" to insert at the document's start or end.
- {"op": "replace_block", "block": "b12", "markdown": "DocMarkdown"}  rewrite a block completely (it may become several blocks).
- {"op": "move", "block": "b12", "after": "b4"}  reorder.
- {"op": "set_doc", "path": "title", "value": "..."}  document fields: "title", "subtitle", "kicker", "author", "date", "meta" (list of {label, value}), "contact" (list), "style" (one of ${STYLE_NAMES.join(", ")}), "page.size" ("A4" | "Letter"), "page.orientation", "header.right", "footer.left" / "footer.center" / "footer.right" (text with {page}, {pages}, {title}), "numbered_headings" (true/false), "toc" (true/false).
- Look: {"op": "set_doc", "path": "overrides.colors.accent", "value": "1B5E20"} (colours: accent, ink (titles, headings), text, muted, rule, surface (box fill), tableHead, tableHeadText, stripe); "overrides.fonts.heading" / "overrides.fonts.body" (Inter, IBM Plex Sans, Source Serif 4, Lora, EB Garamond, Liberation Serif (Times), Liberation Sans (Arial), Carlito (Calibri), Caladea (Cambria), Gelasio (Georgia)); "overrides.base_size" (pt, 8-14); "overrides.line_height" (1-2.5); "overrides.heading_case" ("none" | "upper" | "smallcaps"); "overrides.title_align" ("left" | "center"); "overrides.table_style" ("dark" | "light" | "rules" | "grid" | "plain"); "overrides.callout_style" ("bar" | "box" | "plain"); "overrides.heading_rule" ("none" | "below" | "above"); "overrides.margins" ("narrow" | "normal" | "wide").

# Precision rules
- Change only what was asked. Every other word, number and block stays exactly as it is. Use the narrowest operation: "replace" for a phrase, "set" for one field, never rewrite a block to change a word.
- The user may quote text, describe what they see ("the second table", "the blue box", "the chart on page 2"): find the block whose content matches and edit it.
- When a SELECTION is given, edit only the selected blocks (and insert next to them). The request applies to the selected text; do not touch anything else.
- Rewrites keep the language, tone, formatting markers (**bold**, $math$) and roughly the length unless the user asks otherwise. Never invent facts, numbers, citations or personal details.
- A look change for the whole document ("make headings green", "use Times") is one set_doc operation on overrides or style, not one per block.
- Keep the document's format: an MLA essay stays plain prose, a CV stays ATS-safe.
- If the request is unclear or impossible, return "operations": [] and ask one short question in "summary".

${DOC_SYNTAX.replace(/^# DocMarkdown[\s\S]*?\nBody syntax\n/, "# DocMarkdown (for inserted blocks)\n")}`;

function stripFences(text) {
  return String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseEditorJson(text) {
  const raw = stripFences(text);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // salvage below
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  const operations = salvageJsonObjects(raw).filter((entry) => entry && typeof entry.op === "string");
  const summary = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return operations.length || summary ? { summary: summary ? JSON.parse(`"${summary[1]}"`) : "", operations } : null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function pathParts(path) {
  return String(path || "").split(".").filter((part) => part !== "").map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function setPath(target, parts, value) {
  let node = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (FORBIDDEN.has(key)) throw new Error("forbidden path");
    if (node[key] === undefined || node[key] === null || typeof node[key] !== "object") node[key] = typeof parts[i + 1] === "number" ? [] : {};
    node = node[key];
  }
  const last = parts[parts.length - 1];
  if (FORBIDDEN.has(last)) throw new Error("forbidden path");
  node[last] = value;
}

function removePath(target, parts) {
  if (parts.some((part) => FORBIDDEN.has(part))) throw new Error("forbidden path");
  let node = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    // Own properties only: never walk into a prototype.
    if (!node || typeof node !== "object" || !Object.hasOwn(node, parts[i])) return false;
    node = node[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(node) && typeof last === "number") {
    if (last < 0 || last >= node.length) return false;
    node.splice(last, 1);
    return true;
  }
  if (node && typeof node === "object" && Object.hasOwn(node, last)) {
    delete node[last];
    return true;
  }
  return false;
}

// Replace a phrase in every string of a block (table cells, list items, bullets, card text).
function replaceInBlock(block, find, replace) {
  let count = 0;
  const needle = String(find);
  const loose = new RegExp(needle.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  const walk = (value) => {
    if (typeof value === "string") {
      if (value.includes(needle)) {
        count += 1;
        return value.split(needle).join(replace);
      }
      if (loose.test(value)) {
        count += 1;
        return value.replace(loose, replace);
      }
      // A phrase that spans markup ("**ten** percent") is found in the plain text.
      if (needle.length > 3 && plain(value).includes(plain(needle))) {
        count += 1;
        return plain(value).split(plain(needle)).join(replace);
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      for (const key of Object.keys(value)) {
        if (key === "id" || key === "type") continue;
        value[key] = walk(value[key]);
      }
      return value;
    }
    return value;
  };
  walk(block);
  return count;
}

function blocksFromMarkdown(markdown) {
  if (markdown && typeof markdown === "object") {
    const block = normalizeBlock(markdown);
    return block ? [block] : [];
  }
  return parseDocMarkdown(`---\ntitle: "-"\n---\n${String(markdown || "")}`, { title: "-" }).blocks.map(({ id, ...block }) => block);
}

/**
 * Apply operations to a DocSpec. scope: a Set of block ids the edit may touch (selection), or
 * null for the whole document. Returns { doc, applied, skipped }.
 */
export function applyDocOperations(doc, operations, { scope = null, docFields = null } = {}) {
  let next = clone(doc);
  const applied = [];
  const skipped = [];
  const find = (id) => next.blocks.findIndex((block) => block.id === id);
  const inScope = (id) => !scope || scope.has(id);
  for (const op of (Array.isArray(operations) ? operations : []).slice(0, MAX_OPERATIONS)) {
    const kind = String(op?.op || op?.type || "");
    const id = String(op?.block || op?.id || "");
    // Each operation works on a copy that is committed only when it succeeds, so a rejected
    // operation never leaves half an edit behind.
    const committed = next;
    next = clone(committed);
    try {
      if (kind === "set_doc") {
        const parts = pathParts(op.path);
        if (!parts.length || parts[0] === "blocks") throw new Error("bad path");
        if (scope && !(docFields && docFields.has(parts[0]))) throw new Error("document-wide change outside the selection");
        setPath(next, parts, op.value);
        applied.push(op);
        continue;
      }
      if (kind === "insert_after" || kind === "insert_before") {
        const blocks = blocksFromMarkdown(op.markdown ?? op.value);
        if (!blocks.length) throw new Error("nothing to insert");
        let index;
        if (id === "start") index = 0;
        else if (id === "end") index = next.blocks.length;
        else {
          const at = find(id);
          if (at < 0) throw new Error(`block ${id} not found`);
          if (!inScope(id)) throw new Error(`block ${id} is outside the selection`);
          index = kind === "insert_after" ? at + 1 : at;
        }
        if (scope && (id === "start" || id === "end")) throw new Error("insert outside the selection");
        next.blocks.splice(index, 0, ...blocks);
        applied.push(op);
        continue;
      }
      const at = find(id);
      if (at < 0) throw new Error(`block ${id} not found`);
      if (!inScope(id)) throw new Error(`block ${id} is outside the selection`);
      const block = next.blocks[at];
      if (kind === "replace") {
        if (!op.find) throw new Error("replace needs find");
        const count = replaceInBlock(block, op.find, String(op.replace ?? ""));
        if (!count) throw new Error(`"${String(op.find).slice(0, 60)}" not found in ${id}`);
      } else if (kind === "set") {
        const parts = pathParts(op.path || "text");
        if (parts[0] === "id") throw new Error("ids are fixed");
        setPath(block, parts, op.value);
        const normalized = normalizeBlock(block);
        if (!normalized) throw new Error(`the edit left ${id} empty`);
        // A field the renderer drops (an emptied paragraph) would vanish on save: reject it.
        if (!plain(blockText(normalized)).trim() && plain(blockText(committed.blocks[at])).trim()) throw new Error(`the edit left ${id} empty; use remove to delete it`);
        next.blocks[at] = { ...normalized, id };
      } else if (kind === "remove") {
        if (op.path) {
          if (!removePath(block, pathParts(op.path))) throw new Error(`nothing at ${id}.${op.path}`);
          const normalized = normalizeBlock(block);
          if (normalized) next.blocks[at] = { ...normalized, id };
          else next.blocks.splice(at, 1);
        } else {
          next.blocks.splice(at, 1);
        }
      } else if (kind === "replace_block") {
        const blocks = blocksFromMarkdown(op.markdown ?? op.value);
        if (!blocks.length) throw new Error("replacement is empty");
        // The first new block keeps the id, so a follow-up edit can still address it.
        blocks[0].id = id;
        next.blocks.splice(at, 1, ...blocks);
      } else if (kind === "move") {
        const target = String(op.after || "");
        const [moved] = next.blocks.splice(at, 1);
        const to = target === "start" ? 0 : find(target) + 1;
        if (to <= 0 && target !== "start") {
          next.blocks.splice(at, 0, moved);
          throw new Error(`block ${target} not found`);
        }
        next.blocks.splice(to, 0, moved);
      } else {
        throw new Error(`unknown operation ${kind}`);
      }
      applied.push(op);
    } catch (error) {
      next = committed;
      skipped.push({ op, reason: String(error?.message || error).slice(0, 200) });
    }
  }
  return { doc: normalizeDoc(next, { style: doc.style }), applied, skipped };
}

// The blocks a selection in the viewer covers: matched on the selected text, with the text
// around it to tell repeated phrases apart.
export function selectionBlocks(doc, selection = {}) {
  const ids = Array.isArray(selection.blocks) ? selection.blocks.filter((id) => doc.blocks.some((block) => block.id === id)) : [];
  if (ids.length) return ids;
  const squash = (value) => plain(value).replace(/\s+/g, " ").trim().toLowerCase();
  const text = squash(selection.text || "");
  if (!text) return [];
  const texts = doc.blocks.map((block) => squash(blockText(block)));
  const exact = texts.map((value, index) => (value.includes(text) ? index : -1)).filter((index) => index >= 0);
  if (exact.length === 1) return [doc.blocks[exact[0]].id];
  if (exact.length > 1) {
    const context = squash(`${selection.before || ""} ${selection.text} ${selection.after || ""}`);
    const scored = exact.map((index) => ({ index, score: context.split(" ").filter((word) => word.length > 3 && texts[index].includes(word)).length }));
    scored.sort((a, b) => b.score - a.score);
    return [doc.blocks[scored[0].index].id];
  }
  // A selection across blocks: the blocks holding its first and last words, and everything between.
  const wordsList = text.split(" ");
  const head = wordsList.slice(0, Math.min(6, wordsList.length)).join(" ");
  const tail = wordsList.slice(-Math.min(6, wordsList.length)).join(" ");
  const first = texts.findIndex((value) => value.includes(head));
  const last = texts.findIndex((value, index) => index >= Math.max(0, first) && value.includes(tail));
  if (first >= 0 && last >= first) return doc.blocks.slice(first, last + 1).map((block) => block.id);
  if (first >= 0) return [doc.blocks[first].id];
  // Title-block text.
  return [];
}

function docForModel(doc) {
  return JSON.stringify(doc);
}

const DOC_TEXT_FIELDS = ["title", "subtitle", "kicker", "author", "date", "meta", "contact", "header", "footer"];

// Document fields (title block, header, footer) whose text holds the selection.
export function selectionDocFields(doc, selection = {}) {
  const squash = (value) => plain(typeof value === "string" ? value : JSON.stringify(value ?? "")).replace(/\s+/g, " ").trim().toLowerCase();
  const text = squash(selection.text || "");
  if (!text) return [];
  return DOC_TEXT_FIELDS.filter((field) => doc[field] !== undefined && doc[field] !== null && squash(doc[field]).includes(text));
}

// What a selection lets the edit touch. A selection that matches nothing must not turn into a
// whole-document edit: it fails instead.
export function selectionScope(doc, selection) {
  if (!selection) return { scope: null, docFields: null };
  const ids = selectionBlocks(doc, selection);
  const fields = selectionDocFields(doc, selection);
  if (!ids.length && !fields.length) {
    throw new HttpError(409, "The selected text could not be found in this document. Select it again and retry.");
  }
  return { scope: new Set(ids), docFields: new Set(fields) };
}

export async function editDoc({ config, modelClient, signal, doc, instructions = "", operations = null, userRequest = "", selection = null }) {
  const { scope, docFields } = selectionScope(doc, selection);
  if (Array.isArray(operations) && operations.length && operations.every((op) => op && typeof op.op === "string")) {
    const result = applyDocOperations(doc, operations, { scope, docFields });
    if (!result.applied.length) throw new HttpError(400, `No edit could be applied: ${result.skipped.map((entry) => entry.reason).join("; ").slice(0, 300)}`);
    return { ...result, summary: "" };
  }
  if (!modelClient?.streamChatCompletion) throw new HttpError(503, "Document editing is not configured.");
  const provider = resolveProvider("openrouter", config);
  const request = [
    userRequest && userRequest !== instructions ? `USER MESSAGE (their words):\n${userRequest.slice(0, 4000)}` : "",
    instructions ? `EDIT REQUEST:\n${String(instructions).slice(0, 6000)}` : "",
    selection ? `SELECTION: the user selected this text:\n"${String(selection.text || "").slice(0, 3000)}"\nIt is in ${[
      scope.size ? `blocks ${[...scope].join(", ")}` : "",
      docFields.size ? `the document field${docFields.size > 1 ? "s" : ""} ${[...docFields].join(", ")} (change with set_doc)` : ""
    ].filter(Boolean).join(" and ")}. Edit only these.` : "",
    `DOCUMENT:\n${docForModel(doc)}`
  ].filter(Boolean).join("\n\n");
  let lastError = null;
  for (const model of DOC_MODELS) {
    try {
      const upstream = await modelClient.streamChatCompletion({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        providerId: provider.id,
        signal,
        body: {
          model,
          messages: [{ role: "system", content: DOC_EDITOR_SYSTEM }, { role: "user", content: request }],
          temperature: 0.2,
          max_tokens: 16_000,
          ...(model === OPENROUTER_PRO_MODEL ? { reasoning: { effort: "low", exclude: true } } : { reasoning: { enabled: false } })
        }
      });
      const result = await streamProviderAndAccumulate(upstream, () => {});
      const parsed = parseEditorJson(result?.content);
      if (!parsed) throw new Error("editor reply was not JSON");
      const ops = Array.isArray(parsed.operations) ? parsed.operations : [];
      if (!ops.length) {
        return { doc, applied: [], skipped: [], summary: String(parsed.summary || "Nothing was changed.").slice(0, 400), question: true };
      }
      const applied = applyDocOperations(doc, ops, { scope, docFields });
      if (!applied.applied.length) throw new Error(`no operation applied: ${applied.skipped.map((entry) => entry.reason).join("; ").slice(0, 300)}`);
      return { ...applied, summary: String(parsed.summary || "").slice(0, 400), model };
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      console.warn(`doc editor: ${model} failed: ${error?.message || error}`);
    }
  }
  throw new HttpError(502, `The edit could not be applied: ${lastError?.message || "model error"}`);
}

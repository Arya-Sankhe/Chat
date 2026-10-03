import assert from "node:assert/strict";
import test from "node:test";

import { DocumentService } from "../server/documents/index.js";
import { executeDocumentToolCall } from "../server/documents/tool.js";
import { clearDocumentTextCache, loadDocumentUnits } from "../server/documents/library.js";
import { cellNumber, parseCellRange, querySheet } from "../server/documents/sheets.js";
import { buildDocumentContext, withDocumentContext } from "../server/chat/pipeline.js";

const userId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";

function uuid(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function pagedDoc(n, { name = `Doc${n}.pdf`, kind = "pdf", pages = 3, metadata = {}, created = `2026-10-0${n}T00:00:00Z` } = {}) {
  return {
    id: uuid(100 + n),
    attachment_id: uuid(200 + n),
    conversation_id: conversationId,
    kind,
    page_count: pages,
    created_at: created,
    updated_at: created,
    text_ready_at: created,
    visual_ready_at: created,
    attachments: { file_name: name },
    metadata: { pipeline: "pages-v1", ...metadata }
  };
}

function pageChunks(doc, texts, visual = []) {
  return texts.map((text, index) => ({
    document_file_id: doc.id,
    chunk_index: index,
    source_type: "page",
    source_label: `Page ${index + 1}`,
    text,
    metadata: { page: index + 1, visual: visual.includes(index + 1), extractor: "pages-v1" }
  }));
}

function serviceWith({ docs, chunks = [], pages = [], hits = [], config = {}, ...options }) {
  const calls = { chunkLoads: [], searches: [], pageLookups: [] };
  const db = {
    async listUsableDocumentFiles() { return docs.filter((doc) => doc.conversation_id === conversationId); },
    async listUsableProjectDocumentFiles() { return docs.filter((doc) => doc.project_id); },
    async getDocumentFileByAttachment(_user, attachmentId) { return docs.find((doc) => doc.attachment_id === attachmentId) || null; },
    async listDocumentFilesByAttachments(_user, ids) { return docs.filter((doc) => ids.includes(doc.attachment_id)); },
    async listDocumentChunksForFiles(_user, ids, { limit, offset = 0 }) {
      calls.chunkLoads.push({ ids, offset });
      return chunks
        .filter((chunk) => ids.includes(chunk.document_file_id))
        .sort((a, b) => a.document_file_id.localeCompare(b.document_file_id) || a.chunk_index - b.chunk_index)
        .slice(offset, offset + limit);
    },
    async listDocumentPagesByNumbers(_user, docId, numbers) {
      calls.pageLookups.push({ docId, numbers });
      return pages.filter((page) => page.document_file_id === docId && numbers.includes(page.page_number));
    },
    async searchDocumentChunks(payload) {
      calls.searches.push(payload);
      return hits.filter((hit) => payload.documentFileIds.includes(hit.document_file_id));
    }
  };
  const service = new DocumentService({
    config: { documents: { enabled: true, maxToolResultChars: 80_000, ...config } },
    db,
    r2: { readUrl: (key) => `https://r2.example/${key}` },
    userId,
    conversationId,
    plan: { id: "pro" },
    signal: new AbortController().signal,
    ...options
  });
  return { service, calls };
}

function textOf(message) {
  if (!message) return "";
  return typeof message.content === "string"
    ? message.content
    : message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function imagesOf(message) {
  return Array.isArray(message?.content) ? message.content.filter((part) => part.type === "image_url") : [];
}

test("a document that fits goes in whole: every page's text, and images only for visual pages", async () => {
  clearDocumentTextCache();
  const doc = pagedDoc(1, { name: "Lab.pdf" });
  const chunks = pageChunks(doc, ["Intro to the lab.", "Figure 2 shows the setup.", "Conclusion."], [2]);
  const pages = [1, 2, 3].map((number) => ({ id: `p${number}`, document_file_id: doc.id, page_number: number, image_key: `k/${number}.jpg` }));
  const { service, calls } = serviceWith({ docs: [doc], chunks, pages });

  const plan = await service.planContext({ docs: [doc], tokenBudget: 100_000 });
  assert.equal(plan.entries[0].status, "full");
  assert.deepEqual(plan.entries[0].imagePages, [2]);
  assert.equal(plan.images, 1);

  const vision = await service.renderContext(plan, { vision: true, toolsAvailable: true });
  const text = textOf(vision.library);
  assert.match(text, /Lab\.pdf \(pdf, 3 pages, attachment_id [0-9a-f-]+\): included in full below; page 2 also comes as page images/);
  assert.match(text, /--- Page 1 ---\nIntro to the lab\./);
  assert.match(text, /--- Page 2 --- \(page image follows\)\nFigure 2 shows the setup\./);
  assert.match(text, /--- Page 3 ---\nConclusion\./);
  assert.deepEqual(imagesOf(vision.library).map((part) => part.image_url.url), ["https://r2.example/k/2.jpg"]);
  assert.deepEqual(calls.pageLookups, [{ docId: doc.id, numbers: [2] }]);
  assert.equal(vision.citations[0].title, "Lab.pdf");

  const plain = await service.renderContext(plan, { vision: false });
  assert.equal(typeof plain.library.content, "string");
  assert.match(plain.library.content, /page 2 has figures or layout that this model cannot see as images/);
});

test("a document too long to include is described, never silently dropped, and its matching pages are evidence", async () => {
  clearDocumentTextCache();
  const small = pagedDoc(1, { name: "Notes.pdf", pages: 1, metadata: { text_tokens: 20 } });
  const big = pagedDoc(2, {
    name: "Textbook.pdf",
    pages: 140,
    metadata: {
      text_tokens: 900_000,
      visual_pages: [12],
      page_index: [
        { page: 1, label: "Page 1", start: "Contents", visual: false },
        { page: 12, label: "Page 12", start: "Photosynthesis diagram", visual: true }
      ]
    }
  });
  const hits = [{
    document_file_id: big.id,
    chunk_index: 11,
    source_type: "page",
    source_label: "Page 12",
    text: "Photosynthesis turns light into chemical energy.",
    metadata: { page: 12, visual: true, extractor: "pages-v1" }
  }];
  const pages = [{ id: "p12", document_file_id: big.id, page_number: 12, image_key: "k/12.jpg" }];
  const { service, calls } = serviceWith({
    docs: [small, big],
    chunks: pageChunks(small, ["Short notes."]),
    pages,
    hits
  });

  const plan = await service.planContext({ docs: [small, big], tokenBudget: 50_000, query: "explain photosynthesis" });
  // The textbook's recorded size rules it out, so its pages are never loaded.
  assert.deepEqual(calls.chunkLoads.map((call) => call.ids), [[small.id]]);
  assert.deepEqual(new Map(plan.entries.map((entry) => [entry.doc.id, entry.status])), new Map([[small.id, "full"], [big.id, "partial"]]));
  assert.deepEqual(calls.searches[0].documentFileIds, [big.id]);

  const rendered = await service.renderContext(plan, { vision: true, toolsAvailable: true });
  const library = textOf(rendered.library);
  assert.match(library, /Textbook\.pdf \(pdf, 140 pages, attachment_id [0-9a-f-]+\): too long to include in full this turn; its page index is below; the 1 page that best match the question follow the conversation\. Read any page with read_document/);
  assert.match(library, /Page 12 \[figures\]: Photosynthesis diagram/);
  const evidence = textOf(rendered.evidence);
  assert.match(evidence, /\[Textbook\.pdf\] --- Page 12 --- \(page image follows\)\nPhotosynthesis turns light/);
  assert.equal(imagesOf(rendered.evidence).length, 1);
  assert.equal(rendered.mode, "mixed");
  assert.deepEqual(rendered.citations.map((citation) => citation.title), ["Notes.pdf", "Textbook.pdf - Page 12"]);
});

test("the manifest still names a long document when nothing in it matches", async () => {
  clearDocumentTextCache();
  const big = pagedDoc(3, { name: "Archive.pdf", pages: 150, metadata: { text_tokens: 2_000_000 } });
  const { service } = serviceWith({ docs: [big] });
  const plan = await service.planContext({ docs: [big], tokenBudget: 10_000, query: "zebra" });
  const rendered = await service.renderContext(plan, { vision: true, toolsAvailable: false });
  assert.match(textOf(rendered.library), /Archive\.pdf \(pdf, 150 pages, attachment_id [0-9a-f-]+\): too long to include in full this turn\./);
  assert.equal(rendered.evidence, null);
  assert.equal(rendered.mode, "partial");
});

test("a chat limited to some pages includes only those pages, and tools cannot read past them", async () => {
  clearDocumentTextCache();
  const doc = { ...pagedDoc(4, { name: "Course.pdf", pages: 3 }), conversation_id: null, project_id: uuid(900) };
  const chunks = pageChunks(doc, ["Page one secret.", "Page two topic.", "Page three."]);
  const hits = chunks.map((chunk) => ({ ...chunk }));
  const { service } = serviceWith({
    docs: [doc],
    chunks,
    hits,
    projectId: uuid(900),
    projectDocumentIds: [doc.id],
    projectDocumentPages: { [doc.id]: [2] }
  });

  const plan = await service.planContext({ docs: [doc], tokenBudget: 100_000 });
  const rendered = await service.renderContext(plan, { vision: false });
  assert.match(rendered.library.content, /Page two topic/);
  assert.doesNotMatch(rendered.library.content, /Page one secret/);
  assert.match(rendered.library.content, /within Course\.pdf to page 2/);

  await assert.rejects(
    service.read({ attachmentId: doc.attachment_id, pageStart: 1, pageEnd: 1 }),
    /limited to page 2 of Course\.pdf/
  );
  const read = await service.read({ attachmentId: doc.attachment_id });
  assert.deepEqual(read.results.map((result) => result.page_number), [2]);
  const search = await service.search({ query: "page" });
  assert.deepEqual(search.results.map((result) => result.page_number), [2]);
});

test("read_document returns pages in order, continues past what fits, and shows images for visual pages", async () => {
  clearDocumentTextCache();
  const doc = pagedDoc(5, { name: "Report.pdf", pages: 4 });
  const chunks = pageChunks(doc, ["a".repeat(3000), "b".repeat(3000), "c".repeat(3000), "d".repeat(10)], [2]);
  const pages = [1, 2, 3, 4].map((number) => ({ id: `p${number}`, document_file_id: doc.id, page_number: number, image_key: `k/${number}.jpg` }));
  const { service } = serviceWith({ docs: [doc], chunks, pages });

  const first = await service.read({ attachmentId: doc.attachment_id, maxChars: 6500 });
  assert.deepEqual(first.results.map((result) => result.page_number), [1, 2]);
  assert.equal(first.next_page_start, 3);
  assert.deepEqual(first.visualPages.map((page) => page.page_number), [2]);

  const rest = await service.read({ attachmentId: doc.attachment_id, pageStart: first.next_page_start, includeImages: true });
  assert.deepEqual(rest.results.map((result) => result.page_number), [3, 4]);
  assert.equal(rest.next_page_start, undefined);
  assert.deepEqual(rest.visualPages.map((page) => page.page_number), [3, 4]);

  await assert.rejects(service.read({ attachmentId: doc.attachment_id, pageStart: 9 }), /outside this document/);
});

function sheetDoc(n, sheets) {
  return {
    ...pagedDoc(n, { name: `Data${n}.xlsx`, kind: "xlsx" }),
    page_count: null,
    visual_ready_at: null,
    sheet_count: sheets.length,
    metadata: { pipeline: "sheets-v1", sheets }
  };
}

function sheetChunks(doc, sheet, rows, perBlock = 100) {
  const chunks = [];
  for (let start = 0; start < rows.length; start += perBlock) {
    const block = rows.slice(start, start + perBlock);
    chunks.push({
      document_file_id: doc.id,
      chunk_index: chunks.length,
      source_type: "sheet_range",
      source_label: `${sheet} — rows ${block[0][0]}-${block.at(-1)[0]}`,
      text: block.map(([, cells]) => cells.join("\t")).join("\n"),
      metadata: {
        sheet,
        row_start: block[0][0],
        row_end: block.at(-1)[0],
        row_numbers: block.map(([row]) => row),
        extractor: "sheets-v1"
      }
    });
  }
  return chunks;
}

test("spreadsheet ranges are exact anywhere in the sheet and continue instead of stopping at a cap", async () => {
  clearDocumentTextCache();
  const rows = [[1, ["region", "amount"]]];
  for (let row = 2; row <= 120_001; row += 1) rows.push([row, [`r${row % 7}`, String(row)]]);
  const doc = sheetDoc(6, [{ name: "Sales", rows: rows.length, columns: 2, header_row: 1 }]);
  const chunks = sheetChunks(doc, "Sales", rows);
  assert.ok(chunks.length > 1000);
  const { service, calls } = serviceWith({ docs: [doc], chunks });

  const far = await service.read({ attachmentId: doc.attachment_id, cellRange: "A110000:B110002" });
  assert.match(far.results[0].content, /110000 \| r\d\t110000\n110001 \| r\d\t110001\n110002 \| r\d\t110002$/);
  assert.ok(calls.chunkLoads.length > 1, "units are read past the 1,000-row page");

  const wide = await service.read({ attachmentId: doc.attachment_id, cellRange: "A1:B5000", maxChars: 2000 });
  assert.ok(wide.next_cell_range, "a long range says where to continue");
  assert.match(wide.next_cell_range, /^A\d+:B5000$/);
  const stoppedAt = Number(wide.next_cell_range.match(/^A(\d+)/)[1]);
  const lastShown = Number(wide.results[0].content.trim().split("\n").at(-1).split(" | ")[0]);
  assert.equal(stoppedAt, lastShown + 1);

  const totals = await service.querySpreadsheet({
    attachmentId: doc.attachment_id,
    groupBy: ["region"],
    aggregates: [{ fn: "count_rows" }, { fn: "sum", column: "amount" }],
    orderBy: { column: "region" }
  });
  assert.equal(totals.output.matched_rows, 120_000);
  const r0 = totals.output.results.find((group) => group.region === "r0");
  const expected = rows.slice(1).filter(([row]) => row % 7 === 0).reduce((sum, [row]) => sum + row, 0);
  assert.equal(r0["sum(amount)"], expected);
});

test("whole spreadsheets that fit go in with row numbers; a sheet too big is summarised from its stored preview", async () => {
  clearDocumentTextCache();
  const small = sheetDoc(7, [{ name: "Budget", rows: 3, columns: 2, header_row: 1 }]);
  small.metadata.text_tokens = 20;
  const big = sheetDoc(8, [{ name: "Log", rows: 90_000, columns: 4, header_row: 1, preview: [{ row: 1, cells: "date\tuser\taction\tms" }] }]);
  big.metadata.text_tokens = 4_000_000;
  const { service } = serviceWith({
    docs: [small, big],
    chunks: sheetChunks(small, "Budget", [[1, ["item", "cost"]], [2, ["rent", "1200"]], [3, ["food", "300"]]])
  });
  const plan = await service.planContext({ docs: [small, big], tokenBudget: 20_000 });
  const rendered = await service.renderContext(plan, { vision: false, toolsAvailable: true });
  assert.match(rendered.library.content, /Sheet "Budget" \(3 filled rows, columns A-B, header in row 1\)/);
  assert.match(rendered.library.content, /2 \| rent\t1200\n3 \| food\t300/);
  assert.match(rendered.library.content, /Data8\.xlsx \(xlsx, 1 sheet, attachment_id [0-9a-f-]+\): too long to include in full/);
  assert.match(rendered.library.content, /Sheet "Log": 90000 filled rows, 4 columns, header in row 1\.\n1 \| date\tuser\taction\tms/);
});

test("document units load past PostgREST's row cap", async () => {
  clearDocumentTextCache();
  const doc = pagedDoc(9, { pages: 1500 });
  const chunks = pageChunks(doc, Array.from({ length: 1500 }, (_, index) => `page ${index + 1}`));
  const { service, calls } = serviceWith({ docs: [doc], chunks });
  const units = (await loadDocumentUnits({ db: service.db, userId, docs: [doc] })).get(doc.id).units;
  assert.equal(units.length, 1500);
  assert.equal(units.at(-1).text, "page 1500");
  assert.deepEqual(calls.chunkLoads.map((call) => call.offset), [0, 1000]);
});

test("the library sits right after the system prompt and the evidence right before the user's message", async () => {
  clearDocumentTextCache();
  const small = pagedDoc(1, { name: "Notes.pdf", pages: 1, metadata: { text_tokens: 20 } });
  const big = pagedDoc(2, { name: "Big.pdf", pages: 140, metadata: { text_tokens: 900_000 } });
  const hits = [{ document_file_id: big.id, chunk_index: 4, source_type: "page", source_label: "Page 5", text: "Match.", metadata: { page: 5 } }];
  const { service } = serviceWith({ docs: [small, big], chunks: pageChunks(small, ["Short notes."]), hits });
  const context = await buildDocumentContext({
    documents: service,
    readyDocuments: [small, big],
    tokenBudget: 50_000,
    query: "match"
  });
  const messages = await withDocumentContext([
    { role: "system", content: "rules" },
    { role: "user", content: "earlier" },
    { role: "assistant", content: "reply" },
    { role: "user", content: "match please" }
  ], context, { vision: false });
  assert.equal(messages[0].role, "system");
  assert.match(textOf(messages[1]), /^The user's documents for this chat:/);
  assert.equal(messages[2].content, "earlier");
  assert.match(textOf(messages[4]), /best match their next message/);
  assert.equal(messages[5].content, "match please");
  assert.equal(context.mode, "mixed");
});

test("cell ranges, numbers and sheet queries are parsed exactly", () => {
  assert.deepEqual(parseCellRange("B2:D20"), { startColumn: 2, endColumn: 4, startRow: 2, endRow: 20 });
  assert.deepEqual(parseCellRange("5:120"), { startColumn: 1, endColumn: Number.POSITIVE_INFINITY, startRow: 5, endRow: 120 });
  assert.deepEqual(parseCellRange("C7"), { startColumn: 3, endColumn: 3, startRow: 7, endRow: 7 });
  assert.equal(parseCellRange(""), null);
  assert.throws(() => parseCellRange("D20:B2"), /top-left/);
  assert.equal(cellNumber("$1,234.50"), 1234.5);
  assert.equal(cellNumber("(300)"), -300);
  assert.equal(cellNumber("12%"), 0.12);
  assert.equal(cellNumber("=SUM(B2:B4) => 42"), 42);
  assert.equal(cellNumber("n/a"), null);

  const rows = [
    { row: 1, cells: ["name", "team", "score"] },
    { row: 2, cells: ["Ana", "red", "10"] },
    { row: 3, cells: ["Bo", "blue", "7"] },
    { row: 4, cells: ["Cy", "red", "=B2*2 => 5"] }
  ];
  const red = querySheet(rows, { filters: [{ column: "team", op: "=", value: "RED" }] });
  assert.deepEqual(red.rows.map((row) => row.row), [2, 4]);
  const grouped = querySheet(rows, { groupBy: ["team"], aggregates: [{ fn: "sum", column: "C" }, { fn: "avg", column: "score" }], orderBy: { column: "sum(score)", desc: true } });
  assert.deepEqual(grouped.results, [
    { team: "red", "sum(score)": 15, "avg(score)": 7.5 },
    { team: "blue", "sum(score)": 7, "avg(score)": 7 }
  ]);
  assert.throws(() => querySheet(rows, { filters: [{ column: "missing", op: "=" }] }), /Column "missing" was not found/);
});

test("documents still processing or failed are named instead of disappearing", async () => {
  const pending = { id: uuid(301), attachment_id: uuid(401), conversation_id: conversationId, kind: "pdf", processing_status: "processing", attachments: { file_name: "Lecture.pdf" }, metadata: {} };
  const failed = { id: uuid(302), attachment_id: uuid(402), conversation_id: conversationId, kind: "docx", processing_status: "failed", error: { message: "too_many_pages" }, attachments: { file_name: "Huge.docx" }, metadata: {} };
  const { service } = serviceWith({ docs: [] });
  service.db.listUnreadyDocumentFiles = async () => [pending, failed];
  const unready = await service.unreadyDocuments();
  const context = await buildDocumentContext({ documents: service, readyDocuments: [], unreadyDocuments: unready, tokenBudget: 10_000 });
  const rendered = await withDocumentContext([{ role: "system", content: "s" }, { role: "user", content: "what is on page 70?" }], context, { vision: true });
  const library = textOf(rendered[1]);
  assert.match(library, /Lecture\.pdf \(pdf\): still processing/);
  assert.match(library, /Huge\.docx \(docx\): could not be processed \(too_many_pages\)/);
});

test("hidden slides are labelled as included, or named as missing for decks stored before they were kept", async () => {
  clearDocumentTextCache();
  const deck = pagedDoc(1, { name: "Briefing.pptx", kind: "pptx", pages: 4, metadata: { hidden_slides: [3] } });
  const chunks = ["Intro", "Plan", "Reserve 73, code HIDDEN-94Z", "Close"].map((text, index) => ({
    document_file_id: deck.id,
    chunk_index: index,
    source_type: "slide",
    source_label: index === 2 ? "Slide 3 (hidden in the presentation)" : `Slide ${index + 1}`,
    text,
    metadata: { page: index + 1, slide: index + 1, ...(index === 2 ? { hidden: true } : {}), extractor: "pages-v1" }
  }));
  const { service } = serviceWith({ docs: [deck], chunks });
  const context = await buildDocumentContext({ documents: service, readyDocuments: [deck], tokenBudget: 50_000 });
  const library = textOf((await context.render(true)).library);
  assert.match(library, /included in full below; slide 3 is hidden in the presentation and included, labelled hidden/);
  assert.match(library, /--- Slide 3 \(hidden in the presentation\) ---\nReserve 73, code HIDDEN-94Z/);

  clearDocumentTextCache();
  const old = pagedDoc(2, { name: "Old.pptx", kind: "pptx", pages: 3, metadata: { hidden_slides: [3] } });
  const oldChunks = ["Intro", "Plan", "Close"].map((text, index) => ({
    document_file_id: old.id, chunk_index: index, source_type: "slide", source_label: `Slide ${index + 1}`, text,
    metadata: { page: index + 1, slide: index + 1, extractor: "pages-v1" }
  }));
  const { service: oldService } = serviceWith({ docs: [old], chunks: oldChunks });
  const oldContext = await buildDocumentContext({ documents: oldService, readyDocuments: [old], tokenBudget: 50_000 });
  const oldLibrary = textOf((await oldContext.render(true)).library);
  assert.match(oldLibrary, /Old\.pptx \([^)]*\): included below; hidden slide 3 was not captured/);
  assert.doesNotMatch(oldLibrary, /Old\.pptx[^\n]*included in full/);
});

test("text read from a scan by OCR is searchable text, flagged so exact characters come from the image", async () => {
  clearDocumentTextCache();
  const scan = pagedDoc(3, { name: "Scan.pdf", pages: 1 });
  const chunks = [{
    document_file_id: scan.id, chunk_index: 0, source_type: "page", source_label: "Page 1", text: "Code SCAN-0O1I-719",
    metadata: { page: 1, visual: true, visual_reason: "image", ocr: true, extractor: "pages-v1" }
  }];
  const { service } = serviceWith({ docs: [scan], chunks, config: { maxContextImages: 0 } });
  const context = await buildDocumentContext({ documents: service, readyDocuments: [scan], tokenBudget: 50_000 });
  const library = textOf((await context.render(true)).library);
  assert.match(library, /--- Page 1 ---\n\(Scanned page: this text was read by OCR[^\n]*\)\nCode SCAN-0O1I-719/);
});

test("a broad read names the page images it left out and how to fetch them", async () => {
  clearDocumentTextCache();
  const doc = pagedDoc(6, { name: "Scan65.pdf", pages: 6 });
  const chunks = pageChunks(doc, ["s1", "s2", "s3", "s4", "s5", "s6"], [1, 2, 3, 4, 5, 6]);
  const pages = [1, 2, 3, 4, 5, 6].map((number) => ({ id: `p${number}`, document_file_id: doc.id, page_number: number, image_key: `k/${number}.jpg` }));
  const { service } = serviceWith({ docs: [doc], chunks, pages, config: { visualMaxPagesPerTool: 2 } });

  const result = await service.read({ attachmentId: doc.attachment_id });
  assert.equal(result.results.length, 6);
  assert.deepEqual(result.visualPages.map((page) => page.page_number), [1, 2]);
  assert.deepEqual(result.images_omitted.documents, [{ attachment_id: doc.attachment_id, name: "Scan65.pdf", pages: [3, 4, 5, 6] }]);
  assert.match(result.images_omitted.notice, /images of pages 3-6 of Scan65\.pdf were not attached/);
  assert.match(result.images_omitted.notice, new RegExp(`attachment_id ${doc.attachment_id}, page_start 3, page_end 4`));

  // The notice reaches the model: the tool result the loop sends keeps it.
  const call = await executeDocumentToolCall({
    toolCall: { function: { name: "read_document", arguments: JSON.stringify({ attachment_id: doc.attachment_id }) } },
    documents: service,
    maxToolResultChars: 80_000
  });
  assert.deepEqual(JSON.parse(call.toolResultJson).images_omitted, result.images_omitted);

  const all = await service.read({ attachmentId: doc.attachment_id, pageStart: 1, pageEnd: 2 });
  assert.equal(all.images_omitted, undefined);
});

test("a scanned page whose OCR failed says it has no searchable text", async () => {
  clearDocumentTextCache();
  const scan = pagedDoc(7, { name: "Blurry.pdf", pages: 1 });
  const chunks = [{
    document_file_id: scan.id, chunk_index: 0, source_type: "page", source_label: "Page 1", text: "",
    metadata: { page: 1, visual: true, visual_reason: "image", ocr_failed: true, extractor: "pages-v1" }
  }];
  const { service } = serviceWith({ docs: [scan], chunks, config: { maxContextImages: 0 } });
  const context = await buildDocumentContext({ documents: service, readyDocuments: [scan], tokenBudget: 50_000 });
  assert.match(textOf((await context.render(true)).library), /--- Page 1 ---\n\(Scanned page: OCR could not read it/);
  const read = await service.read({ attachmentId: scan.attachment_id });
  assert.match(read.results[0].content, /OCR could not read it/);
});

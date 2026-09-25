import assert from "node:assert/strict";
import test from "node:test";

import { DocumentService } from "../server/documents/index.js";
import {
  chunkPageNumber,
  pageLooksVisual,
  queryNeedsRewrite,
  queryWantsVisual,
  reciprocalRankFusion,
  retrievalWorthwhile,
  rewriteDocumentQuery
} from "../server/documents/retrieval.js";

const userId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";
const syllabus = {
  id: "doc-syllabus",
  attachment_id: "00000000-0000-4000-8000-000000000011",
  conversation_id: conversationId,
  kind: "pdf",
  page_count: 4,
  text_ready_at: "2026-09-01T00:00:00Z",
  visual_ready_at: "2026-09-01T00:00:00Z",
  attachments: { file_name: "Syllabus.pdf" }
};
const slides = {
  id: "doc-slides",
  attachment_id: "00000000-0000-4000-8000-000000000012",
  conversation_id: conversationId,
  kind: "pdf",
  page_count: 17,
  text_ready_at: "2026-09-01T00:00:00Z",
  visual_ready_at: "2026-09-01T00:00:00Z",
  attachments: { file_name: "Syntax.pdf" }
};

function page(doc, number, text = "", extra = {}) {
  return {
    id: `${doc.id}-p${number}`,
    document_file_id: doc.id,
    page_number: number,
    source_label: `Page ${number}`,
    image_key: `pages/${doc.id}/${number}.jpg`,
    text,
    char_count: text.length,
    ...extra
  };
}

function chunk(doc, number, text, extra = {}) {
  return {
    id: `${doc.id}-c${number}`,
    document_file_id: doc.id,
    chunk_index: number,
    source_type: "page",
    source_label: `Page ${number}`,
    text,
    metadata: { page: number },
    ...extra
  };
}

function serviceWith(db, documents = {}) {
  return new DocumentService({
    config: {
      documents: {
        enabled: true,
        visualMaxPagesPerTool: 40,
        jinaApiKey: "test-key",
        rerankModel: "",
        ...documents
      }
    },
    db: { async listUsableDocumentFiles() { return [syllabus, slides]; }, ...db },
    r2: { readUrl: (key) => `https://signed.example/${key}` },
    userId,
    conversationId,
    plan: { id: "pro" },
    signal: new AbortController().signal
  });
}

test("reciprocal rank fusion rewards items found by several searches", () => {
  const fused = reciprocalRankFusion([
    { name: "a", items: ["x", "y", "z"], key: (value) => value },
    { name: "b", items: ["y"], key: (value) => value }
  ]);
  assert.deepEqual(fused.map((entry) => entry.key), ["y", "x", "z"]);
  assert.deepEqual(fused[0].ranks, { a: 1, b: 0 });
});

test("reciprocal rank fusion counts only the best rank per list for a shared key", () => {
  const fused = reciprocalRankFusion([
    { items: [{ page: 1 }, { page: 1 }, { page: 1 }, { page: 2 }], key: (item) => String(item.page) },
    { items: [{ page: 2 }], key: (item) => String(item.page) }
  ]);
  assert.equal(fused[0].key, "2");
});

test("chunk page numbers come from PDF pages or PPTX slides", () => {
  assert.equal(chunkPageNumber({ metadata: { page: 3 } }), 3);
  assert.equal(chunkPageNumber({ metadata: { slide: 6 } }), 6);
  assert.equal(chunkPageNumber({ metadata: { sheet: "Main" } }), 0);
});

test("visual heuristics flag figure questions and text-poor pages", () => {
  assert.equal(queryWantsVisual("explain the diagram on the parse tree slide"), true);
  assert.equal(queryWantsVisual("what is a context free grammar"), false);
  assert.equal(pageLooksVisual({ text: "Schedule:" }), true);
  assert.equal(pageLooksVisual({ text: "x".repeat(2000) }), false);
  assert.equal(pageLooksVisual({ text: "x".repeat(2000) }, { hasTableChunk: true }), true);
  assert.equal(pageLooksVisual({ text: "x".repeat(2000) }, { documentKind: "pptx" }), true);
});

test("small talk skips retrieval and follow-ups are rewritten", () => {
  assert.equal(retrievalWorthwhile("thanks!"), false);
  assert.equal(retrievalWorthwhile("When is the midterm?"), true);
  const history = [{ role: "user", content: "What are BNF grammars?" }, { role: "assistant", content: "..." }];
  assert.equal(queryNeedsRewrite("what about the second one?", history), true);
  assert.equal(queryNeedsRewrite("what about the second one?", []), false);
  assert.equal(queryNeedsRewrite("Explain the difference between lexical analysis and syntax analysis in compilers with examples from the course", history), false);
});

test("query rewriting resolves follow-ups and falls back to the raw text on failure", async () => {
  const history = [
    { role: "user", content: "Which exams are in the syllabus?" },
    { role: "assistant", content: "A midterm and a final." }
  ];
  const config = { providers: { openrouter: { apiKey: "key", baseUrl: "https://openrouter.example" } } };
  let prompt = "";
  const rewritten = await rewriteDocumentQuery({
    userText: "when is the first one?",
    history,
    config,
    completeChat: async ({ body }) => {
      prompt = body.messages[1].content;
      return "\"midterm exam date\"\n";
    }
  });
  assert.equal(rewritten, "midterm exam date");
  assert.match(prompt, /Which exams are in the syllabus/);

  const fallback = await rewriteDocumentQuery({
    userText: "when is the first one?",
    history,
    config,
    completeChat: async () => { throw new Error("timeout"); }
  });
  assert.equal(fallback, "when is the first one?");
});

test("retrieve fuses keyword, semantic and page-image hits into ranked pages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ embedding: Array(768).fill(0.01) }] }));
  try {
    const service = serviceWith({
      async searchDocumentChunks() {
        return [chunk(syllabus, 4, "Grading: midterm 30%")];
      },
      async searchDocumentChunksSemantic() {
        return [
          { ...chunk(syllabus, 2, "Course schedule"), distance: 0.4 },
          { ...chunk(slides, 9, "unrelated"), distance: 0.95 }
        ];
      },
      async searchDocumentPages() {
        return [
          { ...page(syllabus, 2, "9. Course Topics and Schedule:"), distance: 0.3 },
          { ...page(slides, 1, "BNF"), distance: 0.9 }
        ];
      },
      async listDocumentPagesByNumbers(_userId, docId, numbers) {
        return numbers.map((number) => page(docId === syllabus.id ? syllabus : slides, number, "Grading text"));
      }
    });
    const result = await service.retrieve([syllabus, slides], { query: "when is the midterm", maxPages: 4 });
    assert.equal(result.relevant, true);
    // The distant semantic chunk and the distant page image are filtered out.
    assert.deepEqual(result.chunks.map((entry) => entry.id), ["doc-syllabus-c4", "doc-syllabus-c2"]);
    assert.deepEqual(result.pages.map((entry) => entry.key), ["doc-syllabus:2", "doc-syllabus:4"]);
    assert.equal(result.pages[0].ranks.image, 0);
    assert.equal(result.pages[1].page.text, "Grading text");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retrieve reorders text candidates with the reranker when configured", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/rerank")) {
      return new Response(JSON.stringify({ results: [
        { index: 1, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.1 },
        { index: 2, relevance_score: -0.2 }
      ] }));
    }
    return new Response(JSON.stringify({ data: [{ embedding: Array(768).fill(0.01) }] }));
  };
  try {
    const service = serviceWith({
      async searchDocumentChunks() {
        return [chunk(slides, 3, "grammar"), chunk(slides, 5, "BNF grammar rules"), chunk(slides, 9, "office hours")];
      },
      async searchDocumentChunksSemantic() { return []; },
      async searchDocumentPages() { return []; },
      async listDocumentPagesByNumbers(_userId, _docId, numbers) {
        return numbers.map((number) => page(slides, number, "text"));
      }
    }, { rerankModel: "jina-reranker-v3" });
    const result = await service.retrieve([slides], { query: "explain BNF grammars" });
    // Below the relevance floor, the office-hours chunk is dropped.
    assert.deepEqual(result.chunks.map((entry) => entry.id), ["doc-slides-c5", "doc-slides-c3"]);
    assert.equal(result.signals.reranked, true);
    assert.equal(result.pages[0].key, "doc-slides:5");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("relevant context attaches images only for visual or image-matched pages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ embedding: Array(768).fill(0.01) }] }));
  try {
    const textHeavy = "Lexical analysis ".repeat(100);
    const service = serviceWith({
      async searchDocumentChunks() {
        return [chunk(slides, 7, textHeavy), chunk(slides, 8, textHeavy)];
      },
      async searchDocumentChunksSemantic() { return []; },
      async searchDocumentPages() {
        return [{ ...page(syllabus, 2, "Schedule:"), distance: 0.35 }];
      },
      async listDocumentPagesByNumbers(_userId, _docId, numbers) {
        return numbers.map((number) => page(slides, number, textHeavy));
      }
    });
    const context = await service.relevantContext({
      query: "what is lexical analysis",
      docs: [syllabus, slides],
      maxImages: 3
    });
    const imagePages = context.visualPages.map((entry) => `${entry.document_file_id}:${entry.page_number}`);
    // The syllabus page matched on its image; the text-heavy slides only go in as text.
    assert.deepEqual(imagePages, ["doc-syllabus:2"]);
    const textTitles = context.results.filter((entry) => entry.source_type !== "page_image").map((entry) => entry.title);
    assert.deepEqual(textTitles, ["Syntax.pdf - Page 7", "Syntax.pdf - Page 8"]);
    // Source numbers stay unique across excerpts and images.
    assert.deepEqual(context.results.map((entry) => entry.index), [1, 2, 3]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("relevant context shows a short attached document whole", async () => {
  const service = serviceWith({
    async searchDocumentChunks() { return []; },
    async listDocumentChunks() { return []; },
    async listDocumentPagesByNumbers(_userId, _docId, numbers) {
      return numbers.map((number) => page(syllabus, number, "x".repeat(2000)));
    }
  }, { jinaApiKey: "" });
  const context = await service.relevantContext({
    query: "summarize this",
    docs: [syllabus, slides],
    attachedDocumentIds: [syllabus.attachment_id]
  });
  assert.deepEqual(context.visualPages.map((entry) => entry.page_number), [1, 2, 3, 4]);
});

test("relevant context sizes evidence by token budget, not fixed counts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ embedding: Array(768).fill(0.01) }] }));
  try {
    const excerpts = Array.from({ length: 12 }, (_, index) => chunk(slides, index + 1, `BNF rule ${index} ${"grammar ".repeat(120)}`));
    const service = serviceWith({
      async searchDocumentChunks() { return excerpts; },
      async searchDocumentChunksSemantic() { return []; },
      async searchDocumentPages() { return []; },
      async listDocumentPagesByNumbers(_userId, _docId, numbers) {
        return numbers.map((number) => page(slides, number, "x".repeat(2000)));
      }
    });
    const everything = await service.relevantContext({ query: "BNF grammar rules", docs: [syllabus, slides], supportsVision: false });
    // Every relevant excerpt, well past the old cap of 5.
    assert.equal(everything.results.length, 12);

    const tight = await service.relevantContext({ query: "BNF grammar rules", docs: [syllabus, slides], supportsVision: false, tokenBudget: 700 });
    assert.equal(tight.results.length, 2);

    // Documents already in the full-text library get no duplicate excerpts,
    // but their matching passages are still listed as sources.
    const library = await service.relevantContext({
      query: "BNF grammar rules",
      docs: [syllabus, slides],
      supportsVision: false,
      fullTextDocIds: new Set([slides.id])
    });
    assert.equal(library.results.length, 0);
    assert.ok(library.sourceCitations.length > 0);
    assert.deepEqual(library.partialDocuments.map((doc) => doc.id), [syllabus.id]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

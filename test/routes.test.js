import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { loadConfig } from "../server/config.js";
import { withAvailableTools } from "../server/chat/pipeline.js";
import { buildDocumentTools } from "../server/documents/tool.js";
import { sanitizeResearchPublicView } from "../server/research/public.js";
import {
  buildRelevantDocumentContext,
  installStableRequestSignal,
  normalizeAgentMode,
  runSharedPreSearch,
  shouldSuppressWebSearchForDocumentTurn,
  withResearchReportContext
} from "../server/routes.js";

test("withResearchReportContext makes completed reports available to follow-up prompts", async () => {
  const messages = [
    { role: "user", content: "Research affordable fragrances" },
    {
      role: "assistant",
      content: "A research report is available.",
      metadata: { research: { runId: "run-1", status: "succeeded" } }
    },
    { role: "user", content: "Can you summarize the above?" }
  ];

  const hydrated = await withResearchReportContext(messages, {
    loadRun: async (runId) => ({ id: runId, report_markdown: "# Fragrances\n\nA detailed report." })
  });

  assert.equal(messages[1].content, "A research report is available.");
  assert.match(hydrated[1].content, /Deep research report produced earlier/);
  assert.match(hydrated[1].content, /# Fragrances/);
  assert.equal(hydrated[2].content, "Can you summarize the above?");
});

test("withResearchReportContext uses sanitizeRun so denied legacy URLs never reach follow-up context", async () => {
  const config = loadConfig({ WEBSEARCH_DENY_DOMAINS: "blocked.test" });
  const messages = [
    {
      role: "assistant",
      content: "A research report is available.",
      metadata: { research: { runId: "legacy-run", status: "succeeded" } }
    },
    { role: "user", content: "Summarize that report" }
  ];
  const legacyRun = {
    id: "legacy-run",
    report_markdown: [
      "# Legacy report",
      "",
      "Safe cite [PubMed](https://pubmed.ncbi.nlm.nih.gov/1) stays.",
      "Denied cite [Adult](https://xvideos.tube/v/1) becomes plain text.",
      "Blocked cite [Extra](https://blocked.test/page) becomes plain text.",
      "Bare denied https://xvideos.tube/v/1 is removed."
    ].join("\n"),
    sources: [
      { url: "https://xvideos.tube/v/1", title: "Adult" },
      { url: "https://blocked.test/page", title: "Blocked" },
      { url: "https://pubmed.ncbi.nlm.nih.gov/1", title: "PubMed" }
    ]
  };

  const hydrated = await withResearchReportContext(messages, {
    loadRun: async () => legacyRun,
    sanitizeRun: (run) => sanitizeResearchPublicView(run, config)
  });

  assert.match(hydrated[0].content, /\[PubMed\]\(https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/1\)/);
  assert.match(hydrated[0].content, /Denied cite Adult becomes plain text/);
  assert.match(hydrated[0].content, /Blocked cite Extra becomes plain text/);
  assert.doesNotMatch(hydrated[0].content, /xvideos\.tube/);
  assert.doesNotMatch(hydrated[0].content, /blocked\.test/);
  assert.match(legacyRun.report_markdown, /xvideos\.tube/);
  assert.equal(messages[0].content, "A research report is available.");
});

test("withResearchReportContext prioritizes newer reports within its context budget", async () => {
  const hydrated = await withResearchReportContext([
    { role: "assistant", content: "old", metadata: { research: { runId: "old" } } },
    { role: "assistant", content: "new", metadata: { research: { runId: "new" } } }
  ], {
    maxChars: 10,
    loadRun: async (runId) => ({ report_markdown: runId === "new" ? "new report" : "old report" })
  });

  assert.equal(hydrated[0].content, "old");
  assert.match(hydrated[1].content, /new report/);
});

test("installStableRequestSignal shadows Node's request signal getter", () => {
  const native = new AbortController();
  const req = new EventEmitter();

  Object.defineProperty(req, "signal", {
    configurable: true,
    get: () => native.signal
  });

  const stable = installStableRequestSignal(req);
  assert.equal(req.signal, stable);
  assert.equal(stable.aborted, false);

  native.abort();
  assert.equal(stable.aborted, false);

  req.emit("aborted");
  assert.equal(stable.aborted, true);
});

test("installStableRequestSignal preserves already aborted requests", () => {
  const req = new EventEmitter();
  req.aborted = true;

  const stable = installStableRequestSignal(req);
  assert.equal(stable.aborted, true);
});

test("normalizeAgentMode only enables tools for explicit opt-in values", () => {
  assert.equal(normalizeAgentMode(true), true);
  assert.equal(normalizeAgentMode("on"), true);
  assert.equal(normalizeAgentMode("agent"), true);
  assert.equal(normalizeAgentMode(false), false);
  assert.equal(normalizeAgentMode(undefined), false);
  assert.equal(normalizeAgentMode("off"), false);
});

test("withAvailableTools gives GPT-6 Luna strict native tool-call instructions", () => {
  const config = loadConfig({});
  const result = withAvailableTools({
    model: "openai/gpt-6-luna",
    messages: [{ role: "system", content: "base" }, { role: "user", content: "search" }]
  }, {
    config,
    webMode: "auto",
    webHint: "",
    readyDocuments: []
  });

  assert.equal(result.augmented, true);
  assert.match(result.request.messages[0].content, /native tool calls only/);
  assert.match(result.request.messages[0].content, /valid JSON object/);
  assert.match(result.request.messages[0].content, /complete final answer/);
});

test("withAvailableTools advertises deferred document capabilities through load_tools", () => {
  const result = withAvailableTools({
    model: "test",
    messages: [{ role: "system", content: "base" }, { role: "user", content: "help" }]
  }, {
    config: loadConfig({}),
    webMode: "off",
    webHint: "",
    readyDocuments: [],
    deferredTools: buildDocumentTools()
  });

  assert.deepEqual(result.request.tools.map((tool) => tool.function.name), ["load_tools"]);
  assert.match(result.request.messages[0].content, /call load_tools to discover and enable additional tools/);
  assert.match(result.request.messages[0].content, /Never refuse a request because a tool is not yet listed/);
  assert.match(result.request.tools[0].function.description, /documents\.create: create and write/);
  assert.equal(result.deferredTools.length, 6);
});

test("course chat exposes an exact-source study preview tool", () => {
  const result = withAvailableTools({
    model: "test",
    messages: [{ role: "system", content: "base" }, { role: "user", content: "Create flashcards on page 5 of Respiratory" }]
  }, {
    config: loadConfig({}),
    webMode: "off",
    readyDocuments: [{ attachment_id: "attachment-1", project_id: "course-1", attachments: { file_name: "Respiratory.pdf" } }],
    study: { course: { id: "course-1" } }
  });
  assert.deepEqual(result.request.tools.map((tool) => tool.function.name), ["create_study_preview"]);
  assert.match(result.request.messages[0].content, /Respiratory\.pdf \(attachment_id attachment-1\)/);
  assert.match(result.request.messages[0].content, /exact requested page number/);
});

test("weather prompts expose weather without web search", () => {
  const result = withAvailableTools({
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "what's the temp in Dubai" }]
  }, {
    config: loadConfig({ OPENWEATHER_API_KEY: "weather-key" }),
    webMode: "auto",
    webHint: "Use web search.",
    readyDocuments: [],
    userText: "what's the temp in Dubai"
  });

  assert.deepEqual(result.request.tools.map((tool) => tool.function.name), ["get_weather"]);
  assert.deepEqual(result.enabled, { websearch: false, weather: true, documents: false });
});

test("shouldSuppressWebSearchForDocumentTurn keeps artifact-only follow-ups cheap", () => {
  const documentSkills = { toolNames: ["create_document"] };

  assert.equal(shouldSuppressWebSearchForDocumentTurn({
    webMode: "auto",
    detection: { score: 0, reasons: [], hasUrls: false, urls: [] },
    documentSkills
  }), true);

  assert.equal(shouldSuppressWebSearchForDocumentTurn({
    webMode: "auto",
    detection: { score: 1, reasons: ["time-sensitive"], hasUrls: false, urls: [] },
    documentSkills
  }), false);

  assert.equal(shouldSuppressWebSearchForDocumentTurn({
    webMode: "auto",
    detection: { score: 1, reasons: ["explicit-search-command"], hasUrls: false, urls: [] },
    documentSkills
  }), false);

  assert.equal(shouldSuppressWebSearchForDocumentTurn({
    webMode: "on",
    detection: { score: 0, reasons: [], hasUrls: false, urls: [] },
    documentSkills
  }), false);
});

test("runSharedPreSearch searches in auto mode even when heuristic score is zero", async () => {
  const calls = [];
  const websearch = {
    async search(args) {
      calls.push({ type: "search", ...args });
      return {
        ok: true,
        provider: "searxng",
        query: args.query,
        results: [{
          index: 1,
          title: "MiniMax M3 reviews",
          url: "https://example.com/minimax-m3",
          snippet: "Recent user reviews and discussion.",
          content: "",
          publishedAt: null
        }]
      };
    },
    async readUrl({ url }) {
      calls.push({ type: "readUrl", url });
      return {
        ok: true,
        provider: "jina",
        title: "MiniMax M3 reviews (full)",
        url,
        content: "Full body of the MiniMax M3 reviews page.",
        publishedAt: null
      };
    }
  };

  const result = await runSharedPreSearch({
    websearch,
    userText: "what are the reviews on the MiniMax M3 model?",
    mode: "auto",
    signal: new AbortController().signal
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].type, "search");
  assert.equal(calls[1].type, "readUrl");
  assert.equal(calls[1].url, "https://example.com/minimax-m3");
  assert.ok(result.providers.includes("searxng"));
  assert.ok(result.providers.includes("jina"));
  assert.equal(result.citations.length, 1);
  assert.match(result.contextMessage, /MiniMax M3 reviews/);
  assert.match(result.contextMessage, /Full body of the MiniMax M3 reviews page/);
});

test("runSharedPreSearch still reads pasted URLs instead of searching", async () => {
  const calls = [];
  const websearch = {
    async search() {
      throw new Error("search should not be called for URL-only prompts");
    },
    async readUrl({ url }) {
      calls.push(url);
      return {
        ok: true,
        provider: "jina",
        title: "Article",
        url,
        content: "Fetched article content.",
        publishedAt: null
      };
    }
  };

  const result = await runSharedPreSearch({
    websearch,
    userText: "read https://example.com/article",
    mode: "auto",
    signal: new AbortController().signal
  });

  assert.deepEqual(calls, ["https://example.com/article"]);
  assert.equal(result.providers[0], "jina");
  assert.equal(result.citations[0].url, "https://example.com/article");
  assert.match(result.contextMessage, /Fetched article content/);
});

test("buildRelevantDocumentContext sends retrieved excerpts and relevant page images", async () => {
  const attachmentId = "00000000-0000-4000-8000-000000000001";
  const calls = [];
  const documents = {
    async relevantContext(options) {
      calls.push(options);
      return {
        results: [
          { index: 1, title: "Syllabus.pdf - Page 2", content: "Midterm: week 8", source_type: "page", document_file_id: "doc-syllabus" },
          { index: 2, title: "Syllabus.pdf - Page 2", content: "", source_type: "page_image", document_file_id: "doc-syllabus" }
        ],
        citations: [
          { index: 1, type: "document", title: "Syllabus.pdf - Page 2", chunk_ids: ["c1"] },
          { index: 2, type: "document", title: "Syllabus.pdf - Page 2", page_ids: ["p2"] }
        ],
        visualPages: [{
          index: 2,
          title: "Syllabus.pdf - Page 2",
          document_file_id: "doc-syllabus",
          page_number: 2,
          url: "https://signed.example/page-2.jpg",
          text: "Course schedule"
        }],
        retrieval: { query: "when is the midterm", signals: { keyword: 2, semantic: 3, image: 1, reranked: true } }
      };
    }
  };

  const result = await buildRelevantDocumentContext({
    documents,
    readyDocuments: [{ id: "doc-syllabus", kind: "pdf", attachment_id: attachmentId }],
    attachments: [],
    query: "when is the midterm",
    config: { documents: { visualInlineImages: false, visualMaxImageInputsPerTurn: 24 } },
    supportsVision: true,
    toolsAvailable: true,
    signal: new AbortController().signal
  });

  assert.equal(calls[0].query, "when is the midterm");
  // No fixed page count: the provider's per-request image ceiling applies.
  assert.equal(calls[0].maxImages, 24);
  assert.equal(result.pageCount, 1);
  assert.equal(result.documentCount, 1);
  assert.match(result.textMessage, /Midterm: week 8/);
  assert.match(result.textMessage, /read_document/);
  assert.equal(result.textCitations.length, 1);
  assert.equal(result.citations.length, 2);
  assert.equal(result.retrieval.reranked, true);
  const imagePart = result.message.content.find((part) => part.type === "image_url");
  assert.equal(imagePart.image_url.url, "https://signed.example/page-2.jpg");
});

test("buildRelevantDocumentContext skips retrieval for small talk", async () => {
  let calls = 0;
  const result = await buildRelevantDocumentContext({
    documents: { async relevantContext() { calls += 1; return { results: [], citations: [], visualPages: [] }; } },
    readyDocuments: [{ id: "doc", kind: "pdf", attachment_id: "00000000-0000-4000-8000-000000000002" }],
    attachments: [],
    query: "thanks!",
    config: { documents: {} },
    supportsVision: true,
    signal: new AbortController().signal
  });
  assert.equal(calls, 0);
  assert.equal(result.message, null);
  assert.equal(result.textMessage, "");
});

test("buildRelevantDocumentContext always covers a document attached to this message", async () => {
  const attachmentId = "00000000-0000-4000-8000-000000000009";
  const seen = [];
  const result = await buildRelevantDocumentContext({
    documents: {
      async relevantContext(options) {
        seen.push(options.attachedDocumentIds);
        return {
          results: [],
          citations: [{ index: 1, page_ids: ["p1"] }],
          visualPages: [{ index: 1, title: "Deck.pptx - Page 1", document_file_id: "doc-pptx", page_number: 1, url: "https://signed.example/slide-1.jpg", text: "" }]
        };
      }
    },
    readyDocuments: [{ id: "doc-pptx", kind: "pptx", attachment_id: attachmentId, visual_ready_at: "2026-07-12T00:00:00.000Z" }],
    attachments: [{ id: attachmentId, category: "document" }],
    query: "ok",
    config: { documents: { visualInlineImages: false } },
    supportsVision: true,
    signal: new AbortController().signal
  });

  assert.deepEqual(seen, [[attachmentId]]);
  assert.equal(result.pageCount, 1);
  assert.match(result.message.content[0].text, /relevant to this question are attached below as images/);
});

test("buildRelevantDocumentContext leaves full-text documents to the library and lists the rest", async () => {
  const seen = [];
  const result = await buildRelevantDocumentContext({
    documents: {
      async relevantContext(options) {
        seen.push(options);
        return {
          results: [
            { index: 1, title: "Textbook.pdf - Page 300", content: "big book passage", source_type: "page", document_file_id: "doc-book" }
          ],
          citations: [{ index: 1, type: "document", chunk_ids: ["b"] }],
          sourceCitations: [{ index: 2, type: "document", title: "Syllabus.pdf - Page 2", chunk_ids: ["s"] }],
          visualPages: [],
          partialDocuments: [{ id: "doc-book", kind: "pdf", page_count: 900, attachment_id: "att-book", attachments: { file_name: "Textbook.pdf" } }],
          retrieval: { query: "q", signals: { keyword: 1, semantic: 1, image: 0, reranked: true } }
        };
      }
    },
    readyDocuments: [
      { id: "doc-syllabus", kind: "pdf" },
      { id: "doc-book", kind: "pdf" }
    ],
    attachments: [],
    query: "what does chapter 12 say",
    config: { documents: {} },
    supportsVision: false,
    library: { fullDocIds: new Set(["doc-syllabus"]), texts: new Map(), tokens: 1000, budget: 50_000, remaining: 49_000 },
    signal: new AbortController().signal
  });

  assert.deepEqual([...seen[0].fullTextDocIds], ["doc-syllabus"]);
  assert.equal(seen[0].tokenBudget, 49_000);
  assert.match(result.textMessage, /too large to include in full[\s\S]*Textbook\.pdf \(pdf, 900 pages, attachment_id att-book\)/);
  assert.match(result.textMessage, /big book passage/);
  assert.equal(result.mode, "mixed");
  // Passages that matched in full-text documents are still listed as sources.
  assert.deepEqual(result.citations.map((citation) => citation.index), [1, 2]);
  assert.equal(result.message, null);
});

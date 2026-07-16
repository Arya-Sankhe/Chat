import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { loadConfig } from "../server/config.js";
import { withAvailableTools } from "../server/chat/pipeline.js";
import { sanitizeResearchPublicView } from "../server/research/public.js";
import {
  buildDirectPdfVisualContext,
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

test("withAvailableTools gives MiniMax M3 strict native tool-call instructions", () => {
  const config = loadConfig({});
  const result = withAvailableTools({
    model: "minimax/minimax-m3",
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

test("buildDirectPdfVisualContext attaches only relevant ready PDF pages", async () => {
  const attachmentId = "00000000-0000-4000-8000-000000000001";
  const otherAttachmentId = "00000000-0000-4000-8000-000000000002";
  const seenDocs = [];
  const documents = {
    async pageResultsForDocs(docs) {
      seenDocs.push(...docs.map((doc) => doc.id));
      return {
        citations: [{ index: 1, type: "document", title: "Homework.pdf - Page 1" }],
        visualPages: [{
          index: 1,
          title: "Homework.pdf - Page 1",
          page_number: 1,
          url: "https://signed.example/page-1.jpg",
          text: "Question 1"
        }]
      };
    }
  };

  const result = await buildDirectPdfVisualContext({
    documents,
    readyDocuments: [
      { id: "doc-current", kind: "pdf", attachment_id: attachmentId },
      { id: "doc-other", kind: "pdf", attachment_id: otherAttachmentId },
      { id: "doc-word", kind: "docx", attachment_id: "00000000-0000-4000-8000-000000000003" }
    ],
    attachments: [{ id: attachmentId, category: "document" }],
    config: { documents: { visualInlineImages: false, visualMaxImageInputsPerTurn: 2 } },
    supportsVision: true,
    signal: new AbortController().signal
  });

  assert.deepEqual(seenDocs, ["doc-current"]);
  assert.equal(result.pageCount, 1);
  assert.equal(result.documentCount, 1);
  assert.equal(result.citations[0].title, "Homework.pdf - Page 1");
  const imagePart = result.message.content.find((part) => part.type === "image_url");
  assert.equal(imagePart.image_url.url, "https://signed.example/page-1.jpg");
});

test("buildDirectPdfVisualContext includes visually enriched Office documents", async () => {
  const attachmentId = "00000000-0000-4000-8000-000000000009";
  const seenDocs = [];
  const result = await buildDirectPdfVisualContext({
    documents: {
      async pageResultsForDocs(docs) {
        seenDocs.push(...docs.map((doc) => doc.id));
        return {
          citations: [],
          visualPages: [{
            index: 1,
            title: "Deck.pptx - Page 1",
            page_number: 1,
            url: "https://signed.example/slide-1.jpg",
            text: ""
          }]
        };
      }
    },
    readyDocuments: [{
      id: "doc-pptx",
      kind: "pptx",
      attachment_id: attachmentId,
      visual_ready_at: "2026-07-12T00:00:00.000Z"
    }],
    attachments: [{ id: attachmentId, category: "document" }],
    config: { documents: { visualInlineImages: false, visualMaxImageInputsPerTurn: 2 } },
    supportsVision: true,
    signal: new AbortController().signal
  });

  assert.deepEqual(seenDocs, ["doc-pptx"]);
  assert.equal(result.pageCount, 1);
  assert.match(result.message.content[0].text, /uploaded document pages/);
});

test("buildDirectPdfVisualContext leaves XLSX pages for explicit visual reads", async () => {
  let pageCalls = 0;
  const result = await buildDirectPdfVisualContext({
    documents: {
      async pageResultsForDocs() {
        pageCalls += 1;
        return { citations: [], visualPages: [] };
      }
    },
    readyDocuments: [{
      id: "doc-xlsx",
      kind: "xlsx",
      attachment_id: "00000000-0000-4000-8000-000000000010",
      visual_ready_at: "2026-07-16T00:00:00.000Z"
    }],
    attachments: [{ id: "00000000-0000-4000-8000-000000000010", category: "document" }],
    config: { documents: { visualInlineImages: false, visualMaxImageInputsPerTurn: 2 } },
    supportsVision: true,
    signal: new AbortController().signal
  });

  assert.equal(pageCalls, 0);
  assert.equal(result.documentCount, 0);
  assert.equal(result.message, null);
});

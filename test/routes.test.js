import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  buildDirectPdfVisualContext,
  installStableRequestSignal,
  normalizeAgentMode,
  runSharedPreSearch,
  shouldSuppressWebSearchForDocumentTurn
} from "../server/routes.js";

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
    async readUrl() {
      throw new Error("readUrl should not be called for non-URL prompts");
    }
  };

  const result = await runSharedPreSearch({
    websearch,
    userText: "what are the reviews on the MiniMax M3 model?",
    mode: "auto",
    signal: new AbortController().signal
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "search");
  assert.equal(result.providers[0], "searxng");
  assert.equal(result.citations.length, 1);
  assert.match(result.contextMessage, /MiniMax M3 reviews/);
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

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { loadConfig } from "../server/config.js";
import { withAvailableTools } from "../server/chat/pipeline.js";
import { buildDocumentTools } from "../server/documents/tool.js";
import { selectDocumentSkills } from "../server/documents/skills.js";
import { sanitizeResearchPublicView } from "../server/research/public.js";
import {
  installStableRequestSignal,
  normalizeAgentMode,
  runSharedPreSearch,
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
    readyDocuments: []
  });

  assert.equal(result.augmented, true);
  assert.match(result.request.messages[0].content, /Use web_search when the answer depends on current/);
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

test("weather prompts keep web search next to the weather tool", () => {
  const result = withAvailableTools({
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "what's the temp in Dubai and will the match be rained off" }]
  }, {
    config: loadConfig({ OPENWEATHER_API_KEY: "weather-key" }),
    webMode: "auto",
    readyDocuments: []
  });

  assert.deepEqual(result.request.tools.map((tool) => tool.function.name), ["web_search", "read_url", "get_weather"]);
  assert.deepEqual(result.enabled, { websearch: true, weather: true, documents: false });
});

test("document requests offer web tools for the model to choose unless search is off", () => {
  const config = loadConfig({});
  for (const text of [
    "turn this info into a Word doc",
    "put the above into a table in a Word document",
    "make a nice PPT out of this conversation",
    "convert this to a PDF",
    "create an Excel spreadsheet from these notes",
    "I want a pricing comparison of Sol 6.1 and Luna 6; turn this info into a Word doc",
    "Create a Word document comparing the pricing of Sol 6.1 and Luna 6 and turn this info into a table"
  ]) {
    const documentSkills = selectDocumentSkills({ text, readyDocuments: [] });
    for (const webMode of ["auto", "on", "off"]) {
      const result = withAvailableTools({ model: "test", messages: [{ role: "user", content: text }] }, {
        config, webMode, readyDocuments: [], documentSkills
      });
      const names = result.request.tools.map((tool) => tool.function.name);
      assert.ok(names.includes("create_document"), text);
      assert.equal(names.includes("web_search"), webMode !== "off", `${webMode}: ${text}`);
      assert.equal(names.includes("read_url"), webMode !== "off", `${webMode}: ${text}`);
      assert.equal(result.request.tool_choice, "auto");
    }
  }
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

test("page evidence goes before the user's latest message so it stays last", async () => {
  const { insertBeforeLatestUserMessage } = await import("../server/chat/shared.js");
  const { latestUserImages } = await import("../server/chat/pipeline.js");
  const image = { type: "image_url", image_url: { url: "https://r2.example/slide.png" } };
  const user = { role: "user", content: [{ type: "text", text: "explain these slides" }, image] };
  const pages = { role: "user", content: [{ type: "text", text: "retrieved pages" }] };
  const messages = insertBeforeLatestUserMessage([{ role: "system", content: "s" }, user], pages);
  assert.deepEqual(messages.map((message) => message.role), ["system", "user", "user"]);
  assert.equal(messages[1], pages);
  assert.equal(messages.at(-1), user);
  assert.deepEqual(latestUserImages(messages), [image]);
});

test("ticked source pages survive only for sources in scope", async () => {
  const { normalizeSourcePages } = await import("../server/chat/pipeline.js");
  const id = "9e1284db-330c-4de2-8b8d-b0067c0cb171";
  assert.deepEqual(normalizeSourcePages({ [id]: [3, "1", 3, 0, -2, 1.5], other: [1] }, [id]), { [id]: [1, 3] });
  assert.deepEqual(normalizeSourcePages([1, 2], [id]), {});
  assert.deepEqual(normalizeSourcePages({ [id]: [1] }, []), {});
  // A source past the page cap keeps a page instead of falling back to the whole document.
  const other = "0b6f2c4e-1d2a-4c55-9b0e-7a3f9c1d2e44";
  const capped = normalizeSourcePages({ [id]: Array.from({ length: 60 }, (_, i) => i + 1), [other]: [7] }, [id, other]);
  assert.equal(capped[id].length, 60);
  assert.deepEqual(capped[other], [7]);
});

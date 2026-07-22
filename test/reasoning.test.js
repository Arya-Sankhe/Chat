import assert from "node:assert/strict";
import test from "node:test";

import { adaptChatRequestForProvider } from "../server/providers.js";
import { applyStreamEvent, stripLeakedToolMarkup } from "../server/saas/messages.js";
import { extractReasoningDelta } from "../server/saas/reasoning.js";

test("extractReasoningDelta reads Klui reasoning_content", () => {
  assert.equal(extractReasoningDelta({ reasoning_content: "step one" }), "step one");
});

test("extractReasoningDelta reads OpenRouter reasoning string", () => {
  assert.equal(extractReasoningDelta({ reasoning: "thinking aloud" }), "thinking aloud");
});

test("extractReasoningDelta concatenates OpenRouter reasoning_details text chunks", () => {
  const delta = {
    reasoning_details: [
      { type: "reasoning.text", text: "First " },
      { type: "reasoning.text", text: "second" },
      { type: "reasoning.summary", summary: " (summary)" }
    ]
  };
  assert.equal(extractReasoningDelta(delta), "First second (summary)");
});

test("extractReasoningDelta ignores encrypted reasoning details", () => {
  const delta = {
    reasoning_details: [{ type: "reasoning.encrypted", data: "abc" }]
  };
  assert.equal(extractReasoningDelta(delta), "");
});

test("adaptChatRequestForProvider maps reasoning_effort to OpenRouter reasoning", () => {
  const adapted = adaptChatRequestForProvider({
    model: "xiaomi/mimo-v2.5",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "high",
    temperature: 0.7
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { effort: "high", exclude: false });
  assert.equal(adapted.reasoning_effort, undefined);
  assert.equal(adapted.temperature, 0.7);
});

test("adaptChatRequestForProvider pins OpenRouter routing to tool-capable endpoints when tools are present", () => {
  const adapted = adaptChatRequestForProvider({
    model: "xiaomi/mimo-v2.5",
    messages: [{ role: "user", content: "search" }],
    tools: [{ type: "function", function: { name: "web_search" } }],
    tool_choice: "auto"
  }, "openrouter");

  assert.deepEqual(adapted.provider, { require_parameters: true });
  assert.equal(adapted.tool_choice, "auto");
});

test("adaptChatRequestForProvider does not force require_parameters without tools", () => {
  const adapted = adaptChatRequestForProvider({
    model: "xiaomi/mimo-v2.5",
    messages: [{ role: "user", content: "hi" }]
  }, "openrouter");

  assert.equal(adapted.provider, undefined);
});

test("adaptChatRequestForProvider prefers DeepSeek provider with auto fallback", () => {
  const adapted = adaptChatRequestForProvider({
    model: "deepseek/deepseek-v4-flash",
    messages: [{ role: "user", content: "hi" }]
  }, "openrouter");

  assert.deepEqual(adapted.provider, {
    order: ["deepseek"],
    allow_fallbacks: true
  });
});

test("adaptChatRequestForProvider keeps DeepSeek routing when tools are present", () => {
  const adapted = adaptChatRequestForProvider({
    model: "deepseek/deepseek-v4-flash",
    messages: [{ role: "user", content: "search" }],
    tools: [{ type: "function", function: { name: "web_search" } }]
  }, "openrouter");

  assert.deepEqual(adapted.provider, {
    order: ["deepseek"],
    allow_fallbacks: true,
    require_parameters: true
  });
});

test("adaptChatRequestForProvider preserves caller provider routing alongside require_parameters", () => {
  const adapted = adaptChatRequestForProvider({
    model: "xiaomi/mimo-v2.5",
    messages: [{ role: "user", content: "search" }],
    tools: [{ type: "function", function: { name: "web_search" } }],
    provider: { order: ["Xiaomi"] }
  }, "openrouter");

  assert.deepEqual(adapted.provider, { order: ["Xiaomi"], require_parameters: true });
});

test("adaptChatRequestForProvider leaves Klui requests unchanged", () => {
  const body = {
    model: "greg",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "medium"
  };
  assert.equal(adaptChatRequestForProvider(body, "klui"), body);
});

test("adaptChatRequestForProvider defaults OpenRouter effort to high", () => {
  const adapted = adaptChatRequestForProvider({
    model: "xiaomi/mimo-v2.5",
    messages: [{ role: "user", content: "hi" }]
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { effort: "high", exclude: false });
});

test("adaptChatRequestForProvider normalizes invalid OpenRouter effort to high", () => {
  const adapted = adaptChatRequestForProvider({
    model: "xiaomi/mimo-v2.5",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "turbo"
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { effort: "high", exclude: false });
});

test("adaptChatRequestForProvider maps xhigh reasoning effort for OpenRouter", () => {
  const adapted = adaptChatRequestForProvider({
    model: "deepseek/deepseek-v4-flash",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "xhigh"
  }, "openrouter");
  assert.deepEqual(adapted.reasoning, { effort: "xhigh", exclude: false });
});

test("adaptChatRequestForProvider maps max reasoning effort to xhigh", () => {
  const adapted = adaptChatRequestForProvider({
    model: "deepseek/deepseek-v4-flash",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "max"
  }, "openrouter");
  assert.deepEqual(adapted.reasoning, { effort: "xhigh", exclude: false });
});

test("normalizeMessageSettings accepts thinkingEffort as reasoning_effort alias", async () => {
  const { normalizeMessageSettings } = await import("../server/saas/messages.js");
  assert.deepEqual(
    normalizeMessageSettings({ settings: { thinkingEffort: "high" } }),
    { reasoning_effort: "high" }
  );
});

test("streamChatCompletion sends OpenRouter reasoning effort in request body", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = JSON.parse(options.body);
    return new Response("", {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  };

  try {
    const { streamChatCompletion } = await import("../server/crofai/client.js");
    await streamChatCompletion({
      apiKey: "test",
      baseUrl: "https://openrouter.ai/api/v1",
      providerId: "openrouter",
      body: {
        model: "xiaomi/mimo-v2.5",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "low"
      },
      signal: AbortSignal.timeout(1000)
    });

    assert.deepEqual(requestBody.reasoning, { effort: "low", exclude: false });
    assert.equal(requestBody.reasoning_effort, undefined);
    assert.equal(requestBody.stream, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamChatCompletion retries transient upstream failures then succeeds", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("network down");
    if (calls === 2) return new Response("busy", { status: 503 });
    return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  try {
    const { streamChatCompletion } = await import("../server/crofai/client.js");
    const response = await streamChatCompletion({
      apiKey: "test",
      baseUrl: "https://openrouter.ai/api/v1",
      providerId: "openrouter",
      body: { model: "xiaomi/mimo-v2.5", messages: [{ role: "user", content: "hi" }] },
      signal: AbortSignal.timeout(5000)
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamChatCompletion does not retry deterministic client errors", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: "No endpoints found that support the provided 'tool_choice' value." } }), {
      status: 404,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const { streamChatCompletion } = await import("../server/crofai/client.js");
    await assert.rejects(
      streamChatCompletion({
        apiKey: "test",
        baseUrl: "https://openrouter.ai/api/v1",
        providerId: "openrouter",
        body: {
          model: "xiaomi/mimo-v2.5",
          messages: [{ role: "user", content: "hi" }],
          tools: [{ type: "function", function: { name: "web_search" } }],
          tool_choice: "auto"
        },
        signal: AbortSignal.timeout(5000)
      }),
      /tool_choice/
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamChatCompletion stops retrying after the attempt cap", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("overloaded", { status: 503 });
  };

  try {
    const { streamChatCompletion } = await import("../server/crofai/client.js");
    await assert.rejects(streamChatCompletion({
      apiKey: "test",
      baseUrl: "https://openrouter.ai/api/v1",
      providerId: "openrouter",
      body: { model: "xiaomi/mimo-v2.5", messages: [{ role: "user", content: "hi" }] },
      signal: AbortSignal.timeout(5000),
      maxAttempts: 2
    }));
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("applyStreamEvent accumulates OpenRouter reasoning_details into message.reasoning", () => {
  const message = { content: "", reasoning: "", toolCalls: [], finishReason: "" };

  applyStreamEvent(message, {
    choices: [{
      delta: {
        reasoning_details: [{ type: "reasoning.text", text: "Let me think..." }]
      }
    }]
  });

  assert.equal(message.reasoning, "Let me think...");
});

test("extractReasoningDelta prefers one reasoning field per delta", () => {
  const delta = {
    reasoning: "same text",
    reasoning_details: [{ type: "reasoning.text", text: "same text" }]
  };

  assert.equal(extractReasoningDelta(delta), "same text");
});

test("applyStreamEvent still accumulates reasoning_content for Klui streams", () => {
  const message = { content: "", reasoning: "", toolCalls: [], finishReason: "" };

  applyStreamEvent(message, {
    choices: [{ delta: { reasoning_content: "legacy reasoning" } }]
  });

  assert.equal(message.reasoning, "legacy reasoning");
});

test("stripLeakedToolMarkup removes provider DSML tool-call blocks", () => {
  const leaked = `Here is the answer.

< | | DSML | | tool_calls>
< | | DSML | | invoke name="read_url">
< | | DSML | | parameter name="url" string="true">https://github.com/example/repo</ | | DSML | | parameter>
</ | | DSML | | invoke>
</ | | DSML | | tool_calls>

Done.`;

  assert.equal(stripLeakedToolMarkup(leaked), "Here is the answer.\n\nDone.");
});

test("stripLeakedToolMarkup keeps prose that merely mentions DSML", () => {
  const prose = "DSML is a domain-specific markup language.\nWhat is DSML used for?";
  assert.equal(stripLeakedToolMarkup(prose), prose);
});

test("applyStreamEvent strips leaked DSML markup before finalizing content", () => {
  const message = { content: "", reasoning: "", toolCalls: [], finishReason: "" };

  applyStreamEvent(message, {
    choices: [{ delta: { content: "< | | DSML | | tool_calls>\n" } }]
  });
  applyStreamEvent(message, {
    choices: [{ delta: { content: "< | | DSML | | invoke name=\"web_search\">\n" } }]
  });
  applyStreamEvent(message, {
    choices: [{ delta: { content: "</ | | DSML | | tool_calls>" }, finish_reason: "stop" }]
  });

  assert.equal(message.content, "");
  assert.equal(message.finishReason, "stop");
});

test("client defers clearing provisional tool-loop prose until the final answer starts", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../public/js/streaming.js", import.meta.url), "utf8")
  );
  const applyStreamEventSource = source.slice(
    source.indexOf("function applyStreamEvent(message, event)"),
    source.indexOf("function applyCompareStreamEvent(compareMessage, event)")
  );
  assert.match(
    applyStreamEventSource,
    /event\?\.type === "response:reset"[\s\S]*?message\.resetContentOnNextTextDelta = true;[\s\S]*?return;/
  );
  assert.match(
    applyStreamEventSource,
    /if \(message\.resetContentOnNextTextDelta\)[\s\S]*?message\.content = "";[\s\S]*?message\.finishReason = "";[\s\S]*?message\.toolCalls = \[\];[\s\S]*?delete message\.resetContentOnNextTextDelta;/
  );
});

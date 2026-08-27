import assert from "node:assert/strict";
import test from "node:test";

import { adaptChatRequestForProvider } from "../server/providers.js";
import {
  applyStreamEvent,
  stripLeakedReasoningMarkup,
  stripLeakedToolMarkup
} from "../server/saas/messages.js";
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
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "high",
    temperature: 0.7
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { effort: "high", exclude: false });
  assert.equal(adapted.reasoning_effort, undefined);
  assert.equal(adapted.temperature, 0.7);
});

test("adaptChatRequestForProvider enables reasoning without effort for Ling", () => {
  const adapted = adaptChatRequestForProvider({
    model: "inclusionai/ling-3.0-flash",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "high",
    top_p: 0.95,
    tools: [{ type: "function", function: { name: "web_search" } }]
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { enabled: true, exclude: false });
  assert.deepEqual(adapted.provider, { require_parameters: true });
  assert.equal(adapted.top_p, 0.95);
  assert.equal(adapted.models, undefined);
});

test("adaptChatRequestForProvider honors explicitly disabled reasoning", () => {
  const adapted = adaptChatRequestForProvider({
    model: "poolside/laguna-xs-2.1",
    messages: [{ role: "user", content: "title this" }],
    reasoning: { enabled: false }
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { enabled: false });
});

test("adaptChatRequestForProvider always pins HY3 reasoning to high", () => {
  const adapted = adaptChatRequestForProvider({
    model: "tencent/hy3",
    messages: [{ role: "user", content: "review these answers" }],
    reasoning_effort: "low"
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { effort: "high", exclude: false });
});

test("adaptChatRequestForProvider adds Laguna S model fallbacks", () => {
  const adapted = adaptChatRequestForProvider({
    model: "poolside/laguna-s-2.1",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "high",
    top_p: 0.95
  }, "openrouter");

  assert.deepEqual(adapted.models, [
    "poolside/laguna-s-2.1",
    "deepseek/deepseek-v4-flash-0731"
  ]);
  assert.equal(adapted.top_p, undefined);
  // Shared with DeepSeek fallback — L2 pins low (OpenRouter can't set per-fallback effort).
  assert.deepEqual(adapted.reasoning, { effort: "low", exclude: false });
});

test("adaptChatRequestForProvider keeps Laguna S enabled-only reasoning when tools force require_parameters", () => {
  const adapted = adaptChatRequestForProvider({
    model: "poolside/laguna-s-2.1",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "high",
    tools: [{ type: "function", function: { name: "web_search" } }]
  }, "openrouter");

  assert.deepEqual(adapted.models, [
    "poolside/laguna-s-2.1",
    "deepseek/deepseek-v4-flash-0731"
  ]);
  assert.deepEqual(adapted.reasoning, { enabled: true, exclude: false });
  assert.equal(adapted.provider.require_parameters, true);
});

test("adaptChatRequestForProvider keeps top_p for DeepSeek", () => {
  const adapted = adaptChatRequestForProvider({
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "hi" }],
    top_p: 0.95
  }, "openrouter");

  assert.equal(adapted.top_p, 0.95);
});

test("adaptChatRequestForProvider enables reasoning without effort for MiMo", () => {
  const adapted = adaptChatRequestForProvider({
    model: "xiaomi/mimo-v2.5",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "high"
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { enabled: true, exclude: false });
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
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "hi" }]
  }, "openrouter");

  assert.deepEqual(adapted.provider, {
    order: ["relace", "baidu", "coreweave", "novita", "streamlake", "deepinfra"],
    allow_fallbacks: true
  });
});

test("adaptChatRequestForProvider keeps DeepSeek routing when tools are present", () => {
  const adapted = adaptChatRequestForProvider({
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "search" }],
    tools: [{ type: "function", function: { name: "web_search" } }]
  }, "openrouter");

  assert.deepEqual(adapted.provider, {
    order: ["relace", "baidu", "coreweave", "novita", "streamlake", "deepinfra"],
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
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "hi" }]
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { effort: "high", exclude: false });
});

test("adaptChatRequestForProvider normalizes invalid OpenRouter effort to high", () => {
  const adapted = adaptChatRequestForProvider({
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "turbo"
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { effort: "high", exclude: false });
});

test("adaptChatRequestForProvider maps xhigh reasoning effort for OpenRouter", () => {
  const adapted = adaptChatRequestForProvider({
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "xhigh"
  }, "openrouter");
  assert.deepEqual(adapted.reasoning, { effort: "xhigh", exclude: false });
});

test("adaptChatRequestForProvider maps max reasoning effort to xhigh", () => {
  const adapted = adaptChatRequestForProvider({
    model: "deepseek/deepseek-v4-flash-0731",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "max"
  }, "openrouter");
  assert.deepEqual(adapted.reasoning, { effort: "xhigh", exclude: false });
});

test("Pro smart-routes GPT-5.6 Luna across OpenAI tiers at max reasoning", () => {
  const adapted = adaptChatRequestForProvider({
    model: "openai/gpt-5.6-luna",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "low",
    temperature: 0.7,
    top_p: 0.95,
    provider: { order: ["Other"] },
    tools: [{ type: "function", function: { name: "web_search" } }]
  }, "openrouter");

  assert.deepEqual(adapted.reasoning, { effort: "xhigh", exclude: false });
  assert.equal(adapted.temperature, undefined);
  assert.equal(adapted.top_p, undefined);
  assert.equal(adapted.service_tier, undefined);
  assert.deepEqual(adapted.provider, {
    order: ["openai/flex", "openai"],
    allow_fallbacks: true,
    preferred_max_latency: 6,
    preferred_min_throughput: 25,
    require_parameters: true
  });
});

test("website and desktop Luna requests share smart OpenAI tier routing", () => {
  const website = adaptChatRequestForProvider({
    model: "openai/gpt-5.6-luna",
    messages: [{ role: "user", content: "hi" }]
  }, "openrouter");
  assert.equal(website.service_tier, undefined);
  assert.deepEqual(website.provider, {
    order: ["openai/flex", "openai"],
    allow_fallbacks: true,
    preferred_max_latency: 6,
    preferred_min_throughput: 25
  });

  const desktop = adaptChatRequestForProvider({
    model: "openai/gpt-5.6-luna",
    messages: [{ role: "user", content: "hi" }],
    service_tier: "flex",
    provider: { order: ["openai/flex"], allow_fallbacks: false, max_price: { prompt: 0.2, completion: 1.2 } }
  }, "openrouter");
  assert.equal(desktop.service_tier, undefined);
  assert.deepEqual(desktop.provider, {
    order: ["openai/flex", "openai"],
    allow_fallbacks: true,
    preferred_max_latency: 6,
    preferred_min_throughput: 25,
    max_price: { prompt: 0.2, completion: 1.2 }
  });
});

test("normalizeMessageSettings accepts thinkingEffort as reasoning_effort alias", async () => {
  const { normalizeMessageSettings } = await import("../server/saas/messages.js");
  assert.deepEqual(
    normalizeMessageSettings({ settings: { thinkingEffort: "high" } }),
    { reasoning_effort: "high" }
  );
});

test("adaptChatRequestForProvider does not inject sampling params for MiniMax", () => {
  const adapted = adaptChatRequestForProvider({
    model: "minimax/minimax-m3",
    messages: [{ role: "user", content: "hi" }]
  }, "openrouter");
  assert.equal(adapted.temperature, undefined);
  assert.equal(adapted.top_p, undefined);
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
        model: "deepseek/deepseek-v4-flash-0731",
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

test("streamChatCompletion enables Ling reasoning without effort", async () => {
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
        model: "inclusionai/ling-3.0-flash",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "high",
        tools: [{ type: "function", function: { name: "web_search" } }]
      },
      signal: AbortSignal.timeout(1000)
    });

    assert.deepEqual(requestBody.reasoning, { enabled: true, exclude: false });
    assert.deepEqual(requestBody.provider, { require_parameters: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamChatCompletion adds Laguna S → DeepSeek fallback", async () => {
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
        model: "poolside/laguna-s-2.1",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "high",
        tools: [{ type: "function", function: { name: "web_search" } }]
      },
      signal: AbortSignal.timeout(1000)
    });

    assert.deepEqual(requestBody.models, [
      "poolside/laguna-s-2.1",
      "deepseek/deepseek-v4-flash-0731"
    ]);
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

test("streamChatCompletion falls back from GPT-5.6 Luna to MiniMax M3", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: { message: "Luna unavailable" } }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
  };

  try {
    const { streamChatCompletion } = await import("../server/crofai/client.js");
    await streamChatCompletion({
      apiKey: "test",
      baseUrl: "https://openrouter.ai/api/v1",
      providerId: "openrouter",
      body: {
        model: "openai/gpt-5.6-luna",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "low"
      },
      signal: AbortSignal.timeout(1000),
      maxAttempts: 1
    });

    assert.equal(requests[0].model, "openai/gpt-5.6-luna");
    assert.equal(requests[0].service_tier, undefined);
    assert.deepEqual(requests[0].provider, {
      order: ["openai/flex", "openai"],
      allow_fallbacks: true,
      preferred_max_latency: 6,
      preferred_min_throughput: 25
    });
    assert.deepEqual(requests[0].reasoning, { effort: "xhigh", exclude: false });
    assert.equal(requests[1].model, "minimax/minimax-m3");
    assert.equal(requests[1].temperature, undefined);
    assert.equal(requests[1].top_p, undefined);
    assert.equal(requests[1].provider, undefined);
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

test("stripLeakedReasoningMarkup keeps only content after the last closing think tag", () => {
  assert.equal(
    stripLeakedReasoningMarkup(
      "First answer.\n</think>Your goal: improve positioning.",
      "inclusionai/ling-3.0-flash"
    ),
    "Your goal: improve positioning."
  );
});

test("stripLeakedReasoningMarkup only strips Nitro leaks outside code fences", () => {
  const prose = "Models sometimes emit a stray </think> tag. Here is why.";
  const fenced = "Example:\n```html\n</think>\n```\nKeep this.";

  assert.equal(stripLeakedReasoningMarkup(prose, "deepseek/deepseek-v4-pro"), prose);
  assert.equal(stripLeakedReasoningMarkup(fenced, "inclusionai/ling-3.0-flash"), fenced);
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

// A stand-in for OpenRouter's OpenAI-compatible API, so the real server can run
// locally without keys or spend. Replies are deterministic, built from the last
// user message. Prompt words steer it:
//   long    a long multi-section reply
//   slow    tokens arrive slowly (for stop and reconnect tests)
//   reason  emits reasoning before the answer
//   fail    the request fails with a 500
// Usage: node fake-openrouter.mjs [port=55500]
import http from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.argv[2] || 55500);

const readJson = (req) => new Promise((resolve) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
});

function lastUserText(body) {
  const user = [...(body.messages || [])].reverse().find((m) => m.role === "user");
  const content = user?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || "").join(" ");
  return "";
}

function replyFor(prompt) {
  const subject = prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "your message";
  if (/\blong\b/i.test(prompt)) {
    return Array.from({ length: 12 }, (_, i) => `## Section ${i + 1}\n\nThis is paragraph ${i + 1} of a long reply about *${subject}*. It has enough words to wrap across several lines on a phone screen.\n\n- point one\n- point two\n`).join("\n");
  }
  return [
    `Here is a reply to **${subject}**.`,
    "",
    "1. First item",
    "2. Second item with `inline code`",
    "",
    "```js",
    'console.log("hello from the fake model");',
    "```",
    "",
    "| Column | Value |",
    "| --- | --- |",
    "| a | 1 |",
    "",
    "Done."
  ].join("\n");
}

// Short non-streamed asks (titles, clarifications, memory) get a short answer.
function shortReply(body) {
  const system = (body.messages || []).filter((m) => m.role === "system").map((m) => String(m.content || "")).join(" ");
  if (/title/i.test(system)) return lastUserText(body).split(/\s+/).slice(0, 5).join(" ") || "New chat";
  if (body.response_format?.type === "json_object" || /json/i.test(system)) return "{}";
  return "OK";
}

const usage = { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200, cost: 0.0001 };

function chunk(id, model, delta, finish = null) {
  return `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

async function streamCompletion(res, body) {
  const id = `gen-${randomUUID()}`;
  const model = body.model || "fake/model";
  const prompt = lastUserText(body);
  const slow = /\bslow\b/i.test(prompt);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (/\breason\b/i.test(prompt)) {
    for (const piece of ["Let me think about this. ", "The user wants a demo. ", "I will answer briefly."]) {
      res.write(chunk(id, model, { reasoning: piece }));
      await wait(slow ? 400 : 60);
    }
  }
  const text = replyFor(prompt);
  for (let i = 0; i < text.length; i += 24) {
    if (res.destroyed) return;
    res.write(chunk(id, model, { content: text.slice(i, i + 24) }));
    await wait(slow ? 250 : 15);
  }
  res.write(chunk(id, model, {}, "stop"));
  res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [], usage })}\n\n`);
  res.end("data: [DONE]\n\n");
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname.replace(/^\/api\/v1/, "");
  const send = (status, json) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };

  if (path === "/models" && req.method === "GET") {
    return send(200, { data: [] });
  }
  if (path === "/generation") {
    return send(200, { data: { id: url.searchParams.get("id"), total_cost: usage.cost, tokens_prompt: 120, tokens_completion: 80 } });
  }
  if (path === "/chat/completions" && req.method === "POST") {
    const body = await readJson(req);
    if (/\bfail\b/i.test(lastUserText(body))) return send(500, { error: { message: "Fake provider failure." } });
    if (body.stream) return streamCompletion(res, body);
    const id = `gen-${randomUUID()}`;
    return send(200, {
      id, object: "chat.completion", model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: shortReply(body) }, finish_reason: "stop" }],
      usage
    });
  }
  send(404, { error: { message: `Fake OpenRouter has no ${req.method} ${path}.` } });
}).listen(port, () => console.log(`Fake OpenRouter on http://localhost:${port}/api/v1`));

#!/usr/bin/env node
/* A stand-in Klui backend for exercising the new clients without production
   data. It follows the real wire contract (server/routes/conversations.js,
   server/chat/pipeline.js, server/chat/turnStream.js) closely enough for the
   chat slice, plus the Supabase auth endpoints the clients call.

   Prompts steer it:
     "fail"   rejects the request before a turn starts (HTTP 402)
     "drop"   cuts the connection mid-reply once; the turn keeps running
     "queue"  waits 4s before the model "starts" (stop then withdraws it)
     "long"   writes a long reply
   Any reply is markdown so rendering is exercised too.

   Usage: node devtools/mock-api.mjs [port]   (default 5199) */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] || process.env.PORT || 5199);
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const user = { id: "00000000-0000-4000-8000-000000000001", email: "tester@klui.test", aud: "authenticated", role: "authenticated" };
const conversations = new Map();
const messages = new Map(); // conversationId -> message[]
const turns = new Map(); // turnRunId -> { conversationId, status, userMessageId, chunks, followers, done, abort }
let accessGeneration = 0;

function seed() {
  const id = randomUUID();
  conversations.set(id, { id, title: "Welcome to the rebuild", model: "think", created_at: now(), updated_at: now() });
  const rows = [];
  for (let i = 0; i < 30; i++) {
    rows.push({ id: randomUUID(), conversation_id: id, role: "user", content: `Seeded question ${i + 1}`, created_at: new Date(Date.now() - (60 - i * 2) * 60000).toISOString() });
    rows.push({ id: randomUUID(), conversation_id: id, role: "assistant", content: `Seeded **answer ${i + 1}** with \`code\` and a [link](https://klui.ai).`, model: "mock", finish_reason: "stop", created_at: new Date(Date.now() - (59 - i * 2) * 60000).toISOString() });
  }
  messages.set(id, rows);
}
seed();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function authorized(req) {
  return /^Bearer mock-access-/.test(req.headers.authorization || "");
}

function issueSession() {
  accessGeneration += 1;
  return {
    access_token: `mock-access-${accessGeneration}`,
    refresh_token: `mock-refresh-${accessGeneration}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user
  };
}

function replyFor(text) {
  if (/long/i.test(text)) {
    return Array.from({ length: 12 }, (_, i) => `## Section ${i + 1}\n\nThis is paragraph ${i + 1} of a long reply about *${text}*. It has enough words to wrap across several lines on a phone screen.\n\n- point one\n- point two\n`).join("\n");
  }
  return `Here is a reply to **${text}**.\n\n1. First item\n2. Second item with \`inline code\`\n\n\`\`\`js\nconsole.log("hello from the mock");\n\`\`\`\n\n| Column | Value |\n| --- | --- |\n| a | 1 |\n\nDone.`;
}

function sse(event) {
  return `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`;
}

/* Runs a turn to completion whether or not anyone is listening, recording its
   output so a reconnecting client can replay it (like openTurnStream). */
function startTurn({ conversationId, text, userMessageId, queued }) {
  const id = randomUUID();
  const turn = { id, conversationId, status: "running", userMessageId, chunks: [], followers: new Set(), done: false, aborted: false, started: !queued };
  turns.set(id, turn);
  const write = (chunk) => {
    turn.chunks.push(chunk);
    for (const follower of turn.followers) follower.write(chunk);
  };
  const finish = () => {
    turn.done = true;
    for (const follower of turn.followers) follower.end();
    turn.followers.clear();
  };
  (async () => {
    if (queued) {
      write(sse({ type: "status:step", text: "Waiting for a model…" }));
      await sleep(4000);
      if (turn.aborted) return finish();
      turn.started = true;
    }
    write(sse({ type: "turn:claimed", turnRunId: id }));
    write(sse({ type: "status:step", text: "Reading your message" }));
    await sleep(400);
    const words = replyFor(text).split(/(?<=\s)/);
    let content = "";
    for (const word of words) {
      if (turn.aborted) return finish();
      content += word;
      write(sse({ model: "mock-model", choices: [{ delta: { content: word } }] }));
      await sleep(25);
    }
    write(sse({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: words.length } }));
    const rows = messages.get(conversationId) || [];
    rows.push({ id: randomUUID(), conversation_id: conversationId, role: "assistant", content, model: "mock-model", finish_reason: "stop", turn_run_id: id, output_slot: "single", created_at: now() });
    turn.status = "completed";
    const conversation = conversations.get(conversationId);
    if (conversation) {
      if (conversation.title === "New chat") conversation.title = text.slice(0, 40);
      conversation.updated_at = now();
    }
    write(sse({ type: "turn:done", turnRunId: id }));
    write(sse("[DONE]"));
    finish();
  })();
  return turn;
}

function follow(turn, res, { dropOnce = false } = {}) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "x-klui-turn-run-id": turn.id,
    "x-klui-user-message-id": turn.userMessageId,
    "access-control-expose-headers": "x-klui-turn-run-id, x-klui-user-message-id"
  });
  for (const chunk of turn.chunks) res.write(chunk);
  if (turn.done) return res.end();
  turn.followers.add(res);
  res.on("close", () => turn.followers.delete(res));
  if (dropOnce) {
    setTimeout(() => {
      turn.followers.delete(res);
      res.socket?.destroy();
    }, 900);
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  res.setHeader("access-control-allow-origin", req.headers.origin || "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type, apikey, x-client-info, x-supabase-api-version");
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return send(res, 204);

  /* Supabase auth */
  if (path === "/auth/v1/authorize") {
    const redirect = new URL(url.searchParams.get("redirect_to"));
    redirect.searchParams.set("code", `mock-code-${randomUUID()}`);
    res.writeHead(302, { location: redirect.toString() });
    return res.end();
  }
  if (path === "/auth/v1/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    const body = await readJson(req);
    if (grant === "refresh_token" && !/^mock-refresh-/.test(body.refresh_token || "")) return send(res, 400, { error_description: "Invalid refresh token" });
    if (grant === "pkce" && !body.code_verifier) return send(res, 400, { error_description: "code verifier missing" });
    return send(res, 200, issueSession());
  }
  if (path === "/auth/v1/logout") return send(res, 204);
  if (path === "/auth/v1/user") return send(res, 200, user);

  /* Klui API */
  if (path === "/api/config") {
    return send(res, 200, { supabaseUrl: `http://${req.headers.host}`, supabaseAnonKey: "mock-anon-key", auth: { googleClientId: process.env.MOCK_GOOGLE_CLIENT_ID || "" } });
  }
  if (!path.startsWith("/api/")) return send(res, 404, { error: "Not found." });
  if (!authorized(req)) return send(res, 401, { error: "Sign in to continue." });

  if (path === "/api/me") return send(res, 200, { user, profile: { role: "user" } });

  if (path === "/api/conversations") {
    if (req.method === "GET") {
      const list = [...conversations.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return send(res, 200, { conversations: list });
    }
    if (req.method === "POST") {
      const id = randomUUID();
      const conversation = { id, title: "New chat", model: "think", created_at: now(), updated_at: now() };
      conversations.set(id, conversation);
      messages.set(id, []);
      return send(res, 201, { conversation });
    }
  }

  const match = path.match(/^\/api\/conversations\/([^/]+)(?:\/(messages|turns\/([^/]+)\/cancel))?$/);
  if (match) {
    const [, conversationId, sub, turnId] = match;
    const conversation = conversations.get(conversationId);
    if (!conversation) return send(res, 404, { error: "Conversation not found." });
    const rows = messages.get(conversationId) || [];

    if (!sub && req.method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit") || 20), 100);
      const cursor = url.searchParams.get("cursor");
      const end = cursor ? rows.findIndex((row) => row.id === cursor.split("|")[1]) : rows.length;
      const start = Math.max(0, end - limit);
      const page = rows.slice(start, end);
      const pendingTurns = [...turns.values()].filter((t) => t.conversationId === conversationId && t.status === "running").map((t) => ({ id: t.id, conversation_id: conversationId, status: "running" }));
      return send(res, 200, { conversation, messages: page, pendingTurns, page: { hasMore: start > 0, cursor: start > 0 && page[0] ? `${page[0].created_at}|${page[0].id}` : null } });
    }
    if (!sub && req.method === "PATCH") {
      const body = await readJson(req);
      if (body.title) conversation.title = String(body.title);
      return send(res, 200, { conversation });
    }
    if (!sub && req.method === "DELETE") {
      conversations.delete(conversationId);
      messages.delete(conversationId);
      return send(res, 200, { ok: true });
    }

    if (sub === "messages" && req.method === "POST") {
      const body = await readJson(req);
      if (body.turnRunId) {
        const turn = turns.get(body.turnRunId);
        if (!turn || turn.conversationId !== conversationId) return send(res, 404, { error: "Pending turn not found." });
        return follow(turn, res);
      }
      if (body.retryAssistantMessageId) {
        const index = rows.findIndex((row) => row.id === body.retryAssistantMessageId);
        if (index < 0) return send(res, 404, { error: "Message not found." });
        const prompt = String(rows[index - 1]?.content || "retry");
        rows.splice(index, 1);
        // Retries stream directly, without a durable turn, like the real server.
        res.writeHead(200, { "content-type": "text/event-stream" });
        let content = "";
        for (const word of `Retried: ${replyFor(prompt)}`.split(/(?<=\s)/)) {
          if (res.destroyed) break;
          content += word;
          res.write(sse({ choices: [{ delta: { content: word } }] }));
          await sleep(25);
        }
        rows.splice(index, 0, { id: randomUUID(), conversation_id: conversationId, role: "assistant", content, finish_reason: "stop", created_at: now() });
        res.write(sse("[DONE]"));
        return res.end();
      }
      const text = String(body.text || "").trim();
      if (!text) return send(res, 400, { error: "Message text is required." });
      if (/fail/i.test(text)) return send(res, 402, { error: "Daily limit reached. Try again tomorrow." });
      const userMessage = { id: randomUUID(), conversation_id: conversationId, role: "user", content: text, created_at: now() };
      rows.push(userMessage);
      // Like the real schema, the user row is not stamped with turn_run_id.
      const turn = startTurn({ conversationId, text, userMessageId: userMessage.id, queued: /queue/i.test(text) });
      return follow(turn, res, { dropOnce: /drop/i.test(text) });
    }

    if (turnId && req.method === "POST") {
      const turn = turns.get(turnId);
      if (!turn || turn.conversationId !== conversationId) return send(res, 404, { error: "Pending turn not found." });
      const userMessage = rows.find((row) => row.id === turn.userMessageId);
      if (turn.status === "running") {
        // Mirrors klui_cancel_pending_document_turn: the whole turn is withdrawn.
        turn.status = "cancelled";
        turn.aborted = true;
        messages.set(conversationId, rows.filter((row) => row.id !== turn.userMessageId && row.turn_run_id !== turn.id));
      }
      return send(res, 200, { run: { id: turn.id, conversation_id: conversationId, status: turn.status }, user_message: userMessage, attachments: [] });
    }
  }

  return send(res, 404, { error: "Not found." });
}

createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: "Mock server error." });
  });
}).listen(port, "0.0.0.0", () => console.log(`Mock Klui API on http://localhost:${port}`));

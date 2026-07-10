import crypto from "node:crypto";
import { configuredServices } from "../config.js";
import { HttpError, parseJsonBody, readRawBody, sendJson } from "../http/responses.js";
import { sanitizeResearchPublicView } from "../research/public.js";
import { createCrofaiUsageMeter } from "../saas/usageMeter.js";
import { titleFromText } from "../saas/messages.js";
import {
  OPENROUTER_PRO_MODEL,
  OPENROUTER_TEXT_MODEL,
  resolveProvider
} from "../providers.js";
import { requireChatContext } from "./context.js";

const RESEARCH_MODELS = new Set([OPENROUTER_TEXT_MODEL, OPENROUTER_PRO_MODEL]);

export { sanitizeResearchPublicView };

function publicResearchRun(run, config) {
  const { sourceCount, title, summary } = sanitizeResearchPublicView(run, config);
  return {
    id: run.id,
    conversationId: run.conversation_id,
    messageId: run.assistant_message_id,
    status: run.status,
    phase: run.phase,
    progress: run.progress || {},
    title,
    summary,
    sourceCount,
    elapsedMs: Number(run.elapsed_ms || 0),
    partial: Boolean(run.report_markdown && run.status !== "succeeded"),
    error: run.error || null,
    createdAt: run.created_at,
    finishedAt: run.finished_at || null
  };
}

export async function handleCreateResearch(req, res, config) {
  if (!config.research?.enabled) throw new HttpError(503, "Deep Research is not enabled.");
  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req, 64 * 1024);
  const query = String(body.query || "").trim();
  if (!query) throw new HttpError(400, "Enter a research question.");
  if (query.length > 6000) throw new HttpError(400, "Research question is too long.");
  if (body.temporary || body.compare || body.council || body.hasAttachments) {
    throw new HttpError(400, "Deep Research currently works in a normal text chat only.");
  }
  const active = await context.db.listActiveResearchRuns(context.user.id, { signal: req.signal });
  if (active.length) throw new HttpError(409, "Finish or cancel your active research first.");

  const model = RESEARCH_MODELS.has(body.model) ? body.model : OPENROUTER_TEXT_MODEL;
  const provider = resolveProvider("openrouter", config);
  await createCrofaiUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal: req.signal
  }).checkBudget(req.signal);

  let conversation = null;
  if (body.conversationId) {
    conversation = await context.db.getConversation(context.user.id, String(body.conversationId), { signal: req.signal });
    if (!conversation) throw new HttpError(404, "Conversation not found.");
  } else {
    conversation = await context.db.createConversation(context.user.id, {
      title: titleFromText(query),
      model
    }, { signal: req.signal });
  }

  const userMessage = await context.db.insertMessage({
    user_id: context.user.id,
    conversation_id: conversation.id,
    role: "user",
    model: null,
    content: query,
    reasoning: "",
    tool_calls: [],
    metadata: { research: { mode: "deep" } }
  }, { signal: req.signal });
  const assistantMessage = await context.db.insertMessage({
    user_id: context.user.id,
    conversation_id: conversation.id,
    role: "assistant",
    model,
    content: "",
    reasoning: "",
    tool_calls: [],
    metadata: { research: { status: "queued" } }
  }, { signal: req.signal });
  let run;
  try {
    run = await context.db.createResearchRun({
      user_id: context.user.id,
      conversation_id: conversation.id,
      user_message_id: userMessage.id,
      assistant_message_id: assistantMessage.id,
      query,
      model,
      provider: provider.id,
      progress: { label: "Research queued", percent: 0 }
    }, { signal: req.signal });
  } catch (error) {
    if (body.conversationId) {
      await context.db.deleteMessage(context.user.id, assistantMessage.id, { signal: req.signal }).catch(() => {});
      await context.db.deleteMessage(context.user.id, userMessage.id, { signal: req.signal }).catch(() => {});
    } else {
      await context.db.deleteConversation(context.user.id, conversation.id, { signal: req.signal }).catch(() => {});
    }
    if (error?.status === 409) throw new HttpError(409, "Finish or cancel your active research first.");
    throw error;
  }
  await context.db.updateMessage(context.user.id, assistantMessage.id, {
    metadata: { research: { runId: run.id, status: "queued" } }
  }, { signal: req.signal });
  await context.db.updateConversation(context.user.id, conversation.id, {
    title: conversation.title === "New chat" ? titleFromText(query) : conversation.title,
    model
  }, { signal: req.signal });

  sendJson(res, 202, {
    run: publicResearchRun(run, config),
    conversation,
    userMessage,
    assistantMessage: {
      ...assistantMessage,
      metadata: { research: { runId: run.id, status: "queued" } }
    }
  });
}

export async function handleResearchStatus(req, res, config, runId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const run = await context.db.getResearchRun(context.user.id, runId, { signal: req.signal });
  if (!run) throw new HttpError(404, "Research run not found.");
  sendJson(res, 200, { run: publicResearchRun(run, config) });
}

export async function handleCancelResearch(req, res, config, runId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const run = await context.db.getResearchRun(context.user.id, runId, { signal: req.signal });
  if (!run) throw new HttpError(404, "Research run not found.");
  if (!["queued", "running"].includes(run.status)) {
    sendJson(res, 200, { run: publicResearchRun(run, config) });
    return;
  }
  const patch = run.status === "queued"
    ? { status: "cancelled", phase: "cancelled", cancel_requested: true, finished_at: new Date().toISOString() }
    : { cancel_requested: true, progress: { ...(run.progress || {}), label: "Cancelling research" } };
  let updated = await context.db.updateResearchRun(run.id, patch, {
    userId: context.user.id,
    status: run.status === "queued" ? "queued" : "running",
    signal: req.signal
  });
  if (!updated) {
    updated = await context.db.updateResearchRun(run.id, {
      cancel_requested: true,
      progress: { ...(run.progress || {}), label: "Cancelling research" }
    }, { userId: context.user.id, signal: req.signal });
  }
  if (updated?.status === "cancelled" && run.assistant_message_id) {
    await context.db.updateMessage(context.user.id, run.assistant_message_id, {
      error: "Research cancelled.",
      finish_reason: "cancelled",
      metadata: { research: { runId: run.id, status: "cancelled" } }
    }, { signal: req.signal });
  }
  sendJson(res, 200, { run: publicResearchRun(updated, config) });
}

export async function handleResearchReport(req, res, config, runId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const run = await context.db.getResearchRun(context.user.id, runId, { signal: req.signal });
  if (!run) throw new HttpError(404, "Research run not found.");
  if (!run.report_markdown) throw new HttpError(409, "Research report is not ready.");
  const { sources, report } = sanitizeResearchPublicView(run, config);
  const payload = {
    run: publicResearchRun(run, config),
    report,
    sources
  };
  const json = JSON.stringify(payload);
  const etag = `"${crypto.createHash("sha256").update(json).digest("base64url")}"`;
  res.setHeader("etag", etag);
  res.setHeader("cache-control", "private, max-age=300");
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

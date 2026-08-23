import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { contentText } from "../saas/messages/content.js";
import { clearAdminSummaryCache } from "./admin.js";
import { authContext, requireAdminContext } from "./context.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function publicReport(row) {
  return {
    id: row?.id,
    email: row?.reporter_email || "",
    snippet: row?.snippet || "",
    status: row?.status || "open",
    createdAt: row?.created_at || null,
    resolvedAt: row?.resolved_at || null
  };
}

function reportSnippet(content) {
  const text = contentText(content).replace(/\s+/g, " ").trim();
  if (!text) return "(no text)";
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

export async function handleCreateReport(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await authContext(req, config);
  const body = await parseJsonBody(req, 16 * 1024);
  const messageId = String(body.messageId || "").trim();
  if (!UUID_RE.test(messageId)) throw new HttpError(400, "Message was not found.");

  const existing = await context.db.getOpenContentReport(context.user.id, messageId, { signal: req.signal });
  if (existing) {
    sendJson(res, 200, { report: publicReport(existing) });
    return;
  }

  const message = await context.db.getMessage(context.user.id, messageId, { signal: req.signal });
  if (!message) throw new HttpError(404, "Message was not found.");

  const row = await context.db.createContentReport({
    reporter_id: context.user.id,
    reporter_email: context.user.email || "",
    message_id: message.id,
    conversation_id: message.conversation_id || null,
    snippet: reportSnippet(message.content),
    status: "open"
  }, { signal: req.signal });

  clearAdminSummaryCache();
  sendJson(res, 200, { report: publicReport(row) });
}

export async function handleAdminResolveReport(req, res, config, id) {
  const context = await requireAdminContext(req, config);
  const report = await context.db.getContentReport(id, { signal: req.signal });
  if (!report) throw new HttpError(404, "Report was not found.");
  if (report.status === "done") {
    sendJson(res, 200, { report: publicReport(report) });
    return;
  }

  const resolved = await context.db.resolveContentReport(id, context.user.id, { signal: req.signal });
  clearAdminSummaryCache();
  sendJson(res, 200, { report: publicReport(resolved) });
}

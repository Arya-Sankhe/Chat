import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { resolveChatRole } from "../models.js";
import { hydrateMessagesForClient } from "../saas/messages.js";
import { requireChatContext } from "./context.js";
import { attachmentStorageKeys } from "./uploads.js";

const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Message pages carry their cursor on the wire as "<created_at>|<id>". */
function parseMessageCursor(value) {
  const parts = String(value || "").split("|");
  if (parts.length !== 2) return null;
  const [createdAt, id] = parts;
  // Both halves are interpolated into the row filter, so check their shape first.
  if (!CURSOR_TIMESTAMP.test(createdAt || "") || !Number.isFinite(Date.parse(createdAt)) || !CURSOR_ID.test(id || "")) return null;
  return { createdAt, id };
}

function formatMessageCursor(cursor) {
  return cursor ? `${cursor.createdAt}|${cursor.id}` : null;
}

export async function purgeMessageStorage(context, messageId, config, signal) {
  const attachments = await context.db.listMessageAttachments(context.user.id, messageId, { signal });
  const keys = [];
  for (const attachment of attachments) {
    keys.push(...await attachmentStorageKeys(context, attachment, config, signal));
  }
  if (keys.length) await context.r2.deleteObjects(keys, { signal });
  const message = await context.db.deleteMessage(context.user.id, messageId, { signal });
  if (keys.length) await context.r2.deleteObjects(keys, { signal });
  return { message, attachmentCount: attachments.length };
}

export async function handleConversations(req, res, config) {
  const context = await requireChatContext(req, config);
  if (req.method === "GET") {
    const conversations = await context.db.listConversations(context.user.id, { signal: req.signal });
    sendJson(res, 200, { conversations });
    return;
  }

  if (req.method === "POST") {
    const body = await parseJsonBody(req);
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (projectId && !await context.db.getProject(context.user.id, projectId, { signal: req.signal })) {
      throw new HttpError(404, "Project not found.");
    }
    const routed = resolveChatRole({ role: body.role, model: body.model });
    const conversation = await context.db.createConversation(context.user.id, {
      title: body.title || "New chat",
      model: routed.role || routed.models[0] || "",
      projectId: projectId || null
    }, { signal: req.signal });
    sendJson(res, 201, { conversation });
    return;
  }

  throw new HttpError(405, "Method not allowed.");
}

export async function handleConversationSearch(req, res, config) {
  const context = await requireChatContext(req, config);
  if (req.method === "GET") {
    const q = String(new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).searchParams.get("q") || "").trim().slice(0, 200);
    if (q.length < 2) {
      sendJson(res, 200, { results: [] });
      return;
    }
    const results = await context.db.searchMessages(context.user.id, q, { signal: req.signal, limit: 30 });
    sendJson(res, 200, { results });
    return;
  }

  throw new HttpError(405, "Method not allowed.");
}

export async function handleConversationById(req, res, config, conversationId) {
  const context = await requireChatContext(req, config);

  if (req.method === "GET") {
    const includeReasoning = context.profile?.role === "admin";
    const params = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).searchParams;
    const [conversation, page, pendingTurns] = await Promise.all([
      context.db.getConversation(context.user.id, conversationId, { signal: req.signal }),
      context.db.listMessagesPage(context.user.id, conversationId, {
        signal: req.signal,
        includeReasoning,
        limit: params.get("limit"),
        cursor: parseMessageCursor(params.get("cursor"))
      }),
      context.db.listPendingDocumentTurns(context.user.id, conversationId, { signal: req.signal })
    ]);
    if (!conversation) throw new HttpError(404, "Conversation not found.");
    sendJson(res, 200, {
      conversation,
      messages: await hydrateMessagesForClient(page.messages, context.r2, { includeReasoning }),
      pendingTurns,
      page: { hasMore: page.hasMore, cursor: formatMessageCursor(page.cursor) }
    });
    return;
  }

  const conversation = await context.db.getConversation(context.user.id, conversationId, { signal: req.signal });
  if (!conversation) throw new HttpError(404, "Conversation not found.");

  if (req.method === "PATCH") {
    const body = await parseJsonBody(req);
    const patch = {};
    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) throw new HttpError(400, "Title is required.");
      patch.title = title;
    }
    if (body.projectId !== undefined) {
      const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
      if (projectId && !await context.db.getProject(context.user.id, projectId, { signal: req.signal })) {
        throw new HttpError(404, "Project not found.");
      }
      patch.project_id = projectId || null;
    }
    if (!Object.keys(patch).length) throw new HttpError(400, "No conversation changes were provided.");
    const updated = await context.db.updateConversation(context.user.id, conversation.id, patch, { signal: req.signal });
    sendJson(res, 200, { conversation: updated });
    return;
  }

  if (req.method === "DELETE") {
    const attachments = await context.db.listConversationAttachments(context.user.id, conversation.id, { signal: req.signal });
    const keys = [];
    for (const attachment of attachments) {
      keys.push(...await attachmentStorageKeys(context, attachment, config, req.signal));
    }
    await context.r2.deleteObjects(keys, { signal: req.signal });
    await context.db.deleteConversation(context.user.id, conversation.id, { signal: req.signal });
    await context.r2.deleteObjects(keys, { signal: req.signal });
    sendJson(res, 200, { deleted: true, deletedImages: attachments.length });
    return;
  }

  throw new HttpError(405, "Method not allowed.");
}

export async function handleMessageById(req, res, config, messageId) {
  if (req.method !== "DELETE") throw new HttpError(405, "Method not allowed.");

  const context = await requireChatContext(req, config);
  const { message, attachmentCount } = await purgeMessageStorage(context, messageId, config, req.signal);
  if (!message) throw new HttpError(404, "Message not found.");

  sendJson(res, 200, { deleted: true, deletedImages: attachmentCount });
}

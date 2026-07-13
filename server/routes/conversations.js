import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { hydrateMessagesForClient } from "../saas/messages.js";
import { requireChatContext } from "./context.js";
import { attachmentStorageKeys } from "./uploads.js";

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
    const conversation = await context.db.createConversation(context.user.id, {
      title: body.title || "New chat",
      model: body.model || "",
      projectId: projectId || null
    }, { signal: req.signal });
    sendJson(res, 201, { conversation });
    return;
  }

  throw new HttpError(405, "Method not allowed.");
}

export async function handleConversationById(req, res, config, conversationId) {
  const context = await requireChatContext(req, config);
  const conversation = await context.db.getConversation(context.user.id, conversationId, { signal: req.signal });
  if (!conversation) throw new HttpError(404, "Conversation not found.");

  if (req.method === "GET") {
    const messages = await context.db.listMessages(context.user.id, conversation.id, { signal: req.signal });
    const pendingTurns = await context.db.listPendingDocumentTurns(
      context.user.id,
      conversation.id,
      { signal: req.signal }
    );
    const includeReasoning = context.profile?.role === "admin";
    sendJson(res, 200, {
      conversation,
      messages: await hydrateMessagesForClient(messages, context.r2, { includeReasoning }),
      pendingTurns
    });
    return;
  }

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

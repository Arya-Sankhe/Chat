import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { requireChatContext } from "./context.js";
import { attachmentStorageKeys } from "./uploads.js";

function cleanName(value) {
  const name = String(value || "").trim();
  if (!name) throw new HttpError(400, "Project name is required.");
  if (name.length > 80) throw new HttpError(400, "Project name is too long.");
  return name;
}

function projectUsage(attachments, maxBytes) {
  const usedBytes = attachments
    .filter((attachment) => attachment.status === "uploaded")
    .reduce((sum, attachment) => sum + Math.max(0, Number(attachment.size_bytes || 0)), 0);
  return {
    usedBytes,
    maxBytes,
    percent: maxBytes > 0 ? Math.min(100, Math.round((usedBytes / maxBytes) * 1000) / 10) : 0
  };
}

export async function handleProjects(req, res, config) {
  const context = await requireChatContext(req, config);
  if (req.method === "GET") {
    const projects = await context.db.listProjects(context.user.id, { signal: req.signal });
    sendJson(res, 200, { projects });
    return;
  }
  if (req.method === "POST") {
    const body = await parseJsonBody(req);
    const project = await context.db.createProject(context.user.id, cleanName(body.name), { signal: req.signal });
    sendJson(res, 201, { project });
    return;
  }
  throw new HttpError(405, "Method not allowed.");
}

export async function handleProjectById(req, res, config, projectId) {
  const context = await requireChatContext(req, config);
  const project = await context.db.getProject(context.user.id, projectId, { signal: req.signal });
  if (!project) throw new HttpError(404, "Project not found.");

  if (req.method === "GET") {
    const [attachments, documents, conversations] = await Promise.all([
      context.db.listProjectAttachments(context.user.id, project.id, { signal: req.signal }),
      context.db.listProjectDocuments(context.user.id, project.id, { signal: req.signal }),
      context.db.listProjectConversations(context.user.id, project.id, { signal: req.signal })
    ]);
    sendJson(res, 200, {
      project,
      usage: projectUsage(attachments, context.plan.maxProjectBytes),
      documents,
      conversations
    });
    return;
  }

  if (req.method === "PATCH") {
    const body = await parseJsonBody(req);
    const patch = {};
    if (body.name !== undefined) patch.name = cleanName(body.name);
    if (body.instructions !== undefined) {
      const instructions = String(body.instructions || "").trim();
      if (instructions.length > 10_000) throw new HttpError(400, "Project instructions are too long.");
      patch.instructions = instructions;
    }
    if (!Object.keys(patch).length) throw new HttpError(400, "No project changes were provided.");
    const updated = await context.db.updateProject(context.user.id, project.id, patch, { signal: req.signal });
    sendJson(res, 200, { project: updated });
    return;
  }

  if (req.method === "DELETE") {
    const conversations = await context.db.listProjectConversations(context.user.id, project.id, { signal: req.signal });
    const attachments = await context.db.listProjectAttachments(context.user.id, project.id, { signal: req.signal });
    for (const conversation of conversations) {
      attachments.push(...await context.db.listConversationAttachments(
        context.user.id,
        conversation.id,
        { signal: req.signal }
      ));
    }
    const keys = [];
    for (const attachment of attachments) {
      keys.push(...await attachmentStorageKeys(context, attachment, config, req.signal));
    }
    if (keys.length) await context.r2.deleteObjects(keys, { signal: req.signal });
    await context.db.deleteProject(context.user.id, project.id, { signal: req.signal });
    sendJson(res, 200, { deleted: true });
    return;
  }

  throw new HttpError(405, "Method not allowed.");
}

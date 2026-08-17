import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { requireChatContext } from "./context.js";
import { attachmentStorageKeys } from "./uploads.js";

const DEADLINE_TYPES = new Set(["exam", "assignment", "other"]);

function cleanName(value) {
  const name = String(value || "").trim();
  if (!name) throw new HttpError(400, "Project name is required.");
  if (name.length > 80) throw new HttpError(400, "Project name is too long.");
  return name;
}

function cleanKind(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const kind = String(value).trim();
  if (kind !== "project" && kind !== "course") {
    throw new HttpError(400, "Project kind must be project or course.");
  }
  return kind;
}

function cleanDeadline(entry) {
  if (!entry || typeof entry !== "object") throw new HttpError(400, "Invalid deadline.");
  const title = String(entry.title || "").trim();
  const date = String(entry.date || "").trim();
  const type = String(entry.type || "").trim();
  if (!title) throw new HttpError(400, "Deadline title is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Deadline date must be YYYY-MM-DD.");
  if (!DEADLINE_TYPES.has(type)) throw new HttpError(400, "Deadline type must be exam, assignment, or other.");
  return { title, date, type };
}

function cleanMeta(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Project meta must be an object.");
  }
  const meta = {};
  if (value.term !== undefined) meta.term = String(value.term || "").trim();
  if (value.topics !== undefined) {
    if (!Array.isArray(value.topics)) throw new HttpError(400, "topics must be an array.");
    meta.topics = value.topics.map((topic) => String(topic || "").trim()).filter(Boolean).slice(0, 100);
  }
  if (value.deadlines !== undefined) {
    if (!Array.isArray(value.deadlines)) throw new HttpError(400, "deadlines must be an array.");
    if (value.deadlines.length > 100) throw new HttpError(400, "Too many deadlines.");
    meta.deadlines = value.deadlines.map(cleanDeadline);
  }
  return meta;
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
    const project = await context.db.createProject(context.user.id, cleanName(body.name), {
      kind: cleanKind(body.kind),
      meta: cleanMeta(body.meta),
      signal: req.signal
    });
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
    if (body.meta !== undefined) {
      const meta = cleanMeta(body.meta);
      patch.meta = meta === null ? null : { ...(project.meta && typeof project.meta === "object" ? project.meta : {}), ...meta };
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

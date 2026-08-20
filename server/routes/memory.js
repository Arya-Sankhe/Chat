import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { normalizeUserMemory, USER_MEMORY_MAX_CHARS } from "../saas/userMemory.js";
import { authContext } from "./context.js";

function publicMemory(row) {
  return {
    enabled: Boolean(row?.enabled),
    content: String(row?.content || ""),
    updatedAt: row?.updated_at || null
  };
}

export async function handleMemory(req, res, config) {
  const context = await authContext(req, config);
  const current = await context.db.getUserMemory(context.user.id, { signal: req.signal });
  if (req.method === "GET") {
    sendJson(res, 200, { memory: publicMemory(current) });
    return;
  }

  const now = new Date().toISOString();
  if (req.method === "DELETE") {
    const row = current
      ? await context.db.updateUserMemory(context.user.id, Number(current.version || 0), {
          content: "",
          last_dreamed_at: now
        }, { signal: req.signal })
      : null;
    if (current && !row) throw new HttpError(409, "Memory changed in another session. Please try again.");
    sendJson(res, 200, { memory: publicMemory(row || current) });
    return;
  }

  if (req.method !== "PATCH") throw new HttpError(405, "Method not allowed.");
  const body = await parseJsonBody(req, 12 * 1024);
  const patch = {};
  if (typeof body.enabled === "boolean" && body.enabled !== Boolean(current?.enabled)) {
    patch.enabled = body.enabled;
    if (body.enabled) {
      patch.enabled_at = now;
      patch.last_dreamed_at = now;
    }
  }
  if (Object.hasOwn(body, "content")) {
    if (typeof body.content !== "string" || body.content.length > USER_MEMORY_MAX_CHARS) {
      throw new HttpError(400, `Memory must be ${USER_MEMORY_MAX_CHARS} characters or fewer.`);
    }
    patch.content = normalizeUserMemory(body.content);
    patch.last_dreamed_at = now;
  }
  if (!Object.keys(patch).length) {
    sendJson(res, 200, { memory: publicMemory(current) });
    return;
  }
  const row = current
    ? await context.db.updateUserMemory(context.user.id, Number(current.version || 0), patch, { signal: req.signal })
    : await context.db.upsertUserMemory({
        user_id: context.user.id,
        enabled: Boolean(patch.enabled),
        content: patch.content || "",
        enabled_at: patch.enabled_at || null,
        last_dreamed_at: patch.last_dreamed_at || null
      }, { signal: req.signal });
  if (!row) throw new HttpError(409, "Memory changed in another session. Please try again.");
  sendJson(res, 200, { memory: publicMemory(row) });
}

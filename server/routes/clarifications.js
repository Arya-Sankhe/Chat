import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { generateClarifications } from "../saas/clarifications.js";
import { createCrofaiUsageMeter } from "../saas/usageMeter.js";
import { requireChatContext } from "./context.js";

export async function handleClarifications(req, res, config) {
  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req, 16 * 1024);
  const query = String(body.query || "").trim();
  if (!query) throw new HttpError(400, "Enter a question.");
  if (query.length > 6000) throw new HttpError(400, "Question is too long.");

  const questions = await generateClarifications({
    query,
    config,
    signal: req.signal,
    crofai: createCrofaiUsageMeter({
      db: context.db,
      userId: context.user.id,
      subscription: context.subscription,
      plan: context.plan,
      signal: req.signal
    })
  });
  sendJson(res, 200, { questions });
}

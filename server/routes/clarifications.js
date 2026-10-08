import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { researchConversationContext } from "../research/context.js";
import { generateClarifications } from "../saas/clarifications.js";
import { createModelUsageMeter } from "../saas/usageMeter.js";
import { requireChatContext } from "./context.js";

export async function handleClarifications(req, res, config) {
  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req, 16 * 1024);
  const query = String(body.query || "").trim();
  if (!query) throw new HttpError(400, "Enter a question.");
  if (query.length > 6000) throw new HttpError(400, "Question is too long.");

  const conversationId = typeof body.conversationId === "string" && /^[0-9a-f-]{36}$/i.test(body.conversationId.trim())
    ? body.conversationId.trim()
    : "";
  // listMessages is scoped to the signed-in user, so a foreign id just yields no context.
  const conversation = conversationId
    ? researchConversationContext(
      await context.db.listMessages(context.user.id, conversationId, { signal: req.signal }).catch(() => []),
      { maxChars: 12_000, maxMessageChars: 3_000, maxMessages: 10 }
    )
    : "";

  const questions = await generateClarifications({
    query,
    conversation,
    config,
    signal: req.signal,
    modelClient: createModelUsageMeter({
      db: context.db,
      userId: context.user.id,
      subscription: context.subscription,
      plan: context.plan,
      signal: req.signal,
      meteringMode: config.desktop.meteringMode,
      reservationCredits: config.desktop.chatReservationCredits
    })
  });
  sendJson(res, 200, { questions });
}

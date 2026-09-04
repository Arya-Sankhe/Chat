import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { OPENROUTER_TEXT_MODEL, resolveProvider } from "../providers.js";
import { createCrofaiUsageMeter } from "../saas/usageMeter.js";
import { requireChatContext } from "../routes/context.js";

const DRAFT_MAX = 24_000;
const INSTRUCTION_MAX = 4_000;
// Full draft rewrites must not be truncated.
const MAX_COMPLETION_TOKENS = 100_000;
const TIMEOUT_MS = 10 * 60 * 1000;

function emailSourceFromModel(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```email[ \t]*\r?\n([\s\S]*?)\r?\n```/i)
    || trimmed.match(/```email[ \t]*\r?\n([\s\S]+)$/i);
  if (fenced) return fenced[1].trim();
  return trimmed.replace(/^```(?:email)?\s*|\s*```$/gi, "").trim();
}

function replaceEmailFence(content, source) {
  const fence = `\`\`\`email\n${source}\n\`\`\``;
  const swap = (text) => (/```email\b/i.test(text)
    ? String(text).replace(/```email[ \t]*\r?\n[\s\S]*?(?:\r?\n```|$)/i, fence)
    : `${text}\n\n${fence}`);
  if (Array.isArray(content)) {
    const textParts = content.map((part, index) => part?.type === "text" ? index : -1).filter((index) => index >= 0);
    const target = textParts.find((index) => /```email\b/i.test(content[index].text || "")) ?? textParts[0];
    return content.map((part, index) => index === target ? { ...part, text: swap(part.text || "") } : part);
  }
  return swap(String(content || ""));
}

export async function handleEmailRevise(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req, 64 * 1024);
  const draft = String(body.draft || "").trim();
  const instruction = String(body.instruction || "").trim();
  const messageId = String(body.messageId || "").trim();
  if (!draft) throw new HttpError(400, "Email draft cannot be empty.");
  if (!instruction) throw new HttpError(400, "Describe the changes you want.");
  if (draft.length > DRAFT_MAX) throw new HttpError(413, "Email is too large to revise in place.");
  if (instruction.length > INSTRUCTION_MAX) throw new HttpError(413, "Change request is too long.");

  const provider = resolveProvider("openrouter", config);
  const meter = createCrofaiUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal: req.signal,
    meteringMode: config.desktop.meteringMode,
    reservationCredits: config.desktop.chatReservationCredits
  });
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]);
  let content;
  try {
    content = await meter.chatCompletion({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      providerId: provider.id,
      signal,
      body: {
        model: OPENROUTER_TEXT_MODEL,
        temperature: 0.2,
        max_tokens: MAX_COMPLETION_TOKENS,
        messages: [
          {
            role: "system",
            content: "You revise an email draft. Return ONLY a fenced email block (triple backticks + email) with To: and Subject: lines first, then the full body. No preface or tips. Keep the email complete: greeting, every needed paragraph, and a sign-off. If the user asks you to invent a reason or missing detail, pick a concrete one and write it in — do not leave it as a placeholder or drop the rest of the email. Follow the instruction."
          },
          {
            role: "user",
            content: `Instruction:\n${instruction}\n\nCurrent draft:\n${draft}`
          }
        ]
      }
    });
  } catch (error) {
    if (signal.aborted && !req.signal.aborted) throw new HttpError(504, "Email revision timed out. Try again.");
    throw error;
  }

  const source = emailSourceFromModel(content);
  if (!source) throw new HttpError(502, "The model returned an empty revision.");

  if (messageId) {
    const message = await context.db.getMessage(context.user.id, messageId, { signal: req.signal }).catch(() => null);
    if (message?.role === "assistant" && /```email\b/i.test(emailText(message.content))) {
      await context.db.updateMessage(context.user.id, messageId, {
        content: replaceEmailFence(message.content, source)
      }, { signal: req.signal });
    }
  }

  sendJson(res, 200, { source });
}

function emailText(content) {
  return Array.isArray(content)
    ? content.filter((part) => part?.type === "text").map((part) => part.text || "").join("\n")
    : String(content || "");
}

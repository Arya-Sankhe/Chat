import { normalizeChatRequest } from "../crofai/normalize.js";
import { configuredServices } from "../config.js";
import { HttpError, parseJsonBody } from "../http/responses.js";
import {
  buildProviderMessages,
  buildStoredUserContent,
  contentText,
  createConversationSummarizer,
  normalizeMessageSettings,
  sanitizeProviderEvent
} from "../saas/messages.js";
import { loadGlobalSystemPrompt } from "../saas/systemPrompt.js";
import { createCrofaiUsageMeter } from "../saas/usageMeter.js";
import { buildSearchSystemHint, detectSearchNeed } from "../websearch/detect.js";
import { runChatWithToolLoop } from "../websearch/tool.js";
import { OPENROUTER_TEXT_MODEL, resolveProvider } from "../providers.js";
import { requireChatContext } from "../routes/context.js";
import { requireServerCrofKey } from "../routes/meta.js";
import {
  buildMeteredWebsearch,
  normalizeAgentMode,
  normalizeCouncilFlag,
  resolveWebSearchMode,
  withAvailableTools
} from "./pipeline.js";
import { hasAssistantOutput, writeSse } from "./shared.js";
import { streamSingleChat } from "./single.js";

function normalizeTemporaryHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-20)
    .map((message) => {
      const role = message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : "";
      const content = typeof message?.content === "string" ? message.content.trim() : "";
      if (!role || !content) return null;
      return { role, content: content.slice(0, 100000) };
    })
    .filter(Boolean);
}

export async function handleTemporaryChat(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  requireServerCrofKey(config);

  const context = await requireChatContext(req, config);
  const includeReasoning = context.profile?.role === "admin";
  const body = await parseJsonBody(req, 1024 * 1024);
  if (Array.isArray(body.attachments) && body.attachments.length) {
    throw new HttpError(400, "Temporary chat does not support attachments yet.");
  }
  if (Array.isArray(body.models) && body.models.length) {
    throw new HttpError(400, "Temporary chat does not support compare or council mode yet.");
  }
  if (normalizeCouncilFlag(body.council)) {
    throw new HttpError(400, "Temporary chat does not support council mode yet.");
  }

  const settings = normalizeMessageSettings(body);
  settings.systemPrompt = await loadGlobalSystemPrompt(context.db, { signal: req.signal });
  const userContent = buildStoredUserContent(body.text, []);
  const promptText = contentText(userContent);
  const historyMessages = [
    ...normalizeTemporaryHistory(body.messages),
    { role: "user", content: userContent }
  ];
  const provider = resolveProvider(body.provider, config);
  const crofai = createCrofaiUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    imageCount: 0,
    signal: req.signal
  });
  const summarizeHistory = createConversationSummarizer({
    crofai,
    config,
    signal: req.signal
  });
  const baseChatRequest = normalizeChatRequest({
    model: body.model || OPENROUTER_TEXT_MODEL,
    messages: await buildProviderMessages({
      messages: historyMessages,
      systemPrompt: settings.systemPrompt || "",
      r2: context.r2,
      contextConfig: config.context,
      summarizeHistory
    }),
    ...settings
  });
  const agentMode = normalizeAgentMode(body.agentMode);
  const websearch = buildMeteredWebsearch({ config, context, signal: req.signal });
  const webSearchMode = agentMode ? resolveWebSearchMode({ body, config, websearch }) : "off";
  const detection = webSearchMode !== "off"
    ? detectSearchNeed(promptText)
    : { score: 0, reasons: [], hasUrls: false, urls: [] };
  const hint = webSearchMode !== "off" ? buildSearchSystemHint(detection) : "";
  const toolSetup = agentMode
    ? withAvailableTools(baseChatRequest, {
        config,
        webMode: webSearchMode,
        webHint: hint,
        readyDocuments: [],
        documentSkills: null
      })
    : { request: baseChatRequest, augmented: false };
  const chatRequest = toolSetup.request;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-klui-temporary-chat": "1"
    });
    const { accumulated } = toolSetup.augmented
      ? await runChatWithToolLoop({
          chatRequest,
          crofai,
          config,
          provider,
          signal: controller.signal,
          websearch,
          documents: null,
          visualDocuments: false,
          onUpstreamEvent: (event) => {
            res.write(`data: ${JSON.stringify(sanitizeProviderEvent(event, { includeReasoning }))}\n\n`);
          },
          onToolEvent: (event) => { writeSse(res, event); }
        })
      : await streamSingleChat({
          chatRequest,
          crofai,
          config,
          provider,
          signal: controller.signal,
          res,
          includeReasoning
        });
    if (!hasAssistantOutput(accumulated)) {
      throw new HttpError(502, "Klui returned an empty response.");
    }
    if (accumulated.usage) {
      writeSse(res, { type: "usage", usage: accumulated.usage });
    }
    writeSse(res, { type: "done", temporary: true });
    res.end();
  } catch (error) {
    const message = error?.name === "AbortError" ? "Stopped by user." : error?.message || "Model request failed.";
    if (res.headersSent) {
      writeSse(res, { type: "error", error: message });
      res.end();
      return;
    }
    throw error;
  }
}

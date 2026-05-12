import { listModels, streamChatCompletion } from "./crofai/client.js";
import { normalizeBaseUrl } from "./crofai/constants.js";
import { extractApiKey, normalizeChatRequest } from "./crofai/normalize.js";
import { HttpError, parseJsonBody, sendJson, sendProblem } from "./http/responses.js";

export async function handleApiRequest(req, res, url, config) {
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        app: "crofchat",
        serverApiKeyConfigured: Boolean(config.serverApiKey)
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      sendJson(res, 200, {
        defaultBaseUrl: config.defaultBaseUrl,
        allowedBaseUrls: config.allowedBaseUrls,
        serverApiKeyConfigured: Boolean(config.serverApiKey)
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/models") {
      const baseUrl = normalizeBaseUrl(url.searchParams.get("baseUrl") || config.defaultBaseUrl);
      const apiKey = extractApiKey(req.headers, config.serverApiKey);
      const models = await listModels({ apiKey, baseUrl, signal: req.signal });
      sendJson(res, 200, models);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await parseJsonBody(req);
      const baseUrl = normalizeBaseUrl(body.baseUrl || config.defaultBaseUrl);
      const apiKey = extractApiKey(req.headers, config.serverApiKey);

      if (!apiKey) {
        throw new HttpError(401, "Add a CrofAI API key in settings or set CROFAI_API_KEY on the server.");
      }

      const chatRequest = normalizeChatRequest(body);
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });

      const upstream = await streamChatCompletion({
        apiKey,
        baseUrl,
        body: chatRequest,
        signal: controller.signal
      });

      if (!upstream.body) {
        throw new HttpError(502, "CrofAI returned an empty response stream.");
      }

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });

      const reader = upstream.body.getReader();
      while (!res.destroyed) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
      return;
    }

    throw new HttpError(404, "API route not found.");
  } catch (error) {
    sendProblem(res, error);
  }
}

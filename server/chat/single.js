import { HttpError } from "../http/responses.js";
import { pipeProviderStreamAndAccumulate } from "../saas/messages.js";

export async function streamSingleChat({ chatRequest, crofai, config, provider, signal, res, includeReasoning = false }) {
  const upstream = await crofai.streamChatCompletion({
    apiKey: provider?.apiKey || config.serverApiKey,
    baseUrl: provider?.baseUrl || config.defaultBaseUrl,
    body: chatRequest,
    providerId: provider?.id,
    signal
  });
  if (!upstream.body) throw new HttpError(502, `${provider?.label || "Klui"} returned an empty response stream.`);
  const accumulated = await pipeProviderStreamAndAccumulate(upstream, res, { includeReasoning });
  return { accumulated, citations: [], providers: [], toolCallCount: 0 };
}

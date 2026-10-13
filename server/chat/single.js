import { HttpError } from "../http/responses.js";
import { pipeProviderStreamAndAccumulate } from "../saas/messages.js";
import { createThoughtTicker } from "./thoughtTicker.js";

export async function streamSingleChat({ chatRequest, modelClient, provider, signal, res, includeReasoning = false }) {
  const upstream = await modelClient.streamChatCompletion({
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    body: chatRequest,
    providerId: provider?.id,
    signal
  });
  if (!upstream.body) throw new HttpError(502, `${provider.label} returned an empty response stream.`);
  const onEvent = createThoughtTicker((event) => {
    if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const accumulated = await pipeProviderStreamAndAccumulate(upstream, res, { includeReasoning, onEvent });
  return { accumulated, citations: [], providers: [], toolCallCount: 0 };
}

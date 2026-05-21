import { chatCompletion, streamChatCompletion } from "../crofai/client.js";
import { consumeUsageOrThrow } from "./entitlements.js";

function modelFromBody(body = {}) {
  return typeof body.model === "string" ? body.model : "";
}

/**
 * Meters each outbound CrofAI chat-completion request one-for-one.
 * The monthly image count is charged exactly once, on the first model call
 * for the user prompt, while message usage is charged before every CrofAI
 * request attempt.
 */
export function createCrofaiUsageMeter({
  db,
  userId,
  subscription,
  plan,
  imageCount = 0,
  signal,
  chatCompletionFn = chatCompletion,
  streamChatCompletionFn = streamChatCompletion
}) {
  let pendingImageCount = Math.max(0, Number(imageCount) || 0);
  let imageChargePromise = null;

  async function consumeModelCall(model, callSignal = signal) {
    const modelId = typeof model === "string" ? model : "";
    const consume = (imagesForCall) => consumeUsageOrThrow({
      db,
      userId,
      subscription,
      plan,
      imageCount: imagesForCall,
      messageCount: 1,
      models: [modelId],
      signal: callSignal
    });

    if (pendingImageCount > 0) {
      if (!imageChargePromise) {
        const imagesForCall = pendingImageCount;
        pendingImageCount = 0;
        imageChargePromise = consume(imagesForCall);
        await imageChargePromise;
        return;
      }

      await imageChargePromise;
    }

    await consume(0);
  }

  return {
    consumeModelCall,

    async chatCompletion(params) {
      await consumeModelCall(modelFromBody(params?.body), params?.signal);
      return chatCompletionFn(params);
    },

    async streamChatCompletion(params) {
      await consumeModelCall(modelFromBody(params?.body), params?.signal);
      return streamChatCompletionFn(params);
    }
  };
}

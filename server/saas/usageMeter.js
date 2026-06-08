import { chatCompletion, streamChatCompletion } from "../crofai/client.js";
import {
  assertApiBudgetAvailable,
  apiUsageWindow,
  estimateOpenRouterCostCredits,
  fetchOpenRouterGenerationCost,
  usageCostCredits
} from "./billing.js";

function modelFromBody(body = {}) {
  return typeof body.model === "string" ? body.model : "";
}

function parseSseEvents(buffer, onEvent) {
  const events = buffer.split("\n\n");
  const remaining = events.pop() || "";

  for (const event of events) {
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");

    if (!data || data === "[DONE]") continue;
    try {
      onEvent(JSON.parse(data));
    } catch {
      // Keep streaming even if a provider emits a diagnostic line.
    }
  }

  return remaining;
}

function usageFromPayload(payload) {
  return payload?.usage && typeof payload.usage === "object" ? payload.usage : null;
}

/**
 * Meters each outbound OpenRouter-compatible chat-completion request by
 * actual provider cost. We check the weekly budget before the call so an
 * already-exhausted user is blocked, then record the exact OpenRouter
 * `usage.cost` after the response completes.
 */
export function createCrofaiUsageMeter({
  db,
  userId,
  subscription,
  plan,
  signal,
  chatCompletionFn = chatCompletion,
  streamChatCompletionFn = streamChatCompletion
}) {
  async function checkBudget(callSignal = signal) {
    return assertApiBudgetAvailable({
      db,
      userId,
      subscription,
      plan,
      signal: callSignal
    });
  }

  async function resolveCost({ model, usage, generationId, apiKey, baseUrl, callSignal }) {
    const direct = usageCostCredits(usage);
    if (direct != null) return { cost: direct, source: "openrouter_usage" };

    const generationCost = await fetchOpenRouterGenerationCost({
      apiKey,
      baseUrl,
      generationId,
      signal: callSignal
    }).catch(() => null);
    if (generationCost != null) return { cost: generationCost, source: "openrouter_generation" };

    const estimated = estimateOpenRouterCostCredits({ model, usage });
    if (estimated != null) return { cost: estimated, source: "estimated_tokens" };
    return { cost: 0, source: "missing_usage" };
  }

  async function recordModelCost({ params, usage, generationId, callSignal = signal }) {
    const model = modelFromBody(params?.body);
    const window = apiUsageWindow(subscription, plan);
    const { cost, source } = await resolveCost({
      model,
      usage,
      generationId,
      apiKey: params?.apiKey,
      baseUrl: params?.baseUrl,
      callSignal
    });

    return db.recordApiUsageCost({
      userId,
      subscriptionId: subscription?.id || null,
      planId: plan.id,
      model,
      provider: params?.providerId || "openrouter",
      generationId: generationId || null,
      ...window,
      costCredits: cost,
      costSource: source,
      usage: usage || null,
      status: "completed"
    }, { signal: callSignal });
  }

  function meterStreamResponse(response, params, callSignal = signal) {
    if (!response?.body) return response;
    const decoder = new TextDecoder();
    let buffer = "";
    let usage = null;
    let generationId = "";

    const meteredBody = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
        buffer = parseSseEvents(buffer, (event) => {
          if (event?.id && !generationId) generationId = String(event.id);
          const eventUsage = usageFromPayload(event);
          if (eventUsage) usage = eventUsage;
        });
      },
      async flush() {
        if (buffer) {
          parseSseEvents(`${buffer}\n\n`, (event) => {
            if (event?.id && !generationId) generationId = String(event.id);
            const eventUsage = usageFromPayload(event);
            if (eventUsage) usage = eventUsage;
          });
        }
        await recordModelCost({ params, usage, generationId, callSignal });
      }
    }));

    return new Response(meteredBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }

  return {
    checkBudget,

    async chatCompletion(params) {
      await checkBudget(params?.signal);
      let responseUsage = null;
      let responseGenerationId = "";
      const result = await chatCompletionFn({
        ...params,
        onResponsePayload: (payload) => {
          responseUsage = usageFromPayload(payload);
          responseGenerationId = payload?.id ? String(payload.id) : "";
        }
      });
      await recordModelCost({
        params,
        usage: responseUsage,
        generationId: responseGenerationId,
        callSignal: params?.signal
      });
      return result;
    },

    async streamChatCompletion(params) {
      await checkBudget(params?.signal);
      const upstream = await streamChatCompletionFn(params);
      return meterStreamResponse(upstream, params, params?.signal);
    }
  };
}

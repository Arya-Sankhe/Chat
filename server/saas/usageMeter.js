import { randomUUID } from "node:crypto";
import { chatCompletion, streamChatCompletion } from "../crofai/client.js";
import { HttpError } from "../http/responses.js";
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
  streamChatCompletionFn = streamChatCompletion,
  meteringMode = "legacy",
  surface = "web",
  modality = "llm",
  oauthClientId = null,
  reservationCredits = 0.25,
  requestIdFactory = randomUUID
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

    const predicted = usageCostCredits(usage) ?? estimateOpenRouterCostCredits({ model, usage });
    const recordedUsage = meteringMode === "observe"
      ? {
          ...(usage || {}),
          klui_metering_observation: {
            predicted_credits: predicted,
            settled_credits: cost,
            absolute_delta: predicted == null ? null : Math.abs(predicted - cost),
            proposed_reservation_credits: reservationCredits,
            within_proposed_ceiling: cost <= reservationCredits
          }
        }
      : usage;
    if (meteringMode === "observe" && cost > reservationCredits) {
      console.error("observe-only reservation ceiling would under-reserve", { model, proposed: reservationCredits, actual: cost });
    }

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
      usage: recordedUsage || null,
      status: "completed"
    }, { signal: callSignal });
  }

  async function reserve(params) {
    const requestId = params?.requestId || requestIdFactory();
    const window = apiUsageWindow(subscription, plan);
    const result = await db.reserveApiUsage({
      userId,
      requestId,
      subscriptionId: subscription?.id || null,
      planId: plan.id,
      surface,
      modality,
      oauthClientId,
      provider: params?.providerId || "openrouter",
      model: modelFromBody(params?.body),
      ...window,
      reservedCredits: reservationCredits
    }, { signal: AbortSignal.timeout(15_000) });
    if (result?.duplicate) throw new HttpError(409, "This request ID has already been used.");
    if (result?.reason === "usage_metering_disabled") throw new HttpError(503, "Usage metering is temporarily unavailable.");
    if (!result?.allowed) throw new HttpError(429, "You've used up your weekly limit.", { code: "usage_exhausted", retryable: false });
    return requestId;
  }

  async function settleReservation({ requestId, params, usage, generationId }) {
    const resolved = await resolveCost({
      model: modelFromBody(params?.body),
      usage,
      generationId,
      apiKey: params?.apiKey,
      baseUrl: params?.baseUrl,
      callSignal: AbortSignal.timeout(15_000)
    });
    const missingUsage = resolved.source === "missing_usage";
    const cost = missingUsage ? reservationCredits : resolved.cost;
    const source = missingUsage ? "reservation_ceiling" : resolved.source;
    if (cost > reservationCredits) {
      await db.upsertAppSetting("funded_inference_disabled", {
        disabled: true,
        reason: "reservation_ceiling",
        detectedAt: new Date().toISOString()
      }, null, { signal: AbortSignal.timeout(15_000) });
      await db.settleApiUsage({
        userId,
        requestId,
        costCredits: reservationCredits,
        costSource: "reservation_ceiling",
        usage: usage || {},
        generationId,
        estimated: true
      }, { signal: AbortSignal.timeout(15_000) });
      console.error("usage reservation ceiling violated; funded inference disabled", {
        surface, model: modelFromBody(params?.body), reserved: reservationCredits, actual: cost
      });
      throw new HttpError(503, "Usage metering is temporarily unavailable.");
    }
    await db.settleApiUsage({
      userId,
      requestId,
      costCredits: cost,
      costSource: source,
      usage: usage || {},
      generationId,
      estimated: missingUsage
    }, { signal: AbortSignal.timeout(15_000) });
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


  function meterReservedStreamResponse(response, params, requestId) {
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
          if (usageFromPayload(event)) usage = usageFromPayload(event);
        });
      },
      async flush() {
        if (buffer) parseSseEvents(`${buffer}\n\n`, (event) => {
          if (event?.id && !generationId) generationId = String(event.id);
          if (usageFromPayload(event)) usage = usageFromPayload(event);
        });
        await settleReservation({ requestId, params, usage, generationId });
      }
    }));
    return new Response(meteredBody, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  return {
    checkBudget,

    async chatCompletion(params) {
      if (meteringMode === "enforce") {
        const requestId = await reserve(params);
        let providerAccepted = false;
        let submitted = false;
        const markSubmitted = async (generationId = "") => {
          if (submitted) return;
          await db.markApiUsageSubmitted({ userId, requestId, generationId }, { signal: AbortSignal.timeout(15_000) });
          submitted = true;
        };
        try {
          let responseUsage = null;
          let responseGenerationId = "";
          const result = await chatCompletionFn({
            ...params,
            onResponseStarted: async () => {
              providerAccepted = true;
              await markSubmitted();
            },
            onResponsePayload: (payload) => {
              responseUsage = usageFromPayload(payload);
              responseGenerationId = payload?.id ? String(payload.id) : "";
            }
          });
          providerAccepted = true;
          await markSubmitted(responseGenerationId);
          await settleReservation({ requestId, params, usage: responseUsage, generationId: responseGenerationId });
          return result;
        } catch (error) {
          if (!providerAccepted) {
            await db.releaseApiUsage({ userId, requestId }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
          } else if (!submitted) {
            await db.settleApiUsage({
              userId,
              requestId,
              costCredits: reservationCredits,
              costSource: "submission_state_failure",
              usage: {},
              estimated: true
            }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
          }
          throw error;
        }
      }
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
      if (meteringMode === "enforce") {
        const requestId = await reserve(params);
        let providerAccepted = false;
        let submitted = false;
        try {
          const upstream = await streamChatCompletionFn(params);
          providerAccepted = true;
          await db.markApiUsageSubmitted({ userId, requestId }, { signal: AbortSignal.timeout(15_000) });
          submitted = true;
          return meterReservedStreamResponse(upstream, params, requestId);
        } catch (error) {
          if (!providerAccepted) {
            await db.releaseApiUsage({ userId, requestId }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
          } else if (!submitted) {
            await db.settleApiUsage({
              userId,
              requestId,
              costCredits: reservationCredits,
              costSource: "submission_state_failure",
              usage: {},
              estimated: true
            }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
          }
          throw error;
        }
      }
      await checkBudget(params?.signal);
      const upstream = await streamChatCompletionFn(params);
      return meterStreamResponse(upstream, params, params?.signal);
    }
  };
}

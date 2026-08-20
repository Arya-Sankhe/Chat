import { HttpError } from "./http/responses.js";

/**
 * Provider registry. Each provider exposes an OpenAI-compatible
 * /chat/completions endpoint, so the existing chat client functions
 * (server/crofai/client.js) work uniformly across providers.
 *
 * Adding a provider here means setting its API key in the environment;
 * everything else (tool calling, streaming, normalization) is shared.
 */

export const DEFAULT_PROVIDER_ID = "openrouter";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const OPENROUTER_TEXT_MODEL = "deepseek/deepseek-v4-flash-0731";
export const OPENROUTER_VISION_MODEL = "xiaomi/mimo-v2.5";
export const OPENROUTER_COUNCIL_HY3_MODEL = "tencent/hy3";
// Text-only; used only as a Council panelist.
export const OPENROUTER_COUNCIL_MIMO_PRO_MODEL = "xiaomi/mimo-v2.5-pro";
export const OPENROUTER_PRO_MODEL = "openai/gpt-5.6-luna";
export const OPENROUTER_PRO_FALLBACK_MODEL = "minimax/minimax-m3";
export const OPENROUTER_VISION_L2 = "google/gemma-4-31b-it";
export const OPENROUTER_DEFAULT_MODEL = OPENROUTER_TEXT_MODEL;
export const OPENROUTER_NITRO_MODEL = "inclusionai/ling-3.0-flash";
export const OPENROUTER_TITLE_MODEL = "poolside/laguna-xs-2.1";
export const OPENROUTER_LAGUNA_S = "poolside/laguna-s-2.1";

const PROVIDER_LABELS = {
  klui: "Klui",
  openrouter: "OpenRouter"
};

export function normalizeProviderId(value, fallback = DEFAULT_PROVIDER_ID) {
  if (value === undefined || value === null) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "klui" || raw === "crof" || raw === "crofai") return "klui";
  if (raw === "openrouter" || raw === "open-router" || raw === "or") return "openrouter";
  throw new HttpError(400, `Unknown model provider: ${value}`);
}

export function providerLabel(id) {
  return PROVIDER_LABELS[id] || id || "Klui";
}

export function defaultModelForProvider(id) {
  if (id === "openrouter") return OPENROUTER_DEFAULT_MODEL;
  return "";
}

/**
 * Resolve a provider id to its concrete `{ apiKey, baseUrl }` so the
 * chat client can call the right host. Throws 503 when the provider
 * isn't configured on this server so we surface a clean error to the
 * caller instead of leaking a 401 from upstream.
 */
export function resolveProvider(id, config) {
  const providerId = normalizeProviderId(id);
  if (providerId === "openrouter") {
    const provider = config?.providers?.openrouter;
    if (!provider?.apiKey) {
      throw new HttpError(503, "OpenRouter is not configured on this server. Set OPENROUTER_API_KEY.");
    }
    return {
      id: "openrouter",
      label: providerLabel("openrouter"),
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl || OPENROUTER_BASE_URL
    };
  }

  if (!config?.serverApiKey) {
    throw new HttpError(503, "Klui model API key is not configured on the server.");
  }
  return {
    id: "klui",
    label: providerLabel("klui"),
    apiKey: config.serverApiKey,
    baseUrl: config.defaultBaseUrl
  };
}

export function providerAvailability(config) {
  return {
    klui: Boolean(config?.serverApiKey),
    openrouter: Boolean(config?.providers?.openrouter?.apiKey)
  };
}

export function resolveOpenRouterReasoningEffort(value) {
  const effort = String(value || "high").trim().toLowerCase();
  if (effort === "max" || effort === "xhigh") return "xhigh";
  return effort === "low" || effort === "medium" || effort === "high" ? effort : "high";
}

/**
 * OpenRouter only accepts `reasoning.effort` when the model exposes
 * supported efforts (DeepSeek, Luna, and HY3). Ling / Laguna / MiniMax / MiMo expose
 * on/off reasoning only — sending `effort` with `require_parameters`
 * yields "No endpoints found that can handle the requested parameters."
 */
export function openRouterModelSupportsReasoningEffort(model) {
  const id = String(model || "").trim().toLowerCase();
  return id.startsWith("deepseek/") || id === OPENROUTER_PRO_MODEL || id === OPENROUTER_COUNCIL_HY3_MODEL;
}

/** Poolside Laguna endpoints omit top_p; with require_parameters that 404s. */
export function openRouterModelSupportsTopP(model) {
  const id = String(model || "").trim().toLowerCase();
  return !id.startsWith("poolside/");
}

/**
 * Map our shared chat request shape to provider-specific fields.
 * OpenRouter expects `reasoning: { effort }` instead of `reasoning_effort`.
 *
 * When the request carries tools, we also pin OpenRouter's provider
 * routing to endpoints that actually support every parameter we send
 * (`require_parameters: true`). Without this, OpenRouter may route to an
 * endpoint that silently ignores `tools` (so the model never tool-calls)
 * or rejects the request outright with
 * "No endpoints found that support the provided 'tool_choice' value."
 */
export function adaptChatRequestForProvider(body, providerId) {
  if (!body || normalizeProviderId(providerId) !== "openrouter") return body;

  const { reasoning_effort: reasoningEffort, ...rest } = body;
  const effort = resolveOpenRouterReasoningEffort(reasoningEffort);
  const modelId = String(rest.model || "").trim().toLowerCase();
  const hasTools = Array.isArray(rest.tools) && rest.tools.length > 0;
  const isLagunaS = modelId === OPENROUTER_LAGUNA_S;
  const isProModel = modelId === OPENROUTER_PRO_MODEL;
  const isProFallbackModel = modelId === OPENROUTER_PRO_FALLBACK_MODEL;
  const isHy3 = modelId === OPENROUTER_COUNCIL_HY3_MODEL;
  // Laguna only supports on/off. L2 adds a DeepSeek Flash fallback that shares
  // this reasoning object — pin low effort so the fallback stays cheap. With
  // tools + require_parameters, effort would 404 Laguna, so keep enabled-only.
  const reasoning = rest.reasoning && typeof rest.reasoning === "object"
    ? rest.reasoning
    : openRouterModelSupportsReasoningEffort(rest.model)
      ? { effort: isProModel ? "xhigh" : isHy3 ? "high" : effort, exclude: false }
      : isLagunaS && !hasTools
        ? { effort: "low", exclude: false }
        : { enabled: true, exclude: false };

  const adapted = {
    ...rest,
    reasoning,
    /* OpenRouter reports token usage on streamed responses only when
       explicitly opted in. Mirrors `stream_options.include_usage`. */
    usage: {
      ...(rest.usage && typeof rest.usage === "object" ? rest.usage : {}),
      include: true
    }
  };

  if (isProModel) {
    delete adapted.temperature;
    delete adapted.top_p;
  }
  if (isProFallbackModel) {
    adapted.temperature = 1;
    adapted.top_p = 0.95;
  }

  if (!openRouterModelSupportsTopP(rest.model) && "top_p" in adapted) {
    delete adapted.top_p;
  }

  if (isLagunaS) {
    // ponytail: S is often rate-limited; one fallback to DeepSeek Flash.
    adapted.models = [OPENROUTER_LAGUNA_S, OPENROUTER_TEXT_MODEL];
  }

  const isDeepSeekModel = modelId.startsWith("deepseek/");
  const providerPrefs = {
    ...(rest.provider && typeof rest.provider === "object" ? rest.provider : {})
  };

  if (isDeepSeekModel) {
    providerPrefs.order = ["relace", "baidu", "coreweave", "novita", "streamlake", "deepinfra"];
    providerPrefs.allow_fallbacks = true;
  }
  if (isProModel) {
    delete adapted.service_tier;
    providerPrefs.order = ["openai/flex", "openai"];
    providerPrefs.allow_fallbacks = true;
    providerPrefs.preferred_max_latency = 6;
    providerPrefs.preferred_min_throughput = 25;
  }

  if (hasTools) {
    providerPrefs.require_parameters = true;
  }

  if (Object.keys(providerPrefs).length) {
    adapted.provider = providerPrefs;
  }

  return adapted;
}

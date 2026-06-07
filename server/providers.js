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

export const OPENROUTER_TEXT_MODEL = "deepseek/deepseek-v4-flash";
export const OPENROUTER_VISION_MODEL = "xiaomi/mimo-v2.5";
export const OPENROUTER_PRO_MODEL = "qwen/qwen3.7-plus";
export const OPENROUTER_DEFAULT_MODEL = OPENROUTER_TEXT_MODEL;

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

const OPENROUTER_REASONING_EFFORTS = new Set(["low", "medium", "high"]);

export function resolveOpenRouterReasoningEffort(value) {
  const effort = String(value || "high").trim().toLowerCase();
  return OPENROUTER_REASONING_EFFORTS.has(effort) ? effort : "high";
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

  const adapted = {
    ...rest,
    reasoning: {
      effort,
      exclude: false
    }
  };

  if (Array.isArray(rest.tools) && rest.tools.length) {
    adapted.provider = {
      ...(rest.provider && typeof rest.provider === "object" ? rest.provider : {}),
      require_parameters: true
    };
  }

  return adapted;
}

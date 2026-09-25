import { HttpError } from "./http/responses.js";

/** OpenRouter routing and request normalization. */

export const DEFAULT_PROVIDER_ID = "openrouter";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export const OPENROUTER_TEXT_MODEL = "deepseek/deepseek-v4-flash-0731";
export const OPENROUTER_VISION_MODEL = "xiaomi/mimo-v2.5";
export const OPENROUTER_COUNCIL_HY3_MODEL = "tencent/hy3";
// Text-only; used only as a Council panelist.
export const OPENROUTER_COUNCIL_MIMO_PRO_MODEL = "xiaomi/mimo-v2.5-pro";
export const OPENROUTER_PRO_MODEL = "openai/gpt-5.6-luna";
export const OPENROUTER_PRO_FALLBACK_MODEL = "minimax/minimax-m3";
export const OPENROUTER_VISION_L2 = "qwen/qwen3.7-flash";
export const OPENROUTER_VISION_L3 = "qwen/qwen3.8-flash";
export const OPENROUTER_GLM_FLASH_MODEL = "z-ai/glm-5.3-flash";
export const OPENROUTER_NITRO_MODEL = "inclusionai/ling-3.0-flash";
export const OPENROUTER_TITLE_MODEL = "poolside/laguna-xs-2.1";
export const OPENROUTER_LAGUNA_S = "poolside/laguna-s-2.1";

const DEEPSEEK_PROVIDER_ORDER = ["relace/fp4", "streamlake/fp8", "deepinfra/fp8", "makora", "coreweave/fp8", "together"];
// Hard-excluded DeepSeek hosts (quality/policy — not price; price is handled
// by the ceilings below, so e.g. Baidu is filtered while expensive but
// automatically re-admitted if it drops back under the caps).
const DEEPSEEK_DENYLIST = new Set(["open-inference/fp8", "inceptron/fp4", "sail-research/fp4"]);
// Absolute price ceilings ($ per 1M tokens). Anything above is never ranked.
const DEEPSEEK_MAX_PROMPT_PER_M = 0.15;
const DEEPSEEK_MAX_COMPLETION_PER_M = 0.3;
// Sweet spot ($ per 1M tokens). Fastest provider inside this bracket wins.
const DEEPSEEK_SWEET_PROMPT_PER_M = 0.1;
const DEEPSEEK_SWEET_COMPLETION_PER_M = 0.2;
// Backup pool: providers above the sweet spot but still under the ceilings
// need at least this p50 throughput (tokens/sec) to be ranked.
const DEEPSEEK_BACKUP_MIN_THROUGHPUT_P50 = 40;
const DEEPSEEK_PRICE_TTL_MS = 5 * 60 * 1000;
let deepSeekProviderOrder = DEEPSEEK_PROVIDER_ORDER;
// Endpoint tag -> provider display name, from the live catalog. Responses name the host
// ("DeepInfra"), while routing takes tags ("deepinfra/fp8"), so sticky routing maps between them.
let deepSeekTagProviders = new Map();
let deepSeekPriceExpiresAt = 0;
let deepSeekPriceRefresh = null;
let deepSeekNoStatsWarned = false;

export function normalizeProviderId(value) {
  if (value === undefined || value === null) return DEFAULT_PROVIDER_ID;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return DEFAULT_PROVIDER_ID;
  if (raw === "openrouter" || raw === "open-router" || raw === "or") return "openrouter";
  throw new HttpError(400, `Unknown model provider: ${value}`);
}

/**
 * Resolve the sole model provider to concrete credentials. Throws 503 when
 * it is not configured so callers do not leak an upstream 401.
 */
export function resolveProvider(id, config) {
  normalizeProviderId(id);
  const provider = config?.providers?.openrouter;
  if (!provider?.apiKey) {
    throw new HttpError(503, "OpenRouter is not configured on this server. Set OPENROUTER_API_KEY.");
  }
  return {
    id: "openrouter",
    label: "OpenRouter",
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl || OPENROUTER_BASE_URL
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

/** OpenRouter pricing is per token (string). Normalize to $ per 1M tokens. */
function pricePerMillionTokens(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) return null;
  return price * 1_000_000;
}

function throughputP50(endpoint) {
  const raw = endpoint?.throughput_last_30m;
  // Live shape is { p50, p75, p90, p99 }; accept a bare number too so a
  // catalog shape change degrades to ranking instead of zeroing everyone.
  const value = raw != null && typeof raw === "object" ? raw.p50 : raw;
  const tps = Number(value);
  return Number.isFinite(tps) && tps > 0 ? tps : 0;
}

function endpointHasThroughputStats(endpoint) {
  return throughputP50(endpoint) > 0;
}

export function deepSeekProviderOrderFromEndpoints(endpoints) {
  const list = Array.isArray(endpoints) ? endpoints : [];
  const liveByTag = new Map();
  for (const endpoint of list) {
    const tag = String(endpoint?.tag || "").trim();
    if (tag && !liveByTag.has(tag.toLowerCase())) liveByTag.set(tag.toLowerCase(), endpoint);
  }
  const candidates = [];
  for (const endpoint of list) {
    const tag = String(endpoint?.tag || "").trim();
    const key = tag.toLowerCase();
    if (!tag || DEEPSEEK_DENYLIST.has(key)) continue;
    // Degraded endpoints stay out of the ranking; OpenRouter can still
    // fall back to them via allow_fallbacks if every ranked host fails.
    if (endpoint?.status != null && Number(endpoint.status) !== 0) continue;
    const promptPerM = pricePerMillionTokens(endpoint?.pricing?.prompt);
    const completionPerM = pricePerMillionTokens(endpoint?.pricing?.completion);
    if (promptPerM == null || completionPerM == null) continue;
    if (promptPerM > DEEPSEEK_MAX_PROMPT_PER_M || completionPerM > DEEPSEEK_MAX_COMPLETION_PER_M) continue;
    candidates.push({ tag, key, promptPerM, completionPerM, tps: throughputP50(endpoint) });
  }

  // Primary: fastest p50 throughput inside the sweet-spot bracket.
  const primary = candidates
    .filter((c) => c.tps > 0 && c.promptPerM <= DEEPSEEK_SWEET_PROMPT_PER_M && c.completionPerM <= DEEPSEEK_SWEET_COMPLETION_PER_M)
    .sort((a, b) => b.tps - a.tps);
  const primaryTags = new Set(primary.map((c) => c.key));

  // Backup: fast (>=40 tps p50) providers under the ceilings but outside
  // the sweet spot (e.g. Baseten). Appended after the primary bracket.
  const backup = candidates
    .filter((c) => !primaryTags.has(c.key) && c.tps >= DEEPSEEK_BACKUP_MIN_THROUGHPUT_P50)
    .sort((a, b) => b.tps - a.tps);

  // Dedupe (the catalog can list the same tag twice) then pin the stable
  // curated fallback so we never return an empty order when live perf
  // data is missing (e.g. unauthenticated response with null throughput).
  // The tail runs through the same gates: denylisted tags are skipped, and
  // any tail host present in the live payload must still pass the price and
  // status checks (so e.g. Baidu stays out while over the ceilings but is
  // automatically re-admitted if it drops back under them).
  const ordered = [];
  const seen = new Set();
  for (const c of [...primary, ...backup]) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    ordered.push(c.tag);
  }
  for (const tag of DEEPSEEK_PROVIDER_ORDER) {
    const tailKey = String(tag).toLowerCase();
    if (seen.has(tailKey) || DEEPSEEK_DENYLIST.has(tailKey)) continue;
    const live = liveByTag.get(tailKey);
    if (live) {
      if (live?.status != null && Number(live.status) !== 0) continue;
      const promptPerM = pricePerMillionTokens(live?.pricing?.prompt);
      const completionPerM = pricePerMillionTokens(live?.pricing?.completion);
      if (promptPerM == null || completionPerM == null) continue;
      if (promptPerM > DEEPSEEK_MAX_PROMPT_PER_M || completionPerM > DEEPSEEK_MAX_COMPLETION_PER_M) continue;
    }
    seen.add(tailKey);
    ordered.push(tag);
  }
  return ordered;
}

export async function refreshDeepSeekProviderOrder({ apiKey, baseUrl = OPENROUTER_BASE_URL } = {}) {
  if (Date.now() < deepSeekPriceExpiresAt) return deepSeekProviderOrder;
  if (deepSeekPriceRefresh) return deepSeekPriceRefresh;

  deepSeekPriceRefresh = (async () => {
    try {
      const response = await fetch(`${baseUrl}/models/${OPENROUTER_TEXT_MODEL}/endpoints`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        const payload = await response.json();
        const liveEndpoints = payload?.data?.endpoints;
        deepSeekProviderOrder = deepSeekProviderOrderFromEndpoints(liveEndpoints);
        if (Array.isArray(liveEndpoints)) {
          deepSeekTagProviders = new Map(liveEndpoints
            .filter((endpoint) => endpoint?.tag && endpoint?.provider_name)
            .map((endpoint) => [String(endpoint.tag).toLowerCase(), String(endpoint.provider_name)]));
        }
        if (
          Array.isArray(liveEndpoints) && liveEndpoints.length > 0
          && !liveEndpoints.some(endpointHasThroughputStats)
          && !deepSeekNoStatsWarned
        ) {
          deepSeekNoStatsWarned = true;
          console.warn("[deepseek] endpoints refresh returned zero throughput stats; using curated fallback order.");
        }
      }
    } catch {
      // Ranking is an optimization; retain the stable curated order on failure.
    } finally {
      deepSeekPriceExpiresAt = Date.now() + DEEPSEEK_PRICE_TTL_MS;
      deepSeekPriceRefresh = null;
    }
    return deepSeekProviderOrder;
  })();

  return deepSeekPriceRefresh;
}

function providerSlug(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Routing tags for the host that served an earlier request in the same turn. DeepSeek hosts
 * resolve through the live catalog and only while they are still inside our price-ranked
 * order, so a turn that fell back to an expensive host does not stay there. Other models
 * use the provider slug (OpenRouter ignores an unknown slug in `order`).
 */
export function stickyProviderTags(model, providerName, order = null) {
  const name = String(providerName || "").trim();
  if (!name) return [];
  const id = String(model || "").trim().toLowerCase();
  if (id.startsWith("deepseek/")) {
    const ranked = order || deepSeekProviderOrder;
    const wanted = name.toLowerCase();
    const slug = providerSlug(name);
    return ranked.filter((tag) => {
      const key = String(tag).toLowerCase();
      const listed = deepSeekTagProviders.get(key);
      return listed ? listed.toLowerCase() === wanted : key.split("/")[0] === slug;
    });
  }
  const slug = providerSlug(name);
  return slug ? [slug] : [];
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

  const { reasoning_effort: reasoningEffort, sticky_provider: stickyProvider, ...rest } = body;
  const effort = resolveOpenRouterReasoningEffort(reasoningEffort);
  const modelId = String(rest.model || "").trim().toLowerCase();
  const hasTools = Array.isArray(rest.tools) && rest.tools.length > 0;
  const isLagunaS = modelId === OPENROUTER_LAGUNA_S;
  const isProModel = modelId === OPENROUTER_PRO_MODEL;
  const isHy3 = modelId === OPENROUTER_COUNCIL_HY3_MODEL;
  // Laguna only supports on/off. L2 adds a DeepSeek Flash fallback that shares
  // this reasoning object — pin medium effort for the compare/council slot. With
  // tools + require_parameters, effort would 404 Laguna, so keep enabled-only.
  let reasoning;
  if (rest.reasoning && typeof rest.reasoning === "object") {
    if (!openRouterModelSupportsReasoningEffort(rest.model) && rest.reasoning.effort) {
      // Laguna shares this object with its DeepSeek fallback, so allow an
      // explicit low/medium/high when there are no tools. With tools +
      // require_parameters, effort would 404 Laguna, so keep enabled-only.
      const requested = String(rest.reasoning.effort || "").trim().toLowerCase();
      if (isLagunaS && !hasTools && (requested === "low" || requested === "medium" || requested === "high")) {
        reasoning = { effort: requested, exclude: rest.reasoning.exclude ?? false };
      } else {
        reasoning = { enabled: rest.reasoning.enabled !== false, exclude: rest.reasoning.exclude ?? false };
      }
    } else {
      reasoning = rest.reasoning;
    }
  } else if (openRouterModelSupportsReasoningEffort(rest.model)) {
    reasoning = { effort: isProModel ? "xhigh" : isHy3 ? "high" : effort, exclude: false };
  } else if (isLagunaS && !hasTools) {
    reasoning = { effort: "medium", exclude: false };
  } else {
    reasoning = { enabled: true, exclude: false };
  }

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

  if (!openRouterModelSupportsTopP(rest.model) && "top_p" in adapted) {
    delete adapted.top_p;
  }

  if (isLagunaS) {
    // ponytail: S is often rate-limited; one fallback to DeepSeek Flash.
    adapted.models = [OPENROUTER_LAGUNA_S, OPENROUTER_TEXT_MODEL];
  }
  if (modelId === OPENROUTER_NITRO_MODEL) {
    adapted.models = [OPENROUTER_TEXT_MODEL];
  }

  const isDeepSeekModel = modelId.startsWith("deepseek/");
  const providerPrefs = {
    ...(rest.provider && typeof rest.provider === "object" ? rest.provider : {})
  };

  if (isDeepSeekModel) {
    providerPrefs.order = [...deepSeekProviderOrder];
    providerPrefs.allow_fallbacks = true;
    // Soft backup: if our explicit order goes stale, still deprioritize
    // hosts below 40 tps p50. Soft reorder only — never fails closed.
    if (providerPrefs.preferred_min_throughput == null) {
      providerPrefs.preferred_min_throughput = { p50: DEEPSEEK_BACKUP_MIN_THROUGHPUT_P50 };
    }
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

  // Keep every request in a turn on the host that served its first request, so the provider's
  // prompt cache stays warm. Fallbacks stay on: an outage costs a cache miss, not the turn.
  if (stickyProvider && !isProModel && !providerPrefs.only) {
    const pinned = stickyProviderTags(modelId, stickyProvider, providerPrefs.order);
    if (pinned.length) {
      const keys = new Set(pinned.map((tag) => tag.toLowerCase()));
      providerPrefs.order = [...pinned, ...(providerPrefs.order || []).filter((tag) => !keys.has(String(tag).toLowerCase()))];
      providerPrefs.allow_fallbacks = true;
    }
  }

  if (Object.keys(providerPrefs).length) {
    adapted.provider = providerPrefs;
  }

  return adapted;
}

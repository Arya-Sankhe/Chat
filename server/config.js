import { CROFAI_BASE_URLS, DEFAULT_CROFAI_BASE_URL, normalizeBaseUrl } from "./crofai/constants.js";
import { loadPlans } from "./saas/plans.js";

function readPort(value) {
  const port = Number.parseInt(value || "3000", 10);
  return Number.isInteger(port) && port > 0 ? port : 3000;
}

function clean(value) {
  return String(value || "").trim();
}

function cleanUrl(value) {
  return clean(value).replace(/\/+$/, "");
}

function readInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readAccessMode(value) {
  const mode = clean(value || "testing").toLowerCase();
  return mode === "subscription" ? "subscription" : "testing";
}

function readBoolean(value, fallback = false) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function readSearchMode(value) {
  const mode = clean(value || "auto").toLowerCase();
  return mode === "off" ? "off" : "auto";
}

function readSearchProvider(value) {
  const provider = clean(value || "jina").toLowerCase();
  return provider === "brave" ? "brave" : "jina";
}

function readJinaEngine(value) {
  const engine = clean(value || "direct").toLowerCase();
  return engine === "browser" ? "browser" : "direct";
}

function readJinaBackend(value) {
  const backend = clean(value || "google").toLowerCase();
  return backend === "bing" ? "bing" : "google";
}

const PLAN_SEARCH_DEFAULTS = {
  hobby: 50,
  pro: 200,
  intermediate: 500,
  scale: 2000,
  max: 5000
};

function loadSearchLimits(env) {
  const limits = {};
  for (const [planId, fallback] of Object.entries(PLAN_SEARCH_DEFAULTS)) {
    limits[planId] = readInt(env[`WEBSEARCH_DAILY_LIMIT_${planId.toUpperCase()}`], fallback);
  }
  return limits;
}

export function loadConfig(env = process.env) {
  const port = readPort(env.PORT);
  const defaultBaseUrl = normalizeBaseUrl(env.CROFAI_BASE_URL || DEFAULT_CROFAI_BASE_URL);
  const appUrl = cleanUrl(env.APP_URL) || `http://localhost:${port}`;
  const plans = loadPlans(env);
  const accessMode = readAccessMode(env.ACCESS_MODE);
  const r2AccountId = clean(env.R2_ACCOUNT_ID);

  return {
    host: env.HOST || "0.0.0.0",
    port,
    appUrl,
    defaultBaseUrl,
    allowedBaseUrls: CROFAI_BASE_URLS,
    serverApiKey: clean(env.CROFAI_API_KEY),
    visionDescribeModel: clean(env.VISION_DESCRIBE_MODEL),
    plans,
    access: {
      mode: accessMode,
      testingPlanId: clean(env.TEST_PLAN_ID) || "pro"
    },
    supabase: {
      url: cleanUrl(env.SUPABASE_URL),
      anonKey: clean(env.SUPABASE_ANON_KEY),
      serviceRoleKey: clean(env.SUPABASE_SERVICE_ROLE_KEY)
    },
    auth: {
      googleEnabled: readBoolean(env.SUPABASE_GOOGLE_ENABLED, false)
    },
    r2: {
      accountId: r2AccountId,
      accessKeyId: clean(env.R2_ACCESS_KEY_ID),
      secretAccessKey: clean(env.R2_SECRET_ACCESS_KEY),
      bucket: clean(env.R2_BUCKET),
      endpoint: cleanUrl(env.R2_ENDPOINT) || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : ""),
      uploadExpiresSeconds: readInt(env.R2_UPLOAD_EXPIRES_SECONDS, 300),
      readExpiresSeconds: readInt(env.R2_READ_EXPIRES_SECONDS, 900),
      maxImageBytes: readInt(env.R2_MAX_IMAGE_BYTES, 6 * 1024 * 1024)
    },
    websearch: {
      defaultMode: readSearchMode(env.WEBSEARCH_DEFAULT_MODE),
      primaryProvider: readSearchProvider(env.WEBSEARCH_PRIMARY_PROVIDER),
      maxResults: readInt(env.WEBSEARCH_MAX_RESULTS, 5),
      pageContentChars: readInt(env.WEBSEARCH_PAGE_CONTENT_CHARS, 4000),
      totalContextChars: readInt(env.WEBSEARCH_TOTAL_CONTEXT_CHARS, 12000),
      cacheTtlSeconds: readInt(env.WEBSEARCH_CACHE_TTL_SECONDS, 900),
      cacheMaxEntries: readInt(env.WEBSEARCH_CACHE_MAX_ENTRIES, 500),
      fetchTimeoutMs: readInt(env.WEBSEARCH_FETCH_TIMEOUT_MS, 8000),
      maxToolCallsPerTurn: readInt(env.WEBSEARCH_MAX_TOOL_CALLS_PER_TURN, 3),
      denyDomains: clean(env.WEBSEARCH_DENY_DOMAINS)
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
      dailyLimits: loadSearchLimits(env),
      jina: {
        apiKey: clean(env.JINA_API_KEY),
        backend: readJinaBackend(env.JINA_SEARCH_PROVIDER),
        engine: readJinaEngine(env.JINA_SEARCH_ENGINE)
      },
      brave: {
        apiKey: clean(env.BRAVE_SEARCH_API_KEY)
      }
    }
  };
}

export function configuredServices(config) {
  return {
    crof: Boolean(config.serverApiKey),
    supabase: Boolean(config.supabase.url && config.supabase.anonKey && config.supabase.serviceRoleKey),
    access: config.access.mode === "testing" || config.access.mode === "subscription",
    r2: Boolean(config.r2.endpoint && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket),
    websearch: Boolean(config.websearch.jina.apiKey || config.websearch.brave.apiKey)
  };
}

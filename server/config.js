import { CROFAI_BASE_URLS, DEFAULT_CROFAI_BASE_URL, normalizeBaseUrl } from "./crofai/constants.js";
import { loadPlans } from "./saas/plans.js";
import { normalizeAllowedOrigins } from "./http/cors.js";

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

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readMeteringMode(value) {
  const mode = clean(value || "legacy").toLowerCase();
  return ["legacy", "observe", "enforce"].includes(mode) ? mode : "legacy";
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
  const provider = clean(value || "searxng").toLowerCase();
  if (provider === "jina" || provider === "brave" || provider === "searxng") return provider;
  return "searxng";
}

function readJinaEngine(value) {
  const engine = clean(value || "direct").toLowerCase();
  return engine === "browser" ? "browser" : "direct";
}

function readDocumentMode(value) {
  return readBoolean(value, true);
}

const PLAN_SEARCH_DEFAULTS = {
  lite: 50,
  essential: 200,
  pro: 500
};

function loadSearchLimits(env) {
  const limits = {};
  for (const [planId, fallback] of Object.entries(PLAN_SEARCH_DEFAULTS)) {
    limits[planId] = readInt(env[`WEBSEARCH_DAILY_LIMIT_${planId.toUpperCase()}`], fallback);
  }
  return limits;
}

function readList(value, fallback = []) {
  const entries = clean(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length ? entries : fallback;
}

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function loadConfig(env = process.env) {
  const port = readPort(env.PORT);
  const defaultBaseUrl = normalizeBaseUrl(env.CROFAI_BASE_URL || DEFAULT_CROFAI_BASE_URL);
  const appUrl = cleanUrl(env.APP_URL) || `http://localhost:${port}`;
  const plans = loadPlans(env);
  const accessMode = readAccessMode(env.ACCESS_MODE);
  const r2AccountId = clean(env.R2_ACCOUNT_ID);
  const contextMaxTokens = readInt(env.CONTEXT_MAX_TOKENS, 256_000);
  const contextCompactAtTokens = Math.min(
    readInt(env.CONTEXT_COMPACT_AT_TOKENS, 140_000),
    contextMaxTokens
  );
  const mobileAllowedOrigins = normalizeAllowedOrigins([
    "https://klui.tech",
    "https://www.klui.tech",
    "https://localhost",
    ...readList(env.MOBILE_ALLOWED_ORIGINS)
  ]);

  return {
    host: env.HOST || "0.0.0.0",
    port,
    appUrl,
    defaultBaseUrl,
    allowedBaseUrls: CROFAI_BASE_URLS,
    serverApiKey: clean(env.CROFAI_API_KEY),
    providers: {
      openrouter: {
        apiKey: clean(env.OPENROUTER_API_KEY),
        baseUrl: cleanUrl(env.OPENROUTER_BASE_URL) || "https://openrouter.ai/api/v1"
      }
    },
    speech: {
      apiKey: clean(env.SARVAM_API_KEY),
      baseUrl: cleanUrl(env.SARVAM_BASE_URL) || "https://api.sarvam.ai",
      creditsPerSecond: readPositiveNumber(env.SARVAM_STT_CREDITS_PER_SECOND, 0)
    },
    desktop: {
      oauthEnabled: readBoolean(env.DESKTOP_OAUTH_ENABLED, false),
      chatEnabled: readBoolean(env.DESKTOP_CHAT_ENABLED, false),
      sttEnabled: readBoolean(env.DESKTOP_STT_ENABLED, false),
      betaAccountIds: readList(env.DESKTOP_BETA_ACCOUNT_IDS).map((id) => id.toLowerCase()),
      meteringMode: readMeteringMode(env.API_USAGE_METERING_MODE),
      privacyPolicyVersion: clean(env.DESKTOP_PRIVACY_POLICY_VERSION) || "2026-08-11",
      model: clean(env.DESKTOP_CHAT_MODEL) || "openai/gpt-5.6-luna",
      maxCompletionTokens: Math.min(readInt(env.DESKTOP_MAX_COMPLETION_TOKENS, 8192), 8192),
      // These are enforceable OpenRouter routing ceilings, not pricing
      // estimates. If an endpoint becomes more expensive, OpenRouter rejects
      // the request instead of letting it exceed the reserved allowance.
      maxInputTokens: Math.min(readInt(env.DESKTOP_MAX_INPUT_TOKENS, 1_050_000), 1_050_000),
      maxPromptPricePerMillion: readPositiveNumber(env.DESKTOP_MAX_PROMPT_PRICE_PER_MILLION, 0.20),
      maxCompletionPricePerMillion: readPositiveNumber(env.DESKTOP_MAX_COMPLETION_PRICE_PER_MILLION, 1.20),
      chatReservationCredits: readPositiveNumber(env.DESKTOP_CHAT_RESERVATION_CREDITS, 0),
      minimumWindowsVersion: clean(env.DESKTOP_MINIMUM_WINDOWS_VERSION) || "0.1.0",
      latestWindowsVersion: clean(env.DESKTOP_LATEST_WINDOWS_VERSION) || "0.1.0",
      windowsDownloadUrl: cleanUrl(env.DESKTOP_WINDOWS_DOWNLOAD_URL) || "https://klui.tech/download/windows",
      clients: {
        "klui-desktop-windows": {
          providerClientId: clean(env.SUPABASE_OAUTH_DESKTOP_WINDOWS_CLIENT_ID),
          redirectUri: "tech.klui.anything.windows://oauth/callback",
          surface: "desktop_windows"
        },
        "klui-desktop-macos": {
          providerClientId: clean(env.SUPABASE_OAUTH_DESKTOP_MACOS_CLIENT_ID),
          redirectUri: "tech.klui.anything.macos://oauth/callback",
          surface: "desktop_macos",
          reserved: true
        }
      }
    },
    visionDescribeModel: clean(env.VISION_DESCRIBE_MODEL),
    plans,
    access: {
      mode: accessMode,
      testingPlanId: clean(env.TEST_PLAN_ID) || "essential"
    },
    supabase: {
      url: cleanUrl(env.SUPABASE_URL),
      anonKey: clean(env.SUPABASE_ANON_KEY),
      serviceRoleKey: clean(env.SUPABASE_SERVICE_ROLE_KEY)
    },
    auth: {
      googleEnabled: readBoolean(env.SUPABASE_GOOGLE_ENABLED, false),
      googleClientId: clean(env.GOOGLE_CLIENT_ID || env.SUPABASE_GOOGLE_CLIENT_ID)
    },
    mobile: {
      allowedOrigins: mobileAllowedOrigins
    },
    r2: {
      accountId: r2AccountId,
      accessKeyId: clean(env.R2_ACCESS_KEY_ID),
      secretAccessKey: clean(env.R2_SECRET_ACCESS_KEY),
      bucket: clean(env.R2_BUCKET),
      endpoint: cleanUrl(env.R2_ENDPOINT) || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : ""),
      uploadExpiresSeconds: readInt(env.R2_UPLOAD_EXPIRES_SECONDS, 300),
      readExpiresSeconds: readInt(env.R2_READ_EXPIRES_SECONDS, 900),
      maxImageBytes: readInt(env.R2_MAX_IMAGE_BYTES, 10 * 1024 * 1024)
    },
    onlyoffice: {
      publicUrl: cleanUrl(env.ONLYOFFICE_PUBLIC_URL),
      jwtSecret: clean(env.ONLYOFFICE_JWT_SECRET)
    },
    storageCleanup: {
      graceDays: readInt(env.STORAGE_CLEANUP_GRACE_DAYS, 7),
      batchSize: readInt(env.STORAGE_CLEANUP_BATCH_SIZE, 100)
    },
    context: {
      maxTokens: contextMaxTokens,
      compactAtTokens: contextCompactAtTokens,
      keepRecentTokens: Math.min(
        readInt(env.CONTEXT_KEEP_RECENT_TOKENS, 80_000),
        contextCompactAtTokens
      ),
      reserveTokens: Math.min(
        readInt(env.CONTEXT_RESERVE_TOKENS, 32_000),
        Math.max(1, contextMaxTokens - 1)
      ),
      summaryModel: clean(env.CONTEXT_SUMMARY_MODEL) || "deepseek/deepseek-v4-flash-0731",
      summaryMaxTokens: readInt(env.CONTEXT_SUMMARY_MAX_TOKENS, 2000)
    },
    documents: {
      enabled: readDocumentMode(env.DOCUMENTS_ENABLED),
      maxFileBytes: readInt(env.DOCUMENT_MAX_FILE_BYTES, 30 * 1024 * 1024),
      maxFilesPerMessage: readInt(env.DOCUMENT_MAX_FILES_PER_MESSAGE, 5),
      maxTotalBytesPerMessage: readInt(env.DOCUMENT_MAX_TOTAL_BYTES_PER_MESSAGE, 60 * 1024 * 1024),
      maxPdfPages: readInt(env.DOCUMENT_MAX_PDF_PAGES, 100),
      maxDocxWords: readInt(env.DOCUMENT_MAX_DOCX_WORDS, 80_000),
      maxXlsxSheets: readInt(env.DOCUMENT_MAX_XLSX_SHEETS, 25),
      maxXlsxCells: readInt(env.DOCUMENT_MAX_XLSX_CELLS, 250_000),
      maxCsvRows: readInt(env.DOCUMENT_MAX_CSV_ROWS, 100_000),
      maxCsvColumns: readInt(env.DOCUMENT_MAX_CSV_COLUMNS, 100),
      maxExtractedChars: readInt(env.DOCUMENT_MAX_EXTRACTED_CHARS, 500_000),
      contextCharsPerTurn: readInt(env.DOCUMENT_CONTEXT_CHARS_PER_TURN, 20_000),
      maxToolResultChars: readInt(env.DOCUMENT_MAX_TOOL_RESULT_CHARS, 24_000),
      visualPageDpi: readInt(env.DOCUMENT_VISUAL_PAGE_DPI, 144),
      visualMaxPagesPerTool: readInt(env.DOCUMENT_VISUAL_MAX_PAGES_PER_TOOL, 40),
      visualMaxImageInputsPerTurn: readInt(env.DOCUMENT_VISUAL_MAX_IMAGE_INPUTS_PER_TURN, 24),
      visualInlineImages: readBoolean(env.DOCUMENT_VISUAL_INLINE_IMAGES, true),
      visualInlineMaxBytes: readInt(env.DOCUMENT_VISUAL_INLINE_MAX_BYTES, 2 * 1024 * 1024),
      visualInlineMaxTotalBytes: readInt(env.DOCUMENT_VISUAL_INLINE_MAX_TOTAL_BYTES, 12 * 1024 * 1024),
      visualEmbedModel: clean(env.DOCUMENT_VISUAL_EMBED_MODEL) || "jina-embeddings-v5-omni-nano",
      jinaApiKey: clean(env.JINA_API_KEY),
      workerConcurrency: readInt(env.DOCUMENT_WORKER_CONCURRENCY, 1),
      jobTimeoutMs: readInt(env.DOCUMENT_JOB_TIMEOUT_MS, 120_000),
      uploadExpiresSeconds: readInt(env.DOCUMENT_UPLOAD_EXPIRES_SECONDS, 900),
      previewMaxPages: readInt(env.DOCUMENT_PREVIEW_MAX_PAGES, 2),
      previewTtlDays: readInt(env.DOCUMENT_PREVIEW_TTL_DAYS, 30),
      maxToolCallsPerTurn: readInt(env.DOCUMENT_MAX_TOOL_CALLS_PER_TURN, 75),
      jobWaitMs: readInt(env.DOCUMENT_TOOL_JOB_WAIT_MS, 20_000)
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
      maxToolCallsPerTurn: readInt(env.WEBSEARCH_MAX_TOOL_CALLS_PER_TURN, 75),
      denyDomains: clean(env.WEBSEARCH_DENY_DOMAINS)
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
      dailyLimits: loadSearchLimits(env),
      searxng: {
        baseUrl: cleanUrl(env.SEARXNG_BASE_URL) || "http://searxng:8080",
        engines: readList(env.SEARXNG_ENGINES, ["duckduckgo", "bing", "mojeek"])
      },
      jina: {
        apiKey: clean(env.JINA_API_KEY),
        engine: readJinaEngine(env.JINA_SEARCH_ENGINE),
        readerBaseUrl: cleanUrl(env.JINA_READER_BASE_URL),
        readerFallbackUrl: cleanUrl(env.JINA_READER_FALLBACK_URL) || "https://r.jina.ai"
      },
      brave: {
        apiKey: clean(env.BRAVE_SEARCH_API_KEY)
      }
    },
    weather: {
      apiKey: clean(env.OPENWEATHER_API_KEY),
      baseUrl: cleanUrl(env.OPENWEATHER_BASE_URL) || "https://api.openweathermap.org",
      timeoutMs: readInt(env.OPENWEATHER_TIMEOUT_MS, 8000)
    },
    research: {
      enabled: readBoolean(env.RESEARCH_ENABLED, true),
      cheapModel: clean(env.RESEARCH_CHEAP_MODEL) || "deepseek/deepseek-v4-flash-0731",
      workerConcurrency: readInt(env.RESEARCH_WORKER_CONCURRENCY, 3),
      leaseSeconds: readInt(env.RESEARCH_LEASE_SECONDS, 120),
      pollMs: readInt(env.RESEARCH_WORKER_POLL_MS, 5000),
      maxPollMs: readInt(env.RESEARCH_WORKER_MAX_POLL_MS, 10_000),
      maxRunMs: readInt(env.RESEARCH_MAX_RUN_MS, 20 * 60 * 1000),
      fetchTimeoutMs: readInt(env.RESEARCH_FETCH_TIMEOUT_MS, 12_000),
      fetchMaxBytes: readInt(env.RESEARCH_FETCH_MAX_BYTES, 5 * 1024 * 1024),
      maxExtractedChars: readInt(env.RESEARCH_MAX_EXTRACTED_CHARS, 18_000),
      maxPages: readInt(env.RESEARCH_MAX_PAGES, 18),
      fetchConcurrency: readInt(env.RESEARCH_FETCH_CONCURRENCY, 3),
      maxRounds: readInt(env.RESEARCH_MAX_ROUNDS, 5),
      minRounds: readInt(env.RESEARCH_MIN_ROUNDS, 2),
      maxEmptyRounds: readInt(env.RESEARCH_MAX_EMPTY_ROUNDS, 2),
      maxUrlsPerRound: readInt(env.RESEARCH_MAX_URLS_PER_ROUND, 4),
      initialQueries: readInt(env.RESEARCH_INITIAL_QUERIES, 4),
      followupQueries: readInt(env.RESEARCH_FOLLOWUP_QUERIES, 3),
      searchResultsPerQuery: readInt(env.RESEARCH_SEARCH_RESULTS, 10),
      extractMaxTokens: readInt(env.RESEARCH_EXTRACT_MAX_TOKENS, 1200),
      synthesisMaxTokens: readInt(env.RESEARCH_SYNTHESIS_MAX_TOKENS, 6000),
      finalMaxTokens: readInt(env.RESEARCH_FINAL_MAX_TOKENS, 25_000),
      minSources: readInt(env.RESEARCH_MIN_SOURCES, 3)
    }
  };
}

export function configuredServices(config) {
  return {
    crof: Boolean(config.serverApiKey),
    openrouter: Boolean(config.providers?.openrouter?.apiKey),
    speech: Boolean(config.speech?.apiKey),
    supabase: Boolean(config.supabase.url && config.supabase.anonKey && config.supabase.serviceRoleKey),
    access: config.access.mode === "testing" || config.access.mode === "subscription",
    r2: Boolean(config.r2.endpoint && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket),
    websearch: Boolean(config.websearch.searxng?.baseUrl || config.websearch.jina?.apiKey || config.websearch.brave?.apiKey),
    weather: Boolean(config.weather?.apiKey),
    documents: Boolean(config.documents.enabled && config.supabase.url && config.supabase.serviceRoleKey && config.r2.endpoint && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket),
    research: Boolean(config.research?.enabled && config.websearch?.searxng?.baseUrl && config.supabase.url && config.supabase.serviceRoleKey && config.providers?.openrouter?.apiKey)
  };
}

export function validateRuntimeConfig(config) {
  if ((config.desktop?.chatEnabled || config.desktop?.sttEnabled) && config.desktop?.meteringMode !== "enforce") {
    throw new Error("API_USAGE_METERING_MODE must be enforce before enabling desktop chat or STT.");
  }
  if (config.desktop?.meteringMode === "enforce") {
    if (!(config.desktop.chatReservationCredits > 0)) {
      throw new Error("DESKTOP_CHAT_RESERVATION_CREDITS must be positive when API_USAGE_METERING_MODE=enforce.");
    }
    const requiredDesktopReservation = (
      (config.desktop.maxInputTokens * config.desktop.maxPromptPricePerMillion)
      + (config.desktop.maxCompletionTokens * config.desktop.maxCompletionPricePerMillion)
    ) / 1_000_000;
    if (config.desktop.chatReservationCredits + Number.EPSILON < requiredDesktopReservation) {
      throw new Error(
        `DESKTOP_CHAT_RESERVATION_CREDITS must be at least ${requiredDesktopReservation.toFixed(6)} `
        + "for the configured desktop token and OpenRouter price ceilings."
      );
    }
    if (config.speech?.apiKey && !(config.speech.creditsPerSecond > 0)) {
      throw new Error("SARVAM_STT_CREDITS_PER_SECOND must be positive when metering is enforced and Sarvam is enabled.");
    }
  }
  if ((config.desktop?.chatEnabled || config.desktop?.sttEnabled) && !config.desktop.oauthEnabled) {
    throw new Error("DESKTOP_OAUTH_ENABLED must be true before enabling desktop chat or STT.");
  }
  if ((config.desktop?.chatEnabled || config.desktop?.sttEnabled) && !config.desktop?.betaAccountIds?.length) {
    throw new Error("DESKTOP_BETA_ACCOUNT_IDS must list canonical account UUIDs before enabling desktop chat or STT. Use * only for an intentional all-paid-plan rollout.");
  }
  if (config.desktop?.betaAccountIds?.some((id) => id !== "*" && !ACCOUNT_ID_PATTERN.test(id))) {
    throw new Error("DESKTOP_BETA_ACCOUNT_IDS must contain only canonical account UUIDs or *.");
  }
  if (config.desktop?.oauthEnabled && !(config.supabase?.url && config.supabase?.anonKey && config.supabase?.serviceRoleKey && config.desktop.clients?.["klui-desktop-windows"]?.providerClientId)) {
    throw new Error("Desktop OAuth requires Supabase URL/keys and SUPABASE_OAUTH_DESKTOP_WINDOWS_CLIENT_ID.");
  }
  if (config.desktop?.chatEnabled && !config.providers?.openrouter?.apiKey) {
    throw new Error("OPENROUTER_API_KEY is required when desktop chat is enabled.");
  }
  if (config.desktop?.sttEnabled && !config.speech?.apiKey) {
    throw new Error("SARVAM_API_KEY is required when desktop STT is enabled.");
  }
  return config;
}

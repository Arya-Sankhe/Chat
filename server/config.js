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
    r2: {
      accountId: r2AccountId,
      accessKeyId: clean(env.R2_ACCESS_KEY_ID),
      secretAccessKey: clean(env.R2_SECRET_ACCESS_KEY),
      bucket: clean(env.R2_BUCKET),
      endpoint: cleanUrl(env.R2_ENDPOINT) || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : ""),
      uploadExpiresSeconds: readInt(env.R2_UPLOAD_EXPIRES_SECONDS, 300),
      readExpiresSeconds: readInt(env.R2_READ_EXPIRES_SECONDS, 900),
      maxImageBytes: readInt(env.R2_MAX_IMAGE_BYTES, 6 * 1024 * 1024)
    }
  };
}

export function configuredServices(config) {
  return {
    crof: Boolean(config.serverApiKey),
    supabase: Boolean(config.supabase.url && config.supabase.anonKey && config.supabase.serviceRoleKey),
    access: config.access.mode === "testing" || config.access.mode === "subscription",
    r2: Boolean(config.r2.endpoint && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket)
  };
}

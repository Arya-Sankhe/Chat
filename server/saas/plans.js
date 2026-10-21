import { withProcessingFee } from "./mamo.js";

const PLAN_DEFAULTS = [
  {
    id: "lite",
    // Keep the stored ID so existing subscriptions and usage retain their allowances.
    name: "Plus",
    description: "Simple access for light everyday use.",
    priceLabel: "15 AED / month",
    amountAed: 15,
    monthlyApiCreditLimit: 1.36,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentFileBytes: 150 * 1024 * 1024,
    maxDocumentBytesPerMessage: 150 * 1024 * 1024,
    maxDocumentPages: 150,
    maxProjectBytes: 750 * 1024 * 1024,
    maxStorageBytes: 750 * 1024 * 1024,
    sortOrder: 10
  },
  {
    id: "pro",
    name: "Pro",
    description: "Everyday model access for regular users.",
    priceLabel: "30 AED / month",
    amountAed: 30,
    monthlyApiCreditLimit: 5.44,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentFileBytes: 150 * 1024 * 1024,
    maxDocumentBytesPerMessage: 150 * 1024 * 1024,
    maxDocumentPages: 150,
    maxProjectBytes: 750 * 1024 * 1024,
    maxStorageBytes: Math.ceil(2.5 * 1024 * 1024 * 1024),
    sortOrder: 20
  },
  {
    id: "max",
    name: "Max",
    active: false,
    description: "Higher capacity for heavier workflows.",
    priceLabel: "50 AED / month",
    amountAed: 50,
    monthlyApiCreditLimit: 8.16,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentFileBytes: 150 * 1024 * 1024,
    maxDocumentBytesPerMessage: 150 * 1024 * 1024,
    maxDocumentPages: 150,
    maxProjectBytes: 750 * 1024 * 1024,
    maxStorageBytes: 5 * 1024 * 1024 * 1024,
    sortOrder: 30
  }
];

function envName(planId, suffix) {
  return `PLAN_${planId.toUpperCase()}_${suffix}`;
}

function clean(value) {
  return String(value || "").trim();
}

function readInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

// Signed-in accounts without a subscription. Never sold or listed with the paid plans:
// Think chat and images only, counted per Dubai day (see freePlan.js).
const FREE_PLAN_DEFAULT = {
  id: "free",
  name: "Free",
  free: true,
  description: "Think chat with image uploads.",
  priceLabel: "Free",
  amountAed: 0,
  // A spend backstop for unusually long chats; the daily counts are the real limit.
  monthlyApiCreditLimit: 1.36,
  dailyMessageLimit: 15,
  dailyImageLimit: 5,
  maxImagesPerMessage: 4,
  maxDocumentsPerMessage: 0,
  maxDocumentFileBytes: 0,
  maxDocumentBytesPerMessage: 0,
  maxDocumentPages: 0,
  maxProjectBytes: 0,
  maxStorageBytes: 750 * 1024 * 1024,
  sortOrder: 0
};

export function loadFreePlan(env = process.env) {
  if (clean(env.FREE_PLAN_ENABLED).toLowerCase() === "false") return null;
  return {
    ...FREE_PLAN_DEFAULT,
    dailyMessageLimit: readInt(env.FREE_DAILY_MESSAGES, FREE_PLAN_DEFAULT.dailyMessageLimit),
    dailyImageLimit: readInt(env.FREE_DAILY_IMAGES, FREE_PLAN_DEFAULT.dailyImageLimit)
  };
}

export function loadPlans(env = process.env) {
  return PLAN_DEFAULTS.map((plan) => ({
    ...plan,
    priceLabel: clean(env[envName(plan.id, "PRICE_LABEL")]) || plan.priceLabel,
    amountAed: Number(clean(env[envName(plan.id, "AMOUNT_AED")])) > 0
      ? Number(clean(env[envName(plan.id, "AMOUNT_AED")]))
      : plan.amountAed,
    ziinaPaymentUrl: clean(env[envName(plan.id, "ZIINA_PAYMENT_URL")]),
    ziinaQrImageUrl: clean(env[envName(plan.id, "ZIINA_QR_IMAGE_URL")]),
    monthlyApiCreditLimit: Number(clean(env[envName(plan.id, "MONTHLY_API_CREDITS")])) > 0
      ? Number(clean(env[envName(plan.id, "MONTHLY_API_CREDITS")]))
      : plan.monthlyApiCreditLimit,
    maxImagesPerMessage: readInt(env[envName(plan.id, "MAX_IMAGES_PER_MESSAGE")], plan.maxImagesPerMessage),
    maxDocumentsPerMessage: readInt(env[envName(plan.id, "MAX_DOCUMENTS_PER_MESSAGE")], plan.maxDocumentsPerMessage),
    maxDocumentFileBytes: readInt(env[envName(plan.id, "MAX_DOCUMENT_FILE_BYTES")], plan.maxDocumentFileBytes),
    maxDocumentBytesPerMessage: readInt(env[envName(plan.id, "MAX_DOCUMENT_BYTES_PER_MESSAGE")], plan.maxDocumentBytesPerMessage),
    maxDocumentPages: readInt(env[envName(plan.id, "MAX_DOCUMENT_PAGES")], plan.maxDocumentPages),
    maxProjectBytes: readInt(env[envName(plan.id, "MAX_PROJECT_BYTES")], plan.maxProjectBytes),
    maxStorageBytes: readInt(env[envName(plan.id, "MAX_STORAGE_BYTES")], plan.maxStorageBytes)
  })).sort((a, b) => a.sortOrder - b.sortOrder);
}

// With Mamo, `chargeAed` is the monthly card charge: the plan price plus Mamo's processing fee.
export function publicPlan(plan, mamoEnabled, fees = null) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceLabel: plan.priceLabel,
    amountAed: plan.amountAed,
    chargeAed: mamoEnabled ? withProcessingFee(plan.amountAed, fees) : plan.amountAed,
    currency: "AED",
    ziinaPaymentUrl: plan.ziinaPaymentUrl,
    ziinaQrImageUrl: plan.ziinaQrImageUrl,
    checkout: mamoEnabled ? "mamo" : (plan.ziinaPaymentUrl || plan.ziinaQrImageUrl ? "ziina" : "none"),
    monthlyApiCreditLimit: plan.monthlyApiCreditLimit,
    maxImagesPerMessage: plan.maxImagesPerMessage,
    maxDocumentsPerMessage: plan.maxDocumentsPerMessage,
    maxDocumentFileBytes: plan.maxDocumentFileBytes,
    maxDocumentBytesPerMessage: plan.maxDocumentBytesPerMessage,
    maxDocumentPages: plan.maxDocumentPages,
    maxProjectBytes: plan.maxProjectBytes,
    maxStorageBytes: plan.maxStorageBytes,
    ...(plan.free ? { free: true, dailyMessageLimit: plan.dailyMessageLimit, dailyImageLimit: plan.dailyImageLimit } : {})
  };
}

export function findPlanById(plans, id) {
  return plans.find((plan) => plan.id === id);
}

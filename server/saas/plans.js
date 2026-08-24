const PLAN_DEFAULTS = [
  {
    id: "lite",
    name: "Lite",
    description: "Simple access for light everyday use.",
    priceLabel: "10 AED / month",
    amountAed: 10,
    monthlyApiCreditLimit: 1.36,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentFileBytes: 50 * 1024 * 1024,
    maxDocumentBytesPerMessage: 50 * 1024 * 1024,
    maxDocumentPages: 50,
    maxProjectBytes: 50 * 1024 * 1024,
    maxStorageBytes: 750 * 1024 * 1024,
    sortOrder: 10
  },
  {
    id: "pro",
    name: "Pro",
    description: "Everyday model access for regular users.",
    priceLabel: "30 AED / month",
    amountAed: 30,
    monthlyApiCreditLimit: 4.08,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentFileBytes: 70 * 1024 * 1024,
    maxDocumentBytesPerMessage: 100 * 1024 * 1024,
    maxDocumentPages: 100,
    maxProjectBytes: 100 * 1024 * 1024,
    maxStorageBytes: Math.ceil(2.5 * 1024 * 1024 * 1024),
    sortOrder: 20
  },
  {
    id: "max",
    name: "Max",
    description: "Higher capacity for heavier workflows.",
    priceLabel: "50 AED / month",
    amountAed: 50,
    monthlyApiCreditLimit: 8.16,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentFileBytes: 100 * 1024 * 1024,
    maxDocumentBytesPerMessage: 100 * 1024 * 1024,
    maxDocumentPages: 100,
    maxProjectBytes: 150 * 1024 * 1024,
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

export function loadPlans(env = process.env) {
  return PLAN_DEFAULTS.map((plan) => ({
    ...plan,
    priceLabel: clean(env[envName(plan.id, "PRICE_LABEL")]) || plan.priceLabel,
    amountAed: Number(clean(env[envName(plan.id, "AMOUNT_AED")])) > 0
      ? Number(clean(env[envName(plan.id, "AMOUNT_AED")]))
      : plan.amountAed,
    ziinaPaymentUrl: clean(env[envName(plan.id, "ZIINA_PAYMENT_URL")]),
    ziinaQrImageUrl: clean(env[envName(plan.id, "ZIINA_QR_IMAGE_URL")]),
    mamoSubscriptionId: clean(env[envName(plan.id, "MAMO_SUBSCRIPTION_ID")]),
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

export function publicPlan(plan, mamoEnabled) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceLabel: plan.priceLabel,
    amountAed: plan.amountAed,
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
    maxStorageBytes: plan.maxStorageBytes
  };
}

export function findPlanById(plans, id) {
  return plans.find((plan) => plan.id === id);
}

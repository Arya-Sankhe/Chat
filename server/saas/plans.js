const PLAN_DEFAULTS = [
  {
    id: "lite",
    name: "Lite",
    description: "Simple access for light everyday use.",
    priceLabel: "10 AED / month",
    amountAed: 10,
    monthlyApiCreditLimit: 2,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentBytesPerMessage: 30 * 1024 * 1024,
    maxDocumentPages: 50,
    maxProjectBytes: 50 * 1024 * 1024,
    sortOrder: 10
  },
  {
    id: "essential",
    name: "Essential",
    description: "Everyday model access for regular users.",
    priceLabel: "30 AED / month",
    amountAed: 30,
    monthlyApiCreditLimit: 10,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentBytesPerMessage: 60 * 1024 * 1024,
    maxDocumentPages: 100,
    maxProjectBytes: 100 * 1024 * 1024,
    sortOrder: 20
  },
  {
    id: "pro",
    name: "Pro",
    description: "Higher capacity for heavier workflows.",
    priceLabel: "50 AED / month",
    amountAed: 50,
    monthlyApiCreditLimit: 25,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentBytesPerMessage: 60 * 1024 * 1024,
    maxDocumentPages: 100,
    maxProjectBytes: 150 * 1024 * 1024,
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
    monthlyApiCreditLimit: Number(clean(env[envName(plan.id, "MONTHLY_API_CREDITS")])) > 0
      ? Number(clean(env[envName(plan.id, "MONTHLY_API_CREDITS")]))
      : plan.monthlyApiCreditLimit,
    maxImagesPerMessage: readInt(env[envName(plan.id, "MAX_IMAGES_PER_MESSAGE")], plan.maxImagesPerMessage),
    maxDocumentsPerMessage: readInt(env[envName(plan.id, "MAX_DOCUMENTS_PER_MESSAGE")], plan.maxDocumentsPerMessage),
    maxDocumentBytesPerMessage: readInt(env[envName(plan.id, "MAX_DOCUMENT_BYTES_PER_MESSAGE")], plan.maxDocumentBytesPerMessage),
    maxDocumentPages: readInt(env[envName(plan.id, "MAX_DOCUMENT_PAGES")], plan.maxDocumentPages),
    maxProjectBytes: readInt(env[envName(plan.id, "MAX_PROJECT_BYTES")], plan.maxProjectBytes)
  })).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function publicPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceLabel: plan.priceLabel,
    amountAed: plan.amountAed,
    currency: "AED",
    ziinaPaymentUrl: plan.ziinaPaymentUrl,
    ziinaQrImageUrl: plan.ziinaQrImageUrl,
    monthlyApiCreditLimit: plan.monthlyApiCreditLimit,
    maxImagesPerMessage: plan.maxImagesPerMessage,
    maxDocumentsPerMessage: plan.maxDocumentsPerMessage,
    maxDocumentBytesPerMessage: plan.maxDocumentBytesPerMessage,
    maxDocumentPages: plan.maxDocumentPages,
    maxProjectBytes: plan.maxProjectBytes
  };
}

export function findPlanById(plans, id) {
  return plans.find((plan) => plan.id === id);
}

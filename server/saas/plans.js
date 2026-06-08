const PLAN_DEFAULTS = [
  {
    id: "hobby",
    name: "Hobby",
    description: "Light personal chat usage.",
    priceLabel: "Testing access",
    monthlyApiCreditLimit: 2,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentBytesPerMessage: 30 * 1024 * 1024,
    maxDocumentPages: 50,
    sortOrder: 10
  },
  {
    id: "pro",
    name: "Pro",
    description: "Everyday model access for regular users.",
    priceLabel: "Testing access",
    monthlyApiCreditLimit: 10,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentBytesPerMessage: 60 * 1024 * 1024,
    maxDocumentPages: 100,
    sortOrder: 20
  },
  {
    id: "intermediate",
    name: "Intermediate",
    description: "Higher daily capacity for heavier workflows.",
    priceLabel: "Testing access",
    monthlyApiCreditLimit: 25,
    maxImagesPerMessage: 4,
    maxDocumentsPerMessage: 5,
    maxDocumentBytesPerMessage: 60 * 1024 * 1024,
    maxDocumentPages: 100,
    sortOrder: 30
  },
  {
    id: "scale",
    name: "Scale",
    description: "Large-volume chat and image usage.",
    priceLabel: "Testing access",
    monthlyApiCreditLimit: 75,
    maxImagesPerMessage: 6,
    maxDocumentsPerMessage: 5,
    maxDocumentBytesPerMessage: 100 * 1024 * 1024,
    maxDocumentPages: 100,
    sortOrder: 40
  },
  {
    id: "max",
    name: "Max",
    description: "Highest managed Klui limits.",
    priceLabel: "Testing access",
    monthlyApiCreditLimit: 200,
    maxImagesPerMessage: 8,
    maxDocumentsPerMessage: 5,
    maxDocumentBytesPerMessage: 100 * 1024 * 1024,
    maxDocumentPages: 100,
    sortOrder: 50
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
    monthlyApiCreditLimit: Number(clean(env[envName(plan.id, "MONTHLY_API_CREDITS")])) > 0
      ? Number(clean(env[envName(plan.id, "MONTHLY_API_CREDITS")]))
      : plan.monthlyApiCreditLimit,
    maxImagesPerMessage: readInt(env[envName(plan.id, "MAX_IMAGES_PER_MESSAGE")], plan.maxImagesPerMessage),
    maxDocumentsPerMessage: readInt(env[envName(plan.id, "MAX_DOCUMENTS_PER_MESSAGE")], plan.maxDocumentsPerMessage),
    maxDocumentBytesPerMessage: readInt(env[envName(plan.id, "MAX_DOCUMENT_BYTES_PER_MESSAGE")], plan.maxDocumentBytesPerMessage),
    maxDocumentPages: readInt(env[envName(plan.id, "MAX_DOCUMENT_PAGES")], plan.maxDocumentPages)
  })).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function publicPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceLabel: plan.priceLabel,
    monthlyApiCreditLimit: plan.monthlyApiCreditLimit,
    maxImagesPerMessage: plan.maxImagesPerMessage,
    maxDocumentsPerMessage: plan.maxDocumentsPerMessage,
    maxDocumentBytesPerMessage: plan.maxDocumentBytesPerMessage,
    maxDocumentPages: plan.maxDocumentPages
  };
}

export function findPlanById(plans, id) {
  return plans.find((plan) => plan.id === id);
}

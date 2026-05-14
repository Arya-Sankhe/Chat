const PLAN_DEFAULTS = [
  {
    id: "hobby",
    name: "Hobby",
    description: "Light personal chat usage.",
    priceLabel: "Testing access",
    dailyMessageLimit: 150,
    monthlyImageLimit: 200,
    maxImagesPerMessage: 4,
    sortOrder: 10
  },
  {
    id: "pro",
    name: "Pro",
    description: "Everyday model access for regular users.",
    priceLabel: "Testing access",
    dailyMessageLimit: 600,
    monthlyImageLimit: 1000,
    maxImagesPerMessage: 4,
    sortOrder: 20
  },
  {
    id: "intermediate",
    name: "Intermediate",
    description: "Higher daily capacity for heavier workflows.",
    priceLabel: "Testing access",
    dailyMessageLimit: 1500,
    monthlyImageLimit: 2500,
    maxImagesPerMessage: 4,
    sortOrder: 30
  },
  {
    id: "scale",
    name: "Scale",
    description: "Large-volume chat and image usage.",
    priceLabel: "Testing access",
    dailyMessageLimit: 5000,
    monthlyImageLimit: 7500,
    maxImagesPerMessage: 6,
    sortOrder: 40
  },
  {
    id: "max",
    name: "Max",
    description: "Highest managed Smartyfy limits.",
    priceLabel: "Testing access",
    dailyMessageLimit: 15000,
    monthlyImageLimit: 20000,
    maxImagesPerMessage: 8,
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
    dailyMessageLimit: readInt(env[envName(plan.id, "DAILY_MESSAGES")], plan.dailyMessageLimit),
    monthlyImageLimit: readInt(env[envName(plan.id, "MONTHLY_IMAGES")], plan.monthlyImageLimit),
    maxImagesPerMessage: readInt(env[envName(plan.id, "MAX_IMAGES_PER_MESSAGE")], plan.maxImagesPerMessage)
  })).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function publicPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceLabel: plan.priceLabel,
    dailyMessageLimit: plan.dailyMessageLimit,
    monthlyImageLimit: plan.monthlyImageLimit,
    maxImagesPerMessage: plan.maxImagesPerMessage
  };
}

export function findPlanById(plans, id) {
  return plans.find((plan) => plan.id === id);
}

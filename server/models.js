import {
  OPENROUTER_COUNCIL_HY3_MODEL,
  OPENROUTER_COUNCIL_MIMO_PRO_MODEL,
  OPENROUTER_NITRO_MODEL,
  OPENROUTER_PRO_FALLBACK_MODEL,
  OPENROUTER_PRO_MODEL,
  OPENROUTER_TEXT_MODEL,
  OPENROUTER_VISION_L2,
  OPENROUTER_VISION_MODEL
} from "./providers.js";

export const MODEL_ROUTES = Object.freeze({
  nitro: {
    label: "Nitro",
    group: "single",
    model: OPENROUTER_NITRO_MODEL,
    effort: "high"
  },
  think: {
    label: "Think",
    group: "single",
    model: OPENROUTER_TEXT_MODEL,
    effort: "xhigh",
    visionModel: OPENROUTER_VISION_MODEL
  },
  pro: {
    label: "Pro",
    group: "single",
    model: OPENROUTER_PRO_MODEL,
    effort: "xhigh",
    fallback: OPENROUTER_PRO_FALLBACK_MODEL
  },
  compare: {
    label: "Compare",
    group: "multi",
    models: [OPENROUTER_TEXT_MODEL, OPENROUTER_VISION_MODEL],
    mediaModels: [OPENROUTER_VISION_MODEL, OPENROUTER_VISION_L2]
  },
  council: {
    label: "Council",
    group: "multi",
    panel: [
      { model: OPENROUTER_TEXT_MODEL, label: "DeepSeek" },
      { model: OPENROUTER_COUNCIL_HY3_MODEL, label: "Hy3" },
      { model: OPENROUTER_VISION_MODEL, label: "MiMo" },
      { model: OPENROUTER_COUNCIL_MIMO_PRO_MODEL, label: "MiMo Pro" }
    ]
  }
});

export const CHAT_ROLES = Object.freeze(Object.keys(MODEL_ROUTES));

export const LEGACY_ROLE_ALIASES = Object.freeze({
  "poolside/laguna-xs-2.1": "nitro",
  "inclusionai/ling-3.0-flash": "nitro",
  "deepseek/deepseek-v4-flash": "think",
  "deepseek/deepseek-v4-flash-0731": "think",
  "xiaomi/mimo-v2.5": "think",
  "openai/gpt-5.6-luna": "pro"
});

const LEGACY_MODEL_IDS = Object.freeze({
  "deepseek/deepseek-v4-pro": OPENROUTER_COUNCIL_HY3_MODEL
});

const ROLE_IDS = new Set(CHAT_ROLES);

export function isChatRole(value) {
  return ROLE_IDS.has(String(value || "").trim().toLowerCase());
}

function cleanRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ROLE_IDS.has(role) ? role : "";
}

function truthyFlag(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function compareListLength(value) {
  if (!Array.isArray(value)) return 0;
  return value.filter((item) => typeof item === "string" && item.trim()).length;
}

export function modelsForRole(role, { hasMedia = false } = {}) {
  const route = MODEL_ROUTES[role];
  if (!route) return [];
  if (role === "council") return route.panel.map((panelist) => panelist.model);
  if (role === "compare") return (hasMedia ? route.mediaModels : route.models).slice();
  if (hasMedia && route.visionModel) return [route.visionModel];
  return route.model ? [route.model] : [];
}

export function resolveChatRole({
  role,
  model,
  models,
  council,
  hasMedia = false
} = {}) {
  let resolved = cleanRole(role);
  if (!resolved && truthyFlag(council)) resolved = "council";
  if (!resolved && compareListLength(models) >= 2) resolved = "compare";

  const rawModel = String(model || "").trim();
  if (!resolved && rawModel.includes(",")) {
    const parts = rawModel.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 4) resolved = "council";
    else if (parts.length >= 2) resolved = "compare";
  }
  if (!resolved && rawModel) {
    resolved = cleanRole(rawModel) || LEGACY_ROLE_ALIASES[rawModel] || "";
  }
  if (resolved === "nitro" && hasMedia) resolved = "think";

  if (resolved) {
    return {
      role: resolved,
      models: modelsForRole(resolved, { hasMedia }),
      effort: MODEL_ROUTES[resolved].effort || null
    };
  }

  if (rawModel) {
    return {
      role: null,
      models: [LEGACY_MODEL_IDS[rawModel] || rawModel],
      effort: null
    };
  }

  return {
    role: "think",
    models: modelsForRole("think", { hasMedia }),
    effort: MODEL_ROUTES.think.effort
  };
}

export function publicChatRoles() {
  return CHAT_ROLES.map((id) => {
    const route = MODEL_ROUTES[id];
    const item = { id, label: route.label, group: route.group };
    if (id === "council") item.panelists = route.panel.map((panelist) => panelist.label);
    return item;
  });
}

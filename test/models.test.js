import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CHAT_ROLES,
  LEGACY_ROLE_ALIASES,
  MODEL_ROUTES,
  publicChatRoles,
  resolveChatRole
} from "../server/models.js";
import {
  OPENROUTER_COUNCIL_HY3_MODEL,
  OPENROUTER_NITRO_MODEL,
  OPENROUTER_PRO_MODEL,
  OPENROUTER_TEXT_MODEL,
  OPENROUTER_VISION_L2,
  OPENROUTER_VISION_MODEL
} from "../server/providers.js";

const here = dirname(fileURLToPath(import.meta.url));

test("resolveChatRole maps product roles to the current MODEL_ROUTES models", () => {
  assert.deepEqual(resolveChatRole({ role: "nitro" }), {
    role: "nitro",
    models: [OPENROUTER_NITRO_MODEL],
    effort: "high"
  });
  assert.deepEqual(resolveChatRole({ role: "think" }), {
    role: "think",
    models: [OPENROUTER_TEXT_MODEL],
    effort: "xhigh"
  });
  assert.deepEqual(resolveChatRole({ role: "pro" }), {
    role: "pro",
    models: [OPENROUTER_PRO_MODEL],
    effort: "xhigh"
  });
  assert.deepEqual(resolveChatRole({ role: "compare" }).models, [
    OPENROUTER_TEXT_MODEL,
    OPENROUTER_VISION_MODEL
  ]);
  assert.deepEqual(resolveChatRole({ role: "compare", hasMedia: true }).models, [
    OPENROUTER_VISION_MODEL,
    OPENROUTER_VISION_L2
  ]);
  assert.equal(resolveChatRole({ role: "council" }).models.length, 4);
  assert.equal(resolveChatRole({ role: "think", hasMedia: true }).models[0], OPENROUTER_VISION_MODEL);
  assert.equal(resolveChatRole({ role: "nitro", hasMedia: true }).role, "think");
});

test("legacy Android model IDs alias to roles, then to current models", () => {
  const cases = [
    ["poolside/laguna-xs-2.1", "nitro", OPENROUTER_NITRO_MODEL],
    ["inclusionai/ling-3.0-flash", "nitro", OPENROUTER_NITRO_MODEL],
    ["deepseek/deepseek-v4-flash", "think", OPENROUTER_TEXT_MODEL],
    ["deepseek/deepseek-v4-flash-0731", "think", OPENROUTER_TEXT_MODEL],
    ["openai/gpt-5.6-luna", "pro", OPENROUTER_PRO_MODEL]
  ];
  for (const [model, role, expected] of cases) {
    const routed = resolveChatRole({ model });
    assert.equal(routed.role, role, model);
    assert.equal(routed.models[0], expected, model);
    assert.equal(LEGACY_ROLE_ALIASES[model], role, model);
  }
});

test("old council panelist IDs and council/compare flags still resolve", () => {
  assert.deepEqual(resolveChatRole({ model: "deepseek/deepseek-v4-pro" }), {
    role: null,
    models: [OPENROUTER_COUNCIL_HY3_MODEL],
    effort: null
  });
  assert.equal(resolveChatRole({ council: true, models: ["stale-a", "stale-b"] }).role, "council");
  assert.equal(resolveChatRole({ models: ["stale-a", "stale-b"] }).role, "compare");
  assert.equal(resolveChatRole({ model: "think,compare-left-over" }).role, "compare");
});

test("public chat roles expose labels without vendor IDs", () => {
  const roles = publicChatRoles();
  assert.deepEqual(roles.map((role) => role.id), CHAT_ROLES);
  assert.deepEqual(roles.map((role) => role.id), ["nitro", "think", "pro", "compare", "council"]);
  assert.ok(roles.find((role) => role.id === "council").panelists.includes("DeepSeek"));
  const json = JSON.stringify(roles);
  assert.doesNotMatch(json, /openrouter|deepseek\/|openai\/|inclusionai\/|xiaomi\/|tencent\//);
  assert.equal(MODEL_ROUTES.think.model, OPENROUTER_TEXT_MODEL);
});

test("website send path uses role and does not ship OpenRouter IDs", () => {
  const api = readFileSync(resolve(here, "../public/js/api.js"), "utf8");
  const app = readFileSync(resolve(here, "../public/js/app.js"), "utf8");
  const documentViewer = readFileSync(resolve(here, "../public/js/documentViewer.js"), "utf8");
  const research = readFileSync(resolve(here, "../public/js/research.js"), "utf8");
  const requestSettings = app.match(/function chatRequestSettings\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(app, /function selectedChatRole\(\)/);
  assert.ok(requestSettings);
  assert.doesNotMatch(requestSettings, /\bmodel\b|compareModels|kluiModel|reasoning_effort|thinkingEffort/);
  assert.match(app, /role: selectedChatRole\(\)/);
  assert.match(app, /role: selectedSingleRole\(\)/);
  assert.doesNotMatch(app, /model: effectiveModel/);
  assert.doesNotMatch(app, /models: compareModels/);
  assert.doesNotMatch(app, /settings:\s*\{\s*\.\.\.state\.settings/);
  assert.doesNotMatch(api, /JSON\.stringify\(\{ markdown, selection, instruction, model \}\)/);
  assert.doesNotMatch(documentViewer, /model: state\.activeConversation/);
  assert.match(research, /role: selectedModelMode\(\) === "pro" \? "pro" : "think"/);
  assert.doesNotMatch(research, /OPENROUTER_/);
});

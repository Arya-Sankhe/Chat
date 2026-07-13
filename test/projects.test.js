import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readStylesheet } from "./helpers/styles.js";
import { loadPlans } from "../server/saas/plans.js";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

test("project capacities are source-byte limits per plan", () => {
  const plans = Object.fromEntries(loadPlans({}).map((plan) => [plan.id, plan]));
  assert.equal(plans.lite.maxProjectBytes, 50 * 1024 * 1024);
  assert.equal(plans.essential.maxProjectBytes, 100 * 1024 * 1024);
  assert.equal(plans.pro.maxProjectBytes, 150 * 1024 * 1024);
});

test("Projects reuses the composer and upload path with a backend capacity meter", () => {
  const app = readFileSync(resolve(publicDir, "js/app.js"), "utf8");
  const html = readFileSync(resolve(publicDir, "index.html"), "utf8");
  const css = readStylesheet();
  assert.match(html, /id="projectsButton"/);
  assert.match(html, /id="projectView"/);
  assert.match(html, /id="composerHomeAnchor"/);
  assert.match(app, /createConversation\(state\.session,\s*\{[\s\S]*?projectId: state\.activeProjectId \|\| null/);
  assert.match(app, /presignUpload\(state\.session, file, "document", \{ projectId: state\.activeProjectId \}\)/);
  assert.match(app, /usage\.usedBytes/);
  assert.match(app, /usage\.maxBytes/);
  assert.match(app, /class="project-composer-slot"/);
  assert.match(app, /% of project capacity used/);
  assert.doesNotMatch(app, /formatProjectBytes\(usage\.usedBytes\)/);
  assert.match(app, /const showTempToggle = !state\.projectsOpen/);
  assert.match(app, /state\.conversations\.filter\(\(conversation\) => !conversation\.project_id\)\.sort/);
  assert.match(app, /if \(createdConversation\) renderShell\(\);/);
  assert.match(app, /waitForDocumentReady\(document\.id, document\.fileName\)/);
  assert.match(css, /\.project-capacity-track/);
  assert.match(css, /\.project-detail-layout\s*\{[\s\S]*grid-template-columns/);
  assert.match(css, /\.project-list\s*\{[\s\S]*repeat\(2/);
  assert.match(css, /\.project-composer-slot \.composer-area/);
  assert.doesNotMatch(css, /\.project-composer-slot \.composer\s*\{[\s\S]*?min-height:\s*136px/);
});

test("document citations open in the existing viewer", () => {
  const app = readFileSync(resolve(publicDir, "js/app.js"), "utf8");
  assert.match(app, /entry\?\.type === "document" && entry\.attachment_id/);
  assert.match(app, /data-view-attachment-id=/);
  assert.match(app, /openDocumentViewer\(\{/);
});

test("project lifecycle guards shared sources and clears deleted project chats", () => {
  const app = readFileSync(resolve(publicDir, "js/app.js"), "utf8");
  const pipeline = readFileSync(resolve(here, "..", "server/chat/pipeline.js"), "utf8");
  const uploads = readFileSync(resolve(here, "..", "server/routes/uploads.js"), "utf8");
  assert.match(pipeline, /if \(attachment\.project_id\)[\s\S]*Project knowledge is already available/);
  assert.match(uploads, /projectId && category !== "document"/);
  assert.match(app, /state\.conversations = state\.conversations\.filter\(\(conversation\) => conversation\.project_id !== deletedProjectId\)/);
});

test("schema exposes only the capacity-aware document upload RPC", () => {
  const schema = readFileSync(resolve(here, "..", "supabase/schema.sql"), "utf8");
  const definitions = schema.match(/create or replace function public\.klui_complete_document_upload\(/g) || [];
  assert.equal(definitions.length, 1);
  assert.match(schema, /p_project_max_bytes bigint default null/);
});

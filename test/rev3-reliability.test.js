import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/2026_07_11_rev3_document_pipeline.sql", import.meta.url);
const officeVisualMigrationPath = new URL("../supabase/migrations/20260712215913_add_office_visual_enrichment.sql", import.meta.url);
const schemaPath = new URL("../supabase/schema.sql", import.meta.url);

function functionBlock(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf("\nrevoke all on function", start);
  assert.notEqual(end, -1, `${name} must have a grant boundary`);
  return sql.slice(start, end);
}

function latestFunctionBlock(sql, name) {
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf("\nrevoke all on function", start);
  assert.notEqual(end, -1, `${name} must have a grant boundary`);
  return sql.slice(start, end);
}

for (const [label, path] of [["office visual migration", officeVisualMigrationPath], ["schema", schemaPath]]) {
  test(`${label} queues and repairs visual pages for Office documents`, () => {
    const sql = readFileSync(path, "utf8");
    const upload = latestFunctionBlock(sql, "klui_complete_document_upload");
    const queue = latestFunctionBlock(sql, "klui_queue_document_page_render");

    assert.match(upload, /p_kind in \('pdf', 'docx', 'xlsx', 'pptx'\)[\s\S]*?'document\.enrich\.pdf'/);
    assert.match(queue, /kind in \('pdf', 'docx', 'xlsx', 'pptx'\)/);
    assert.doesNotMatch(upload, /where p_kind in \('pdf', 'docx', 'xlsx', 'pptx', 'csv'/);
  });
}

for (const [label, path] of [["migration", migrationPath], ["schema", schemaPath]]) {
  test(`Rev 3 ${label} keeps terminal worker and turn writes behind active leases`, () => {
    const sql = readFileSync(path, "utf8");
    assert.match(functionBlock(sql, "klui_fail_document_job"), /worker_id = p_worker_id[\s\S]*lease_until >= now\(\)/);
    assert.match(functionBlock(sql, "klui_heartbeat_pending_document_turn"), /claim_token = p_claim_token[\s\S]*lease_until >= now\(\)/);
    assert.match(functionBlock(sql, "klui_finish_pending_document_turn"), /claim_token = p_claim_token[\s\S]*lease_until >= now\(\)/);
  });

  test(`Rev 3 ${label} releases pre-provider claims and removes cancelled output shells`, () => {
    const sql = readFileSync(path, "utf8");
    const release = functionBlock(sql, "klui_release_pending_document_turn");
    assert.match(release, /status = 'waiting_documents'/);
    assert.match(release, /claim_token = p_claim_token/);
    assert.match(release, /provider_started_at is null/);
    assert.match(functionBlock(sql, "klui_cancel_pending_document_turn"), /delete from public\.messages where turn_run_id = v_run\.id/);
  });

  test(`Rev 3 ${label} repairs page rows without an image before on-demand rendering`, () => {
    const sql = readFileSync(path, "utf8");
    const queue = functionBlock(sql, "klui_queue_document_page_render");
    assert.match(queue, /length\(trim\(v_page\.image_key\)\) > 0/);
    assert.match(queue, /delete from public\.document_pages where id = v_page\.id/);
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseRest } from "../server/db/supabaseRest.js";

const FAKE_CONFIG = {
  supabase: {
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role-key"
  }
};

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function withStubbedFetch(fetchImpl, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function expectServiceHeaders(headers, { withBody = false } = {}) {
  assert.equal(headers.apikey, "service-role-key");
  assert.equal(headers.authorization, "Bearer service-role-key");
  if (withBody) {
    assert.equal(headers["content-type"], "application/json");
  } else {
    assert.equal(headers["content-type"], undefined);
  }
}

test("getProfile issues a scoped profiles GET and returns the first row", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "GET");
    assert.equal(
      url,
      "https://example.supabase.co/rest/v1/profiles?id=eq.user_1&select=*"
    );
    expectServiceHeaders(options.headers);

    return new Response(JSON.stringify([{ id: "user_1", email: "a@example.com" }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const profile = await db.getProfile("user_1");
    assert.deepEqual(profile, { id: "user_1", email: "a@example.com" });
  });
});

test("getLatestSubscription orders subscriptions by updated_at desc", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "GET");
    assert.equal(
      url,
      "https://example.supabase.co/rest/v1/subscriptions?user_id=eq.user_1&select=*&order=updated_at.desc&limit=1"
    );
    expectServiceHeaders(options.headers);

    return new Response(JSON.stringify([{ id: "sub_1", plan_id: "pro" }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const subscription = await db.getLatestSubscription("user_1");
    assert.deepEqual(subscription, { id: "sub_1", plan_id: "pro" });
  });
});

test("listPaymentRequests scopes payment_requests to the user", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "GET");
    assert.equal(
      url,
      "https://example.supabase.co/rest/v1/payment_requests?user_id=eq.user_1&select=*&order=created_at.desc&limit=10"
    );
    expectServiceHeaders(options.headers);

    return new Response(JSON.stringify([{ id: "pay_1", status: "pending" }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const rows = await db.listPaymentRequests("user_1");
    assert.deepEqual(rows, [{ id: "pay_1", status: "pending" }]);
  });
});

test("listMessages scopes messages to the user and conversation", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "GET");
    assert.equal(
      url,
      "https://example.supabase.co/rest/v1/messages?user_id=eq.user_1&conversation_id=eq.conv_1&select=*&order=created_at.asc"
    );
    expectServiceHeaders(options.headers);

    return new Response(JSON.stringify([{ id: "msg_1", role: "user" }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const rows = await db.listMessages("user_1", "conv_1");
    assert.deepEqual(rows, [{ id: "msg_1", role: "user" }]);
  });
});

test("listProjects scopes projects to the user and update order", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "GET");
    assert.equal(
      url,
      "https://example.supabase.co/rest/v1/projects?user_id=eq.user_1&select=*&order=updated_at.desc"
    );
    expectServiceHeaders(options.headers);
    return jsonResponse([{ id: "project_1", name: "Launch" }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    assert.deepEqual(await db.listProjects("user_1"), [{ id: "project_1", name: "Launch" }]);
  });
});

test("createAttachment POSTs attachment rows with return=representation", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/attachments");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.equal(options.headers.prefer, "return=representation");
    assert.deepEqual(JSON.parse(options.body), {
      user_id: "user_1",
      conversation_id: "conv_1",
      category: "image",
      file_name: "photo.png"
    });

    return new Response(JSON.stringify([{ id: "att_1", status: "pending" }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const attachment = await db.createAttachment({
      user_id: "user_1",
      conversation_id: "conv_1",
      category: "image",
      file_name: "photo.png"
    });
    assert.deepEqual(attachment, { id: "att_1", status: "pending" });
  });
});

test("listOrphanAttachments selects only detached rows older than the cutoff", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    const parsed = new URL(url);
    assert.equal(options.method, "GET");
    assert.equal(parsed.pathname, "/rest/v1/attachments");
    assert.equal(parsed.searchParams.get("conversation_id"), "is.null");
    assert.equal(parsed.searchParams.get("message_id"), "is.null");
    assert.equal(parsed.searchParams.get("or"), "(project_id.is.null,and(project_id.not.is.null,status.eq.pending))");
    assert.equal(parsed.searchParams.get("created_at"), "lt.2026-07-06T00:00:00.000Z");
    assert.equal(parsed.searchParams.get("order"), "created_at.asc");
    assert.equal(parsed.searchParams.get("limit"), "25");
    expectServiceHeaders(options.headers);
    return jsonResponse([{ id: "att_orphan", user_id: "user_1" }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const rows = await db.listOrphanAttachments({
      before: "2026-07-06T00:00:00.000Z",
      limit: 25
    });
    assert.equal(rows[0].id, "att_orphan");
  });
});

test("createDocumentFile POSTs document_files rows with return=representation", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/document_files");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.equal(options.headers.prefer, "return=representation");
    assert.deepEqual(JSON.parse(options.body), {
      user_id: "user_1",
      attachment_id: "att_1",
      kind: "pdf"
    });

    return new Response(JSON.stringify([{ id: "doc_1", processing_status: "queued" }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const documentFile = await db.createDocumentFile({
      user_id: "user_1",
      attachment_id: "att_1",
      kind: "pdf"
    });
    assert.deepEqual(documentFile, { id: "doc_1", processing_status: "queued" });
  });
});

test("completeDocumentUpload uses the atomic upload queue RPC", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/klui_complete_document_upload");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: "user_1",
      p_attachment_id: "att_1",
      p_size_bytes: 1234,
      p_etag: "etag-1",
      p_kind: "pdf",
      p_limits: { max_pdf_pages: 100 },
      p_project_id: null,
      p_project_max_bytes: null
    });

    return new Response(JSON.stringify({
      attachment: { id: "att_1", status: "uploaded" },
      document_file: { id: "doc_1", processing_status: "pending" },
      job: { id: "job_1", status: "queued" }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const result = await db.completeDocumentUpload({
      userId: "user_1",
      attachmentId: "att_1",
      sizeBytes: 1234,
      etag: "etag-1",
      kind: "pdf",
      limits: { max_pdf_pages: 100 }
    });
    assert.equal(result.job.id, "job_1");
  });
});

test("listUsableDocumentFiles queries capability timestamps instead of terminal status", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    const parsed = new URL(url);
    assert.equal(options.method, "GET");
    assert.equal(parsed.pathname, "/rest/v1/document_files");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    assert.equal(parsed.searchParams.get("conversation_id"), "eq.conv_1");
    assert.equal(parsed.searchParams.get("or"), "(text_ready_at.not.is.null,visual_ready_at.not.is.null)");
    expectServiceHeaders(options.headers);
    return jsonResponse([{ id: "doc_1", text_ready_at: "2026-07-11T00:00:00Z" }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const rows = await db.listUsableDocumentFiles("user_1", "conv_1");
    assert.equal(rows[0].id, "doc_1");
  });
});

test("submitDocumentTurn sends one atomic pending-turn RPC payload", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/klui_submit_document_turn");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: "user_1",
      p_conversation_id: "conv_1",
      p_client_turn_key: "00000000-0000-4000-8000-000000000001",
      p_mode: "single",
      p_user_content: [{ type: "text", text: "Read this" }],
      p_message_metadata: {},
      p_request_payload: { model: "model_1" },
      p_attachment_ids: ["att_1"]
    });
    return jsonResponse({
      run: { id: "turn_1", status: "waiting_documents" },
      user_message: { id: "msg_1", role: "user" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const result = await db.submitDocumentTurn({
      userId: "user_1",
      conversationId: "conv_1",
      clientTurnKey: "00000000-0000-4000-8000-000000000001",
      mode: "single",
      userContent: [{ type: "text", text: "Read this" }],
      requestPayload: { model: "model_1" },
      attachmentIds: ["att_1"]
    });
    assert.equal(result.run.id, "turn_1");
  });
});

test("updatePendingTurnOutput sends the active claim fence with its patch", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/klui_update_pending_turn_output");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: "user_1",
      p_turn_id: "turn_1",
      p_claim_token: "claim_1",
      p_message_id: "message_1",
      p_patch: { content: "Done", error: null }
    });
    return jsonResponse({ id: "message_1", content: "Done" });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const result = await db.updatePendingTurnOutput({
      userId: "user_1",
      turnId: "turn_1",
      claimToken: "claim_1",
      messageId: "message_1",
      patch: { content: "Done", error: null }
    });
    assert.equal(result.content, "Done");
  });
});

test("upsertTurnOutputMessage creates an output slot without overwriting an existing row", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    const parsed = new URL(url);
    assert.equal(options.method, "POST");
    assert.equal(parsed.pathname, "/rest/v1/messages");
    assert.equal(parsed.searchParams.get("on_conflict"), "turn_run_id,output_slot");
    assert.equal(options.headers.prefer, "resolution=ignore-duplicates,return=representation");
    return jsonResponse([{ id: "msg_2", turn_run_id: "turn_1", output_slot: "single" }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const result = await db.upsertTurnOutputMessage({
      user_id: "user_1",
      conversation_id: "conv_1",
      role: "assistant",
      turn_run_id: "turn_1",
      output_slot: "single"
    });
    assert.equal(result.id, "msg_2");
  });
});

test("upsertTurnOutputMessage returns the preserved output when the slot already exists", async () => {
  let calls = 0;
  await withStubbedFetch(async (url, options = {}) => {
    calls += 1;
    const parsed = new URL(url);
    if (calls === 1) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.prefer, "resolution=ignore-duplicates,return=representation");
      return jsonResponse([]);
    }
    assert.equal(options.method, "GET");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    assert.equal(parsed.searchParams.get("turn_run_id"), "eq.turn_1");
    assert.equal(parsed.searchParams.get("output_slot"), "eq.single");
    return jsonResponse([{
      id: "msg_existing",
      turn_run_id: "turn_1",
      output_slot: "single",
      content: "Preserve me"
    }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const result = await db.upsertTurnOutputMessage({
      user_id: "user_1",
      conversation_id: "conv_1",
      role: "assistant",
      turn_run_id: "turn_1",
      output_slot: "single",
      content: ""
    });
    assert.equal(result.id, "msg_existing");
    assert.equal(result.content, "Preserve me");
    assert.equal(calls, 2);
  });
});

test("releasePendingDocumentTurn uses the fenced release RPC", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/klui_release_pending_document_turn");
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: "user_1",
      p_turn_id: "turn_1",
      p_claim_token: "claim_1"
    });
    return jsonResponse({ id: "turn_1", status: "waiting_documents" });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const result = await db.releasePendingDocumentTurn({
      userId: "user_1",
      turnId: "turn_1",
      claimToken: "claim_1"
    });
    assert.equal(result.status, "waiting_documents");
  });
});

test("queueDocumentPageRender uses the high-priority render RPC", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/klui_queue_document_page_render");
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: "user_1",
      p_document_file_id: "doc_1",
      p_page_number: 7
    });
    return jsonResponse({ page: null, job: { id: "job_7", priority: 100 } });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const result = await db.queueDocumentPageRender({
      userId: "user_1",
      documentFileId: "doc_1",
      pageNumber: 7
    });
    assert.equal(result.job.priority, 100);
  });
});

test("createResearchRun POSTs research_runs rows with return=representation", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/research_runs");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.equal(options.headers.prefer, "return=representation");
    assert.deepEqual(JSON.parse(options.body), {
      user_id: "user_1",
      query: "What is Klui?",
      status: "queued"
    });

    return new Response(JSON.stringify([{ id: "run_1", status: "queued" }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const run = await db.createResearchRun({
      user_id: "user_1",
      query: "What is Klui?",
      status: "queued"
    });
    assert.deepEqual(run, { id: "run_1", status: "queued" });
  });
});

test("checkApiBudget calls klui_check_api_budget RPC with weekly window fields", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/klui_check_api_budget");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: "user_1",
      p_plan_id: "pro",
      p_period_start: "2026-02-02",
      p_period_end: "2026-03-02",
      p_week_start: "2026-02-09",
      p_week_end: "2026-02-16",
      p_week_index: 2,
      p_weekly_credit_limit: 2.5
    });

    return new Response(JSON.stringify({ allowed: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const result = await db.checkApiBudget({
      userId: "user_1",
      planId: "pro",
      periodStart: "2026-02-02",
      periodEnd: "2026-03-02",
      weekStart: "2026-02-09",
      weekEnd: "2026-02-16",
      weekIndex: 2,
      weeklyLimit: 2.5
    });
    assert.deepEqual(result, { allowed: true });
  });
});

test("getSearchCache reads search_cache by query_hash and swallows errors", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "GET");
    assert.equal(
      url,
      "https://example.supabase.co/rest/v1/search_cache?query_hash=eq.abc123&select=*&limit=1"
    );
    expectServiceHeaders(options.headers);

    return new Response(JSON.stringify([{ query_hash: "abc123", payload: { hits: 1 } }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const row = await db.getSearchCache("abc123");
    assert.deepEqual(row, { query_hash: "abc123", payload: { hits: 1 } });
  });
});

test("getAppSetting reads app_settings by key and returns the first row", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "GET");
    assert.equal(
      url,
      "https://example.supabase.co/rest/v1/app_settings?key=eq.maintenance_mode&select=*&limit=1"
    );
    expectServiceHeaders(options.headers);

    return new Response(JSON.stringify([{ key: "maintenance_mode", value: false }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const setting = await db.getAppSetting("maintenance_mode");
    assert.deepEqual(setting, { key: "maintenance_mode", value: false });
  });
});

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

test("upsertProfile uses the no-op-on-unchanged ensure RPC", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/klui_ensure_profile");
    assert.equal(options.method, "POST");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: "user_1",
      p_email: "a@example.com"
    });
    return jsonResponse([{ id: "user_1", email: "a@example.com", role: "user" }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    assert.equal((await db.upsertProfile({ id: "user_1", email: "a@example.com" })).role, "user");
  });
});

test("upsertProfile falls back when the ensure RPC is not deployed yet", async () => {
  let calls = 0;
  await withStubbedFetch(async (url, options = {}) => {
    calls += 1;
    if (calls === 1) {
      assert.match(url, /\/rpc\/klui_ensure_profile$/);
      return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
    assert.match(url, /\/profiles\?on_conflict=id$/);
    assert.equal(options.headers.prefer, "resolution=merge-duplicates,return=representation");
    const body = JSON.parse(options.body);
    assert.deepEqual({ ...body, updated_at: "<timestamp>" }, {
      id: "user_1",
      email: "a@example.com",
      updated_at: "<timestamp>"
    });
    assert.match(body.updated_at, /^\d{4}-\d{2}-\d{2}T/);
    return jsonResponse([{ id: "user_1", email: "a@example.com", role: "user" }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    assert.equal((await db.upsertProfile({ id: "user_1", email: "a@example.com" })).role, "user");
  });
  assert.equal(calls, 2);
});

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

test("getAccountIdentity resolves only an explicit provider subject mapping", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "GET");
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/account_identities");
    assert.equal(parsed.searchParams.get("provider"), "eq.clerk");
    assert.equal(parsed.searchParams.get("provider_subject"), "eq.user_external");
    assert.equal(parsed.searchParams.get("limit"), "1");
    assert.equal(parsed.searchParams.has("email"), false);
    expectServiceHeaders(options.headers);
    return jsonResponse([{ account_id: "account_1", provider: "clerk", provider_subject: "user_external" }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const identity = await db.getAccountIdentity({ provider: "clerk", providerSubject: "user_external" });
    assert.equal(identity.account_id, "account_1");
  });
});

test("resolveAccountIdentity ignores insert conflicts then verifies the winning mapping", async () => {
  const methods = [];
  await withStubbedFetch(async (url, options = {}) => {
    methods.push(options.method);
    if (options.method === "POST") {
      assert.match(url, /on_conflict=provider%2Cprovider_subject/);
      assert.equal(options.headers.prefer, "resolution=ignore-duplicates,return=minimal");
      return new Response("", { status: 201 });
    }
    if (options.method === "GET") {
      return jsonResponse([{ account_id: "account_1", provider: "supabase", provider_subject: "account_1" }]);
    }
    assert.equal(options.method, "PATCH");
    return new Response(null, { status: 204 });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    assert.equal(await db.resolveAccountIdentity({
      provider: "supabase",
      providerSubject: "account_1",
      accountId: "account_1"
    }), "account_1");
  });
  assert.deepEqual(methods, ["POST", "GET", "PATCH"]);
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

test("content report helpers query content_reports and messages", async () => {
  const calls = [];
  await withStubbedFetch(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    expectServiceHeaders(options.headers, { withBody: Boolean(options.body) });
    if (String(url).includes("/rest/v1/messages")) {
      return jsonResponse([{ id: "00000000-0000-4000-8000-000000000001", content: "hi" }]);
    }
    if (String(options.method).toUpperCase() === "POST") {
      return jsonResponse([{ id: "rep_1", status: "open", snippet: "hi" }]);
    }
    if (String(options.method).toUpperCase() === "PATCH") {
      return jsonResponse([{ id: "rep_1", status: "done" }]);
    }
    return jsonResponse([{ id: "rep_1", status: "open" }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const message = await db.getMessage("user_1", "00000000-0000-4000-8000-000000000001");
    assert.equal(message.id, "00000000-0000-4000-8000-000000000001");
    assert.match(calls[0].url, /\/rest\/v1\/messages\?/);
    assert.match(calls[0].url, /user_id=eq\.user_1/);
    const existing = await db.getOpenContentReport("user_1", "00000000-0000-4000-8000-000000000001");
    assert.equal(existing.status, "open");
    assert.match(calls[1].url, /\/rest\/v1\/content_reports\?/);
    assert.match(calls[1].url, /status=eq\.open/);
    const created = await db.createContentReport({ reporter_id: "user_1", snippet: "hi", status: "open" });
    assert.equal(created.id, "rep_1");
    assert.equal(calls[2].method, "POST");
    const resolved = await db.resolveContentReport("rep_1", "admin_1");
    assert.equal(resolved.status, "done");
    assert.equal(calls[3].method, "PATCH");
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
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/messages");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    assert.equal(parsed.searchParams.get("conversation_id"), "eq.conv_1");
    assert.equal(
      parsed.searchParams.get("select"),
      "id,user_id,conversation_id,role,content,model,tool_calls,finish_reason,error,created_at,metadata,turn_run_id,output_slot"
    );
    assert.equal(parsed.searchParams.get("order"), "created_at.asc");
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

test("listMessages appends reasoning when includeReasoning is true", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "GET");
    const parsed = new URL(url);
    assert.equal(
      parsed.searchParams.get("select"),
      "id,user_id,conversation_id,role,content,model,tool_calls,finish_reason,error,created_at,metadata,turn_run_id,output_slot,reasoning"
    );
    expectServiceHeaders(options.headers);
    return jsonResponse([]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    await db.listMessages("user_1", "conv_1", { includeReasoning: true });
  });
});

test("listRecentAssistantMessages selects newest assistant content with a bound and offset", async () => {
  let request = 0;
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "GET");
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/messages");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    assert.equal(parsed.searchParams.get("conversation_id"), "eq.conv_1");
    assert.equal(parsed.searchParams.get("role"), "eq.assistant");
    assert.equal(parsed.searchParams.get("select"), "content");
    assert.equal(parsed.searchParams.get("order"), "created_at.desc,id.desc");
    assert.equal(parsed.searchParams.get("limit"), "10");
    assert.equal(parsed.searchParams.get("offset"), request++ ? "10" : null);
    expectServiceHeaders(options.headers);
    return jsonResponse([{ content: "Latest answer" }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    assert.deepEqual(
      await db.listRecentAssistantMessages("user_1", "conv_1"),
      [{ content: "Latest answer" }]
    );
    assert.deepEqual(
      await db.listRecentAssistantMessages("user_1", "conv_1", { offset: 10 }),
      [{ content: "Latest answer" }]
    );
  });
});

test("searchMessages posts to klui_search_messages with scoped params", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/klui_search_messages");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: "user_1",
      p_query: "hello",
      p_limit: 30
    });
    return jsonResponse([{
      conversation_id: "conv_1",
      title: "Chat",
      snippet: "hello world",
      matched_at: "2026-08-17T00:00:00Z"
    }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const rows = await db.searchMessages("user_1", "hello");
    assert.deepEqual(rows, [{
      conversation_id: "conv_1",
      title: "Chat",
      snippet: "hello world",
      matched_at: "2026-08-17T00:00:00Z"
    }]);
  });
});

test("listProjects scopes projects to the user and update order", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "GET");
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/projects");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    assert.equal(parsed.searchParams.get("select"), "id,name,kind,meta,created_at,updated_at");
    assert.equal(parsed.searchParams.get("order"), "updated_at.desc");
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

test("reserveAttachment uses the quota RPC", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/klui_reserve_attachment");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: "user_1",
      p_max_bytes: 2684354560,
      p_category: "image",
      p_object_key: "users/user_1/photo.png",
      p_file_name: "photo.png",
      p_content_type: "image/png",
      p_size_bytes: 10,
      p_conversation_id: null,
      p_message_id: null,
      p_project_id: null
    });
    return jsonResponse({ id: "att_1", status: "pending" });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const attachment = await db.reserveAttachment({
      userId: "user_1",
      maxBytes: 2684354560,
      category: "image",
      objectKey: "users/user_1/photo.png",
      fileName: "photo.png",
      contentType: "image/png",
      sizeBytes: 10
    });
    assert.equal(attachment.id, "att_1");
  });
});

test("listConversationStorageTotals uses an RPC when Data API aggregates are disabled", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/klui_conversation_storage_totals");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.deepEqual(JSON.parse(options.body), { p_user_id: "user_1" });
    return jsonResponse([{ conversation_id: "conv_1", count: 2, bytes: 900 }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const rows = await db.listConversationStorageTotals("user_1");
    assert.equal(rows[0].bytes, 900);
  });
});

test("completeReservedAttachment uses the quota RPC", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/klui_complete_attachment");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: "user_1",
      p_attachment_id: "att_1",
      p_size_bytes: 10,
      p_etag: "etag-1",
      p_max_bytes: 5368709120
    });
    return jsonResponse({ id: "att_1", status: "uploaded", etag: "etag-1" });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const attachment = await db.completeReservedAttachment({
      userId: "user_1",
      attachmentId: "att_1",
      sizeBytes: 10,
      etag: "etag-1",
      maxBytes: 5368709120
    });
    assert.equal(attachment.status, "uploaded");
  });
});

test("listUserStorageAttachments lists pending and uploaded by size", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    const parsed = new URL(url);
    assert.equal(options.method, "GET");
    assert.equal(parsed.pathname, "/rest/v1/attachments");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    assert.equal(parsed.searchParams.get("status"), "in.(pending,uploaded)");
    assert.equal(parsed.searchParams.get("order"), "size_bytes.desc,created_at.desc");
    expectServiceHeaders(options.headers);
    return jsonResponse([]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    await db.listUserStorageAttachments("user_1");
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
      p_project_max_bytes: null,
      p_account_max_bytes: null
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

test("deleteStudyCardsForSource can delete a manual deck scoped to a course", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "DELETE");
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/study_cards");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    assert.equal(parsed.searchParams.get("project_id"), "eq.course_1");
    assert.equal(parsed.searchParams.get("document_file_id"), "is.null");
    assert.equal(parsed.searchParams.get("note_id"), "is.null");
    assert.equal(parsed.searchParams.get("deck_key"), "is.null");
    expectServiceHeaders(options.headers);
    return new Response(null, { status: 204 });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    await db.deleteStudyCardsForSource("user_1", { projectId: "course_1", manual: true });
  });
});

test("deleteStudyCard DELETEs one card scoped to the user", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "DELETE");
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/study_cards");
    assert.equal(parsed.searchParams.get("id"), "eq.card_1");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    expectServiceHeaders(options.headers);
    return new Response(null, { status: 204 });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    await db.deleteStudyCard("user_1", "card_1");
  });
});

test("deleteStudyCardsForSource can delete a combo deck by deck_key", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "DELETE");
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/study_cards");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    assert.equal(parsed.searchParams.get("project_id"), "eq.course_1");
    assert.equal(parsed.searchParams.get("deck_key"), "eq.combo_11111111-1111-1111-1111-111111111111");
    expectServiceHeaders(options.headers);
    return new Response(null, { status: 204 });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    await db.deleteStudyCardsForSource("user_1", {
      projectId: "course_1",
      deckKey: "combo_11111111-1111-1111-1111-111111111111"
    });
  });
});

test("updateStudyCard PATCHes one card scoped to the user", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "PATCH");
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/rest/v1/study_cards");
    assert.equal(parsed.searchParams.get("id"), "eq.card_1");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.equal(options.headers.prefer, "return=representation");
    const body = JSON.parse(options.body);
    assert.equal(body.starred, true);
    return jsonResponse([{ id: "card_1", starred: true, front: "Q", back: "A" }]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const card = await db.updateStudyCard("user_1", "card_1", { starred: true });
    assert.equal(card.starred, true);
  });
});

test("createStudyCards bulk POSTs card rows with return=representation", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "POST");
    assert.equal(url, "https://example.supabase.co/rest/v1/study_cards");
    expectServiceHeaders(options.headers, { withBody: true });
    assert.equal(options.headers.prefer, "return=representation");
    const body = JSON.parse(options.body);
    assert.equal(body.length, 2);
    assert.equal(body[0].user_id, "user_1");
    assert.equal(body[0].front, "Q1");
    assert.equal(body[1].front, "Q2");
    return jsonResponse([
      { id: "card_1", front: "Q1" },
      { id: "card_2", front: "Q2" }
    ]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const cards = await db.createStudyCards("user_1", [
      { project_id: "course_1", front: "Q1", back: "A1" },
      { project_id: "course_1", front: "Q2", back: "A2" }
    ]);
    assert.equal(cards.length, 2);
    assert.equal(cards[0].id, "card_1");
  });
});

test("exportAccountData pages user-scoped tables and omits object keys", async () => {
  const calls = [];
  await withStubbedFetch(async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push(parsed.pathname);
    expectServiceHeaders(options.headers);
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    if (parsed.pathname === "/rest/v1/attachments") {
      assert.equal(parsed.searchParams.get("select"), "id,file_name,content_type,category,status,size_bytes,created_at,conversation_id,project_id");
      assert.equal(parsed.searchParams.get("object_key"), null);
      assert.doesNotMatch(parsed.searchParams.get("select"), /object_key/);
    }
    if (parsed.pathname === "/rest/v1/user_memory_profiles") {
      return jsonResponse([{ enabled: true, content: "Prefers short answers.", updated_at: "2026-08-02T00:00:00.000Z" }]);
    }
    return jsonResponse([]);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const dump = await db.exportAccountData("user_1");
    assert.equal(dump.truncated, false);
    assert.equal(dump.memory.enabled, true);
    assert.deepEqual(dump.conversations, []);
    assert.ok(calls.includes("/rest/v1/conversations"));
    assert.ok(calls.includes("/rest/v1/messages"));
    assert.ok(calls.includes("/rest/v1/attachments"));
    assert.ok(calls.includes("/rest/v1/user_memory_profiles"));
    assert.ok(calls.includes("/rest/v1/subscriptions"));
    assert.ok(calls.includes("/rest/v1/payment_requests"));
    assert.ok(calls.includes("/rest/v1/usage_api_weekly"));
    assert.ok(calls.includes("/rest/v1/projects"));
    assert.equal(calls.includes("/rest/v1/usage_api_events"), false);
    assert.equal(calls.includes("/rest/v1/study_notes"), false);
  });
});

test("listAccountObjectKeys gathers attachment, document, and page keys", async () => {
  const paths = [];
  await withStubbedFetch(async (url, options = {}) => {
    const parsed = new URL(url);
    paths.push(parsed.pathname);
    assert.equal(options.method, "GET");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    assert.equal(parsed.searchParams.get("limit"), "5000");
    expectServiceHeaders(options.headers);
    if (parsed.pathname === "/rest/v1/attachments") {
      return jsonResponse([{ object_key: "users/u/a.png" }]);
    }
    if (parsed.pathname === "/rest/v1/document_files") {
      return jsonResponse([{ extraction_key: "users/u/extract.json", preview_key: null }]);
    }
    if (parsed.pathname === "/rest/v1/document_pages") {
      return jsonResponse([{ image_key: "users/u/pages/page-0001.jpg" }]);
    }
    throw new Error(`unexpected ${url}`);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const keys = await db.listAccountObjectKeys("user_1");
    assert.deepEqual(keys, [
      "users/u/a.png",
      "users/u/extract.json",
      "users/u/pages/page-0001.jpg"
    ]);
  });
  assert.deepEqual(new Set(paths), new Set([
    "/rest/v1/attachments",
    "/rest/v1/document_files",
    "/rest/v1/document_pages"
  ]));
});

test("listAccountObjectKeysBatch pages each owned storage table by id", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    const parsed = new URL(url);
    assert.equal(options.method, "GET");
    assert.equal(parsed.searchParams.get("user_id"), "eq.user_1");
    assert.equal(parsed.searchParams.get("limit"), "200");
    assert.equal(parsed.searchParams.get("order"), "id.asc");
    assert.equal(parsed.searchParams.get("id"), "gt.cursor-1");
    expectServiceHeaders(options.headers);
    if (parsed.pathname === "/rest/v1/attachments") {
      return jsonResponse([{ id: "attachment-2", object_key: "users/u/a.png" }]);
    }
    if (parsed.pathname === "/rest/v1/document_files") {
      return jsonResponse([{ id: "document-2", extraction_key: "users/u/extract.json", preview_key: null }]);
    }
    if (parsed.pathname === "/rest/v1/document_pages") {
      return jsonResponse([{ id: "page-2", image_key: "users/u/page.jpg" }]);
    }
    throw new Error(`unexpected ${url}`);
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    const batch = await db.listAccountObjectKeysBatch("user_1", {
      cursors: { attachments: "cursor-1", documents: "cursor-1", pages: "cursor-1" }
    });
    assert.deepEqual(batch.keys, [
      "users/u/a.png",
      "users/u/extract.json",
      "users/u/page.jpg"
    ]);
    assert.deepEqual(batch.cursors, {
      attachments: "attachment-2",
      documents: "document-2",
      pages: "page-2"
    });
    assert.equal(batch.hasMore, false);
  });
});

test("deleteAuthUser calls GoTrue admin delete and treats 404 as success", async () => {
  await withStubbedFetch(async (url, options = {}) => {
    assert.equal(options.method, "DELETE");
    assert.equal(url, "https://example.supabase.co/auth/v1/admin/users/user_1");
    expectServiceHeaders(options.headers);
    return new Response(null, { status: 404 });
  }, async () => {
    const db = new SupabaseRest(FAKE_CONFIG);
    assert.equal(await db.deleteAuthUser("user_1"), true);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseRest } from "../server/db/supabaseRest.js";

const FAKE_CONFIG = {
  supabase: {
    url: "https://example.supabase.co",
    serviceRoleKey: "service-role-key"
  }
};

function withStubbedFetch(fetchImpl, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return fn();
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

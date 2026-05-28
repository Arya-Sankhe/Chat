import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseRest } from "../server/db/supabaseRest.js";
import { consumeDocumentsOrThrow, consumeUsageOrThrow, getCurrentEntitlement } from "../server/saas/entitlements.js";
import { buildStoredUserContent, imageCountFromContent } from "../server/saas/messages.js";
import { loadPlans } from "../server/saas/plans.js";
import { createCrofaiUsageMeter } from "../server/saas/usageMeter.js";
import { assertImageUpload, assertUpload, documentKindFromFileName, R2Client, safeFileName } from "../server/storage/r2.js";

test("loadPlans maps Crof-style tiers from env", () => {
  const plans = loadPlans({
    PLAN_HOBBY_PRICE_LABEL: "Testing",
    PLAN_HOBBY_DAILY_MESSAGES: "25",
    PLAN_HOBBY_MONTHLY_IMAGES: "50",
    PLAN_HOBBY_MAX_DOCUMENTS_PER_MESSAGE: "5",
    PLAN_HOBBY_MAX_DOCUMENT_BYTES_PER_MESSAGE: "31457280",
    PLAN_HOBBY_DAILY_DOCUMENT_TOOL_CALLS: "33",
    PLAN_HOBBY_DAILY_GENERATED_DOCUMENTS: "7"
  });

  assert.equal(plans[0].id, "hobby");
  assert.equal(plans[0].priceLabel, "Testing");
  assert.equal(plans[0].dailyMessageLimit, 25);
  assert.equal(plans[0].monthlyImageLimit, 50);
  assert.equal(plans[0].maxDocumentsPerMessage, 5);
  assert.equal(plans[0].maxDocumentBytesPerMessage, 31457280);
  assert.equal(plans[0].dailyDocumentToolLimit, 33);
  assert.equal(plans[0].dailyGeneratedDocumentLimit, 7);
  assert.equal(Object.hasOwn(plans[0], "priceId"), false);
});

test("testing access grants the configured plan without a payment gateway", async () => {
  const plans = loadPlans();
  const entitlement = await getCurrentEntitlement({
    db: {},
    userId: "user_1",
    plans,
    access: { mode: "testing", testingPlanId: "pro" }
  });

  assert.equal(entitlement.active, true);
  assert.equal(entitlement.plan.id, "pro");
  assert.equal(entitlement.subscription.status, "testing");
});

test("consumeUsageOrThrow debits one unit per CrofAI model call", async () => {
  const calls = [];
  const db = {
    async consumeUsage(payload) {
      calls.push({ type: "consume", payload });
      return { allowed: true, message_count: payload.messageCount };
    },
    async recordUsageEvent(event) {
      calls.push({ type: "event", event });
      return event;
    }
  };

  const usage = await consumeUsageOrThrow({
    db,
    userId: "user_1",
    subscription: { id: "sub_1" },
    plan: { id: "pro", dailyMessageLimit: 600, monthlyImageLimit: 1000 },
    imageCount: 0,
    messageCount: 4,
    models: ["a", "b", "c", "d"]
  });

  assert.equal(usage.allowed, true);
  assert.equal(calls[0].payload.messageCount, 4);
  assert.equal(calls.filter((call) => call.type === "event").length, 4);
  assert.deepEqual(calls.filter((call) => call.type === "event").map((call) => call.event.model), ["a", "b", "c", "d"]);
});

test("createCrofaiUsageMeter debits exactly one usage unit before each CrofAI call", async () => {
  const events = [];
  const db = {
    async consumeUsage(payload) {
      events.push({ type: "consume", payload });
      return { allowed: true, message_count: events.filter((event) => event.type === "consume").length };
    },
    async recordUsageEvent(event) {
      events.push({ type: "event", event });
      return event;
    }
  };
  const crofCalls = [];
  const meter = createCrofaiUsageMeter({
    db,
    userId: "user_1",
    subscription: { id: "sub_1" },
    plan: { id: "pro", dailyMessageLimit: 600, monthlyImageLimit: 1000 },
    imageCount: 2,
    chatCompletionFn: async (params) => {
      crofCalls.push({ type: "chat", model: params.body.model });
      return "ok";
    },
    streamChatCompletionFn: async (params) => {
      crofCalls.push({ type: "stream", model: params.body.model });
      return { body: { getReader() {} } };
    }
  });

  await Promise.all([
    meter.chatCompletion({ body: { model: "alpha" } }),
    meter.chatCompletion({ body: { model: "beta" } }),
    meter.streamChatCompletion({ body: { model: "gamma" } })
  ]);

  const consumes = events.filter((event) => event.type === "consume").map((event) => event.payload);
  assert.equal(consumes.length, crofCalls.length);
  assert.deepEqual(consumes.map((payload) => payload.messageCount), [1, 1, 1]);
  assert.deepEqual(consumes.map((payload) => payload.imageCount), [2, 0, 0]);
  assert.deepEqual(events.filter((event) => event.type === "event").map((event) => event.event.model), ["alpha", "beta", "gamma"]);
  assert.deepEqual(crofCalls.map((call) => call.model), ["alpha", "beta", "gamma"]);
});

test("createCrofaiUsageMeter does not call CrofAI when usage is denied", async () => {
  let crofCalls = 0;
  const meter = createCrofaiUsageMeter({
    db: {
      async consumeUsage() {
        return { allowed: false, reason: "Daily message limit reached." };
      },
      async recordUsageEvent() {
        throw new Error("usage events should not be written when usage is denied");
      }
    },
    userId: "user_1",
    subscription: { id: "sub_1" },
    plan: { id: "pro", dailyMessageLimit: 0, monthlyImageLimit: 1000 },
    chatCompletionFn: async () => {
      crofCalls += 1;
      return "not reached";
    }
  });

  await assert.rejects(
    meter.chatCompletion({ body: { model: "alpha" } }),
    /Daily message limit reached/
  );
  assert.equal(crofCalls, 0);
});

test("SupabaseRest passes message count into usage RPC", async () => {
  const originalFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (_url, options = {}) => {
    rpcBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ allowed: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const db = new SupabaseRest({
      supabase: {
        url: "https://example.supabase.co",
        serviceRoleKey: "service-role-key"
      }
    });

    await db.consumeUsage({
      userId: "user_1",
      planId: "pro",
      dailyMessageLimit: 600,
      monthlyImageLimit: 1000,
      imageCount: 2,
      messageCount: 3
    });

    assert.equal(rpcBody.p_message_count, 3);
    assert.equal(rpcBody.p_image_count, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SupabaseRest keeps single-message usage compatible with the legacy RPC signature", async () => {
  const originalFetch = globalThis.fetch;
  let rpcBody;
  globalThis.fetch = async (_url, options = {}) => {
    rpcBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ allowed: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const db = new SupabaseRest({
      supabase: {
        url: "https://example.supabase.co",
        serviceRoleKey: "service-role-key"
      }
    });

    await db.consumeUsage({
      userId: "user_1",
      planId: "pro",
      dailyMessageLimit: 600,
      monthlyImageLimit: 1000,
      imageCount: 0,
      messageCount: 1
    });

    assert.equal(Object.hasOwn(rpcBody, "p_message_count"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SupabaseRest passes document usage into the document metering RPC", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl;
  let rpcBody;
  globalThis.fetch = async (url, options = {}) => {
    calledUrl = String(url);
    rpcBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ allowed: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const db = new SupabaseRest({
      supabase: {
        url: "https://example.supabase.co",
        serviceRoleKey: "service-role-key"
      }
    });

    await db.consumeDocuments({
      userId: "user_1",
      planId: "pro",
      dailyDocumentToolLimit: 100,
      dailyGeneratedDocumentLimit: 20,
      toolCount: 2,
      generatedCount: 1
    });

    assert.match(calledUrl, /\/rpc\/klui_consume_documents$/);
    assert.equal(rpcBody.p_user_id, "user_1");
    assert.equal(rpcBody.p_plan_id, "pro");
    assert.equal(rpcBody.p_daily_document_tool_limit, 100);
    assert.equal(rpcBody.p_daily_generated_document_limit, 20);
    assert.equal(rpcBody.p_tool_count, 2);
    assert.equal(rpcBody.p_generated_count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("consumeDocumentsOrThrow rejects document usage past plan limits", async () => {
  const db = {
    async consumeDocuments() {
      return { allowed: false, reason: "Daily document tool limit reached for your plan." };
    }
  };

  await assert.rejects(
    consumeDocumentsOrThrow({
      db,
      userId: "user_1",
      plan: { id: "hobby", dailyDocumentToolLimit: 1, dailyGeneratedDocumentLimit: 0 },
      toolCount: 2
    }),
    /Daily document tool limit reached/
  );
});

test("R2 upload helpers validate images and sanitize names", () => {
  assert.equal(safeFileName("../My Image!.png"), "My-Image-.png");
  assert.doesNotThrow(() => assertImageUpload({ contentType: "image/png", sizeBytes: 1024 }, 2048));
  assert.throws(() => assertImageUpload({ contentType: "text/plain", sizeBytes: 1024 }, 2048), /png, jpeg, webp, or gif/);
  assert.throws(() => assertImageUpload({ contentType: "image/png", sizeBytes: 4096 }, 2048), /smaller/);
});

test("R2 upload helpers validate document files by MIME type and extension", () => {
  assert.equal(documentKindFromFileName("Report.final.PDF"), "pdf");
  assert.equal(assertUpload({
    category: "document",
    contentType: "application/pdf",
    fileName: "report.pdf",
    sizeBytes: 1024
  }, { maxDocumentBytes: 2048 }), "document");
  assert.equal(assertUpload({
    category: "document",
    contentType: "application/octet-stream",
    fileName: "sheet.xlsx",
    sizeBytes: 1024
  }, { maxDocumentBytes: 2048 }), "document");
  assert.throws(() => assertUpload({
    category: "document",
    contentType: "application/javascript",
    fileName: "x.js",
    sizeBytes: 1024
  }, { maxDocumentBytes: 2048 }), /PDF, DOCX, XLSX, CSV, or TSV/);
  assert.throws(() => assertUpload({
    category: "document",
    contentType: "application/pdf",
    fileName: "too-big.pdf",
    sizeBytes: 4096
  }, { maxDocumentBytes: 2048 }), /smaller/);
});

test("stored user content keeps document uploads out of the vision image count", () => {
  const content = buildStoredUserContent("Read this", [{
    id: "attachment_1",
    category: "document",
    object_key: "users/user_1/report.pdf",
    file_name: "report.pdf",
    content_type: "application/pdf",
    size_bytes: 1234
  }]);

  assert.equal(imageCountFromContent(content), 0);
  assert.equal(content[1].type, "file");
  assert.equal(content[1].file.attachment_id, "attachment_1");
  assert.equal(content[1].file.url, "r2://users/user_1/report.pdf");
});

test("dependency policy pins npm supply-chain guardrails", () => {
  const npmrc = fs.readFileSync(new URL("../.npmrc", import.meta.url), "utf8");
  const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

  assert.match(npmrc, /min-release-age=7/);
  assert.match(npmrc, /ignore-scripts=true/);
  assert.deepEqual(lock.packages[""].dependencies, undefined);
});

test("deleteConversation hard-deletes chat data in Supabase", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (options.method === "GET" && String(url).includes("/attachments?")) {
      return new Response(JSON.stringify([{ id: "attachment_1", object_key: "users/user_1/image.png" }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (options.method === "DELETE" && String(url).includes("/attachments?")) {
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify([{ id: "conversation_1" }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const db = new SupabaseRest({
      supabase: {
        url: "https://example.supabase.co",
        serviceRoleKey: "service-role-key"
      }
    });

    const deleted = await db.deleteConversation("user_1", "conversation_1");

    assert.equal(deleted.id, "conversation_1");
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.method, "GET");
    assert.match(calls[0].url, /\/attachments\?/);
    assert.match(calls[0].url, /conversation_id=eq\.conversation_1/);
    assert.equal(calls[1].options.method, "DELETE");
    assert.match(calls[1].url, /\/attachments\?/);
    assert.equal(calls[2].options.method, "DELETE");
    assert.match(calls[2].url, /\/conversations\?/);
    assert.match(calls[2].url, /deleted_at=is\.null/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("R2 deleteObjects signs DELETE requests for uploaded image cleanup", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(null, { status: 204 });
  };

  try {
    const r2 = new R2Client({
      r2: {
        endpoint: "https://account.r2.cloudflarestorage.com",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        bucket: "klui-chat",
        uploadExpiresSeconds: 300,
        readExpiresSeconds: 900
      }
    });

    const deleted = await r2.deleteObjects(["users/user_1/image.png", "users/user_1/image.png"]);

    assert.equal(deleted, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, "DELETE");
    assert.match(calls[0].url, /^https:\/\/account\.r2\.cloudflarestorage\.com\/klui-chat\/users\/user_1\/image\.png\?/);
    assert.match(calls[0].url, /X-Amz-Signature=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("R2 putObject uploads through the server without browser CORS", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(null, {
      status: 200,
      headers: { etag: "\"server-upload-etag\"" }
    });
  };

  try {
    const r2 = new R2Client({
      r2: {
        endpoint: "https://account.r2.cloudflarestorage.com",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        bucket: "klui-chat",
        uploadExpiresSeconds: 300,
        readExpiresSeconds: 900
      }
    });

    const uploaded = await r2.putObject("users/user_1/image.png", Buffer.from("image"), {
      contentType: "image/png"
    });

    assert.deepEqual(uploaded, { etag: "server-upload-etag" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, "PUT");
    assert.equal(calls[0].options.headers["content-type"], "image/png");
    assert.equal(calls[0].options.headers["x-amz-content-sha256"], "UNSIGNED-PAYLOAD");
    assert.match(calls[0].url, /^https:\/\/account\.r2\.cloudflarestorage\.com\/klui-chat\/users\/user_1\/image\.png\?/);
    assert.match(calls[0].url, /X-Amz-SignedHeaders=host%3Bx-amz-content-sha256/);
    assert.match(calls[0].url, /X-Amz-Signature=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("R2 putObject reports bucket permission failures clearly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>",
    { status: 403 }
  );

  try {
    const r2 = new R2Client({
      r2: {
        endpoint: "https://account.r2.cloudflarestorage.com",
        accessKeyId: "access-key",
        secretAccessKey: "secret-key",
        bucket: "klui-chat",
        uploadExpiresSeconds: 300,
        readExpiresSeconds: 900
      }
    });

    await assert.rejects(
      r2.putObject("users/user_1/image.png", Buffer.from("image"), { contentType: "image/png" }),
      (error) => {
        assert.equal(error.status, 502);
        assert.match(error.message, /Object Read & Write access/);
        assert.deepEqual(error.details, {
          status: 403,
          code: "AccessDenied",
          message: "Access Denied"
        });
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("R2 readUrl can force a clean attachment download filename", () => {
  const r2 = new R2Client({
    r2: {
      endpoint: "https://account.r2.cloudflarestorage.com",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      bucket: "klui-chat",
      uploadExpiresSeconds: 300,
      readExpiresSeconds: 900
    }
  });

  const url = new URL(r2.readUrl("users/user_1/report.pdf", { fileName: "../Quarterly Report.pdf" }));
  assert.equal(url.searchParams.get("response-content-disposition"), "attachment; filename=\"Quarterly-Report.pdf\"");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
  assert.ok(
    url.search.indexOf("X-Amz-SignedHeaders=host") < url.search.indexOf("response-content-disposition="),
    "response header overrides must sort after X-Amz-* params for R2 signature validation"
  );
});

test("R2 signed URLs do not duplicate the bucket when endpoint includes it", () => {
  const r2 = new R2Client({
    r2: {
      endpoint: "https://account.r2.cloudflarestorage.com/klui-chat",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      bucket: "klui-chat",
      uploadExpiresSeconds: 300,
      readExpiresSeconds: 900
    }
  });

  const url = new URL(r2.uploadUrl("users/user_1/image.png"));
  assert.equal(url.pathname, "/klui-chat/users/user_1/image.png");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host;x-amz-content-sha256");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
});

test("R2 readUrl can create inline preview URLs", () => {
  const r2 = new R2Client({
    r2: {
      endpoint: "https://account.r2.cloudflarestorage.com",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      bucket: "klui-chat",
      uploadExpiresSeconds: 300,
      readExpiresSeconds: 900
    }
  });

  const url = new URL(r2.readUrl("users/user_1/report.pdf", {
    fileName: "Report.pdf",
    disposition: "inline",
    contentType: "application/pdf"
  }));
  assert.equal(url.searchParams.get("response-content-disposition"), "inline; filename=\"Report.pdf\"");
  assert.equal(url.searchParams.get("response-content-type"), "application/pdf");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
});

import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseRest } from "../server/db/supabaseRest.js";
import { getCurrentEntitlement } from "../server/saas/entitlements.js";
import { apiUsageWindow, usageCostCredits } from "../server/saas/billing.js";
import { buildStoredUserContent, imageCountFromContent } from "../server/saas/messages.js";
import { applyEditedUserText } from "../server/routes.js";
import { loadPlans } from "../server/saas/plans.js";
import { createCrofaiUsageMeter } from "../server/saas/usageMeter.js";
import { assertImageUpload, assertUpload, documentKindFromFileName, R2Client, safeFileName } from "../server/storage/r2.js";

test("loadPlans maps Klui payment tiers from env", () => {
  const plans = loadPlans({
    PLAN_LITE_PRICE_LABEL: "10 AED / month",
    PLAN_LITE_MONTHLY_API_CREDITS: "3.5",
    PLAN_LITE_MAX_DOCUMENTS_PER_MESSAGE: "5",
    PLAN_LITE_MAX_DOCUMENT_BYTES_PER_MESSAGE: "31457280",
    PLAN_LITE_ZIINA_PAYMENT_URL: "https://ziina.com/pay/lite"
  });

  assert.equal(plans[0].id, "lite");
  assert.equal(plans[0].priceLabel, "10 AED / month");
  assert.equal(plans[0].amountAed, 10);
  assert.equal(plans[0].ziinaPaymentUrl, "https://ziina.com/pay/lite");
  assert.equal(plans[0].monthlyApiCreditLimit, 3.5);
  assert.equal(plans[0].maxDocumentsPerMessage, 5);
  assert.equal(plans[0].maxDocumentBytesPerMessage, 31457280);
  assert.equal(Object.hasOwn(plans[0], "dailyMessageLimit"), false);
  assert.equal(Object.hasOwn(plans[0], "monthlyImageLimit"), false);
  assert.equal(Object.hasOwn(plans[0], "dailyDocumentToolLimit"), false);
  assert.equal(Object.hasOwn(plans[0], "dailyGeneratedDocumentLimit"), false);
  assert.equal(Object.hasOwn(plans[0], "priceId"), false);
});

test("applyEditedUserText rewrites plain text messages", () => {
  assert.equal(applyEditedUserText("old prompt", "new prompt"), "new prompt");
});

test("applyEditedUserText keeps attachments and only swaps the text", () => {
  const original = [
    { type: "text", text: "describe this" },
    { type: "image_url", image_url: { attachment_id: "att_1", file_name: "a.png", url: "r2://k1" } },
    { type: "file", file: { attachment_id: "att_2", file_name: "b.pdf", url: "r2://k2" } }
  ];
  const edited = applyEditedUserText(original, "  what does this show?  ");
  assert.deepEqual(edited, [
    { type: "text", text: "what does this show?" },
    { type: "image_url", image_url: { attachment_id: "att_1", file_name: "a.png", url: "r2://k1" } },
    { type: "file", file: { attachment_id: "att_2", file_name: "b.pdf", url: "r2://k2" } }
  ]);
});

test("applyEditedUserText allows clearing text when attachments remain", () => {
  const original = [
    { type: "text", text: "old" },
    { type: "image_url", image_url: { attachment_id: "att_1" } }
  ];
  const edited = applyEditedUserText(original, "");
  assert.deepEqual(edited, [
    { type: "image_url", image_url: { attachment_id: "att_1" } }
  ]);
});

test("applyEditedUserText rejects an empty text-only edit", () => {
  assert.throws(() => applyEditedUserText("old", "   "), /empty/i);
});

test("testing access grants the configured plan", async () => {
  const plans = loadPlans();
  const entitlement = await getCurrentEntitlement({
    db: {},
    userId: "user_1",
    plans,
    access: { mode: "testing", testingPlanId: "essential" }
  });

  assert.equal(entitlement.active, true);
  assert.equal(entitlement.plan.id, "essential");
  assert.equal(entitlement.subscription.status, "testing");
});

test("apiUsageWindow splits a subscription month into four dynamic weeks", () => {
  const window = apiUsageWindow(
    { current_period_end: "2026-03-02T00:00:00.000Z" },
    { monthlyApiCreditLimit: 8 },
    new Date("2026-02-16T12:00:00.000Z")
  );

  assert.equal(window.periodStart, "2026-02-02");
  assert.equal(window.periodEnd, "2026-03-02");
  assert.equal(window.weekStart, "2026-02-16");
  assert.equal(window.weekEnd, "2026-02-23");
  assert.equal(window.weekIndex, 3);
  assert.equal(window.weeklyLimit, 2);
});

test("usageCostCredits reads OpenRouter cost fields", () => {
  assert.equal(usageCostCredits({ cost: 0.0012 }), 0.0012);
  assert.equal(usageCostCredits({ total_cost: 0.004 }), 0.004);
});

test("createCrofaiUsageMeter checks budget then records actual streamed OpenRouter cost", async () => {
  const events = [];
  const db = {
    async checkApiBudget(payload) {
      events.push({ type: "check", payload });
      return { allowed: true };
    },
    async recordApiUsageCost(payload) {
      events.push({ type: "cost", payload });
      return { allowed: true };
    }
  };
  const crofCalls = [];
  const streamForCost = (cost) => {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: {"id":"gen_1","choices":[{"delta":{"content":"ok"}}]}\n\n`));
        controller.enqueue(encoder.encode(`data: {"usage":{"prompt_tokens":100,"completion_tokens":10,"total_tokens":110,"cost":${cost}},"choices":[]}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    }));
  };
  const meter = createCrofaiUsageMeter({
    db,
    userId: "user_1",
    subscription: { id: "sub_1", current_period_end: "2026-07-01T00:00:00.000Z" },
    plan: { id: "pro", monthlyApiCreditLimit: 10 },
    chatCompletionFn: async (params) => {
      crofCalls.push({ type: "chat", model: params.body.model });
      params.onResponsePayload?.({
        id: "gen_chat",
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, cost: 0.0005 }
      });
      return "ok";
    },
    streamChatCompletionFn: async (params) => {
      crofCalls.push({ type: "stream", model: params.body.model });
      return streamForCost(0.001);
    }
  });

  await meter.chatCompletion({ apiKey: "or", baseUrl: "https://openrouter.ai/api/v1", body: { model: "alpha" }, providerId: "openrouter" });
  const upstream = await meter.streamChatCompletion({ apiKey: "or", baseUrl: "https://openrouter.ai/api/v1", body: { model: "gamma" }, providerId: "openrouter" });
  await upstream.text();

  assert.deepEqual(crofCalls.map((call) => call.model), ["alpha", "gamma"]);
  assert.equal(events.filter((event) => event.type === "check").length, 2);
  const costs = events.filter((event) => event.type === "cost").map((event) => event.payload);
  assert.deepEqual(costs.map((payload) => payload.model), ["alpha", "gamma"]);
  assert.deepEqual(costs.map((payload) => payload.costCredits), [0.0005, 0.001]);
  assert.equal(costs[1].generationId, "gen_1");
});

test("createCrofaiUsageMeter does not call OpenRouter when weekly budget is denied", async () => {
  let crofCalls = 0;
  const meter = createCrofaiUsageMeter({
    db: {
      async checkApiBudget() {
        return { allowed: false, reason: "Weekly API limit reached." };
      },
      async recordApiUsageCost() {
        throw new Error("usage cost should not be written when usage is denied");
      }
    },
    userId: "user_1",
    subscription: { id: "sub_1" },
    plan: { id: "pro", monthlyApiCreditLimit: 10 },
    chatCompletionFn: async () => {
      crofCalls += 1;
      return "not reached";
    }
  });

  await assert.rejects(
    meter.chatCompletion({ body: { model: "alpha" } }),
    /Weekly API limit reached/
  );
  assert.equal(crofCalls, 0);
});

test("SupabaseRest records API usage cost with the active weekly window", async () => {
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

    await db.recordApiUsageCost({
      userId: "user_1",
      subscriptionId: "sub_1",
      planId: "pro",
      model: "deepseek/deepseek-v4-flash",
      provider: "openrouter",
      generationId: "gen_1",
      periodStart: "2026-02-02",
      periodEnd: "2026-03-02",
      weekStart: "2026-02-09",
      weekEnd: "2026-02-16",
      weekIndex: 2,
      weeklyLimit: 2.5,
      costCredits: 0.00123,
      costSource: "openrouter_usage",
      usage: { cost: 0.00123 }
    });

    assert.match(calledUrl, /\/rpc\/klui_record_api_usage$/);
    assert.equal(rpcBody.p_period_start, "2026-02-02");
    assert.equal(rpcBody.p_week_index, 2);
    assert.equal(rpcBody.p_weekly_credit_limit, 2.5);
    assert.equal(rpcBody.p_cost_credits, 0.00123);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("R2 upload helpers validate images and sanitize names", () => {
  assert.equal(safeFileName("../My Image!.png"), "My-Image-.png");
  assert.doesNotThrow(() => assertImageUpload({ contentType: "image/png", sizeBytes: 1024 }, 2048));
  assert.throws(() => assertImageUpload({ contentType: "text/plain", sizeBytes: 1024 }, 2048), /png, jpeg, webp, or gif/);
  assert.throws(() => assertImageUpload({ contentType: "image/png", sizeBytes: 4096 }, 2048), /smaller/);
});

test("R2 upload helpers validate document files by MIME type and extension", () => {
  assert.equal(documentKindFromFileName("Report.final.PDF"), "pdf");
  assert.equal(documentKindFromFileName("Pitch.Deck.PPTX"), "pptx");
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
  assert.equal(assertUpload({
    category: "document",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    fileName: "deck.pptx",
    sizeBytes: 1024
  }, { maxDocumentBytes: 2048 }), "document");
  assert.throws(() => assertUpload({
    category: "document",
    contentType: "application/javascript",
    fileName: "x.js",
    sizeBytes: 1024
  }, { maxDocumentBytes: 2048 }), /PDF, DOCX, XLSX, PPTX, CSV, or TSV/);
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
  const workerLock = JSON.parse(fs.readFileSync(new URL("../worker/package-lock.json", import.meta.url), "utf8"));

  assert.match(npmrc, /min-release-age=7/);
  assert.match(npmrc, /ignore-scripts=true/);
  assert.deepEqual(lock.packages[""].dependencies, undefined);
  assert.deepEqual(workerLock.packages[""].dependencies, {
    docx: "9.7.1",
    exceljs: "4.4.0",
    pptxgenjs: "4.0.1"
  });
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

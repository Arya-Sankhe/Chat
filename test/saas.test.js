import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseRest } from "../server/db/supabaseRest.js";
import { getCurrentEntitlement } from "../server/saas/entitlements.js";
import { loadPlans } from "../server/saas/plans.js";
import { assertImageUpload, R2Client, safeFileName } from "../server/storage/r2.js";

test("loadPlans maps Crof-style tiers from env", () => {
  const plans = loadPlans({
    PLAN_HOBBY_PRICE_LABEL: "Testing",
    PLAN_HOBBY_DAILY_MESSAGES: "25",
    PLAN_HOBBY_MONTHLY_IMAGES: "50"
  });

  assert.equal(plans[0].id, "hobby");
  assert.equal(plans[0].priceLabel, "Testing");
  assert.equal(plans[0].dailyMessageLimit, 25);
  assert.equal(plans[0].monthlyImageLimit, 50);
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

test("R2 upload helpers validate images and sanitize names", () => {
  assert.equal(safeFileName("../My Image!.png"), "My-Image-.png");
  assert.doesNotThrow(() => assertImageUpload({ contentType: "image/png", sizeBytes: 1024 }, 2048));
  assert.throws(() => assertImageUpload({ contentType: "text/plain", sizeBytes: 1024 }, 2048), /png, jpeg, webp, or gif/);
  assert.throws(() => assertImageUpload({ contentType: "image/png", sizeBytes: 4096 }, 2048), /smaller/);
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
        bucket: "smartyfy-chat",
        uploadExpiresSeconds: 300,
        readExpiresSeconds: 900
      }
    });

    const deleted = await r2.deleteObjects(["users/user_1/image.png", "users/user_1/image.png"]);

    assert.equal(deleted, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, "DELETE");
    assert.match(calls[0].url, /^https:\/\/account\.r2\.cloudflarestorage\.com\/smartyfy-chat\/users\/user_1\/image\.png\?/);
    assert.match(calls[0].url, /X-Amz-Signature=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

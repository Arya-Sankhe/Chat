import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentEntitlement } from "../server/saas/entitlements.js";
import { loadPlans } from "../server/saas/plans.js";
import { assertImageUpload, safeFileName } from "../server/storage/r2.js";

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

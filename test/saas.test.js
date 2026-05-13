import crypto from "node:crypto";
import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { verifyStripeSignature } from "../server/billing/stripe.js";
import { loadPlans } from "../server/saas/plans.js";
import { assertImageUpload, safeFileName } from "../server/storage/r2.js";

test("loadPlans maps Crof-style tiers from env", () => {
  const plans = loadPlans({
    PLAN_HOBBY_STRIPE_PRICE_ID: "price_hobby",
    PLAN_HOBBY_PRICE_LABEL: "$9/mo",
    PLAN_HOBBY_DAILY_MESSAGES: "25",
    PLAN_HOBBY_MONTHLY_IMAGES: "50"
  });

  assert.equal(plans[0].id, "hobby");
  assert.equal(plans[0].stripePriceId, "price_hobby");
  assert.equal(plans[0].priceLabel, "$9/mo");
  assert.equal(plans[0].dailyMessageLimit, 25);
  assert.equal(plans[0].monthlyImageLimit, 50);
});

test("verifyStripeSignature accepts valid v1 signatures", () => {
  const secret = "whsec_test";
  const timestamp = 1778695200;
  const body = Buffer.from(JSON.stringify({ id: "evt_1", type: "checkout.session.completed" }));
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body.toString("utf8")}`).digest("hex");

  assert.doesNotThrow(() => verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, timestamp));
  assert.throws(() => verifyStripeSignature(body, `t=${timestamp},v1=00`, secret, timestamp), /verification failed/);
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

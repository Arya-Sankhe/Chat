import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { loadConfig } from "../server/config.js";
import { publicPlan } from "../server/saas/plans.js";
import { couponPrice, mamoCharges } from "../server/saas/mamo.js";

const app = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
const start = app.indexOf("function renderPlans(");
const render = app.slice(start, app.indexOf("\n}\n", start) + 3);
const config = loadConfig({ MAMO_API_KEY: "test-only" });
const plans = config.plans.map((plan) => publicPlan(plan, true, config.mamo.fees));
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

for (const percentOff of [30, 50, 100]) {
  test(`${percentOff}% coupon shows original, introductory and exact renewal prices on every card`, () => {
    const coupon = { code: "TEST", percentOff };
    const offers = config.plans.map((plan) => {
      const charges = mamoCharges(plan, coupon, config);
      return { planId: plan.id, code: coupon.code, initialAmountAed: couponPrice(plan, coupon), initialChargeAed: charges.initialAmount, renewalChargeAed: charges.renewalAmount };
    });
    const state = { plans, mamoCoupon: { coupon, offers } };
    const els = { paywallPlans: {} };
    const context = { state, els, escapeHtml, renderCouponPanel() {} };
    runInNewContext(`${render}; renderPlans();`, context);
    const cards = els.paywallPlans.innerHTML.split('<article ').slice(1);
    assert.equal(cards.length, 3);
    for (const [index, card] of cards.entries()) {
      const plan = plans[index];
      const offer = offers[index];
      assert.match(card, new RegExp(`<del[^>]+>${plan.amountAed} AED</del>`));
      assert.match(card, new RegExp(`<strong>${percentOff === 100 ? "FREE" : offer.initialAmountAed}</strong>`));
      assert.ok(card.includes(`Then ${plan.amountAed} AED / month + processing fee`));
      assert.ok(card.includes(`then AED ${offer.renewalChargeAed}/month from month two`));
      assert.ok(card.includes(percentOff === 100 ? "Nothing charged today, card saved" : `AED ${offer.initialChargeAed} today`));
      assert.ok(card.includes(percentOff === 100 ? "First month on us" : `${percentOff}% off`));
    }
    state.mamoCoupon = null;
    runInNewContext("renderPlans();", context);
    assert.doesNotMatch(els.paywallPlans.innerHTML, /<del|plan-discount-label|FREE|first month/);
    assert.match(els.paywallPlans.innerHTML, /AED 32\.19 charged monthly/);
  });
}

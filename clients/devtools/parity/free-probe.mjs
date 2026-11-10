// What main added for accounts without a paid plan, on the old site and the new
// client: the Free usage meter, upgrade prompts, the invite-only paywall and
// redeeming a code; then Stripe billing (plans, trial coupon, the Billing row)
// with those responses stubbed. Compares structure, text and pixels at each step.
// Never presses a plan button: that would start a checkout.
// Needs local-backend/up.sh, and nothing else using the fixture users.
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { reset, session, setFree, useUpFreeMessages } from "../local-backend/fixtures.mjs";

const SITES = [
  { origin: "http://localhost:5181", user: "old" },
  { origin: "http://localhost:5180", user: "new" }
];
const normalize = (value) => JSON.parse(JSON.stringify(value)
  .replace(/student@(new\.)?klui\.test/g, "student@klui.test")
  .replace(/localhost:518[01]/g, "<origin>")
  .replace(/\/c\/[0-9a-f-]{36}/g, "/c/<chat>")
  // Minutes to the daily reset move while the probe runs.
  .replace(/Resets in \d+[mh]/g, "Resets in <time>"));

const STRIPE_PLANS = [
  { id: "lite", name: "Plus", priceLabel: "AED 15", amountAed: 15, chargeAed: 16.5, currency: "AED", checkout: "stripe" },
  { id: "pro", name: "Pro", priceLabel: "AED 30", amountAed: 30, chargeAed: 32, currency: "AED", checkout: "stripe" }
];
const STRIPE_COUPON = {
  coupon: { code: "TRYKLUI", percentOff: 100, trialDays: 14 },
  offers: STRIPE_PLANS.map((plan) => ({ planId: plan.id, code: "TRYKLUI", trialDays: 14, initialAmountAed: 0, initialChargeAed: 0, renewalChargeAed: plan.chargeAed }))
};

const results = [];
const browser = await chromium.launch();
for (const site of SITES) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const phone = viewport.width < 500;
    await reset();
    await setFree(site.user);
    const context = await browser.newContext({ viewport, hasTouch: phone });
    const auth = JSON.stringify(await session(site.user));
    await context.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), auth);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Belt and braces: no request may leave for a payment provider.
    await page.route(/^https?:\/\/([^/]*\.)?(mamopay|ziina|stripe)\.com\//i, (route) => { errors.push(`blocked ${route.request().url()}`); return route.abort(); });
    const shots = {};
    const out = {};
    const snap = async (name) => {
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        const email = document.getElementById("paywallEmail");
        if (email?.textContent) email.textContent = "student@klui.test";
        // The fixture users' emails differ wherever they show.
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) if (walker.currentNode.data.includes("@new.")) walker.currentNode.data = walker.currentNode.data.replace("@new.", "@");
        document.querySelectorAll(".hero-line, .mobile-home-greeting, .toast, .toast-stack").forEach((el) => { el.style.visibility = "hidden"; });
        document.querySelectorAll(".account-usage-note").forEach((el) => { el.textContent = el.textContent.replace(/Resets in \d+[mh]/, "Resets in <time>"); });
      });
      shots[name] = await page.screenshot({ animations: "disabled" });
      out[name] = await page.evaluate(() => {
        const shape = (el, depth = 0) => depth > 7 ? "" : `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${[...el.classList].sort().join(".")}${el.disabled ? ":disabled" : ""}[${[...el.children].map((c) => shape(c, depth + 1)).join(",")}]`;
        const part = (id) => {
          const el = document.getElementById(id);
          return el ? { hidden: el.classList.contains("hidden"), shape: shape(el), text: el.innerText.replace(/\s+/g, " ").trim() } : null;
        };
        return {
          paywall: part("paywallView"),
          usage: [part("profileMenuUsage")?.text, part("mobileSettingsUsage")?.text],
          pricing: document.getElementById("mobileSettingsPricing")?.classList.contains("hidden"),
          upgrade: document.getElementById("profileMenuUpgrade")?.classList.contains("hidden"),
          billing: document.getElementById("settingsAccountBillingRow")?.classList.contains("hidden"),
          cancel: document.getElementById("settingsAccountCancelRow")?.innerText.replace(/\s+/g, " ").trim(),
          temporary: document.body.classList.contains("temporary-chat"),
          path: location.pathname + location.search
        };
      });
    };
    const closePaywall = async () => {
      if (await page.isVisible("#paywallBackButton")) await page.click("#paywallBackButton");
      await page.waitForTimeout(300);
    };
    const home = async () => {
      await page.goto(site.origin);
      await page.waitForSelector("#promptInput");
      await page.waitForTimeout(2000);
    };
    process.stderr.write(`${site.user} ${viewport.width}\n`);

    await home();
    await snap("home");
    if (phone) {
      await page.click("#nativeMobileMenu");
      await page.waitForTimeout(400);
      await page.click("#accountButton");
      await page.waitForTimeout(500);
      await snap("settings");
      await page.click("#mobileSettingsPricing");
      await snap("pricingButton");
      await closePaywall();
    } else {
      await page.click("#accountButton");
      await snap("profileMenu");
      await page.click("#profileMenuUpgrade");
      await snap("upgradeItem");
      await closePaywall();
    }
    // A feature the free plan doesn't have asks to upgrade instead of turning on.
    await home();
    await page.evaluate(() => document.getElementById("temporaryChatToggle")?.click());
    await snap("temporaryBlocked");
    await closePaywall();
    await home();
    await page.evaluate(() => document.getElementById("voiceButton")?.click());
    await snap("dictationBlocked");
    await closePaywall();
    // A send counts against the day's messages; with none left it asks to upgrade.
    await home();
    await page.click("#promptInput");
    await page.keyboard.type("hello");
    await page.click("#sendButton");
    await page.waitForFunction(() => document.querySelector("#sendButton")?.getAttribute("aria-label") !== "Stop" && document.querySelectorAll(".message-row, .message, [data-message-id]").length > 1, undefined, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    out.sentCount = await page.evaluate(() => document.getElementById("profileMenuUsage")?.innerText.replace(/\s+/g, " ").replace(/Resets in \d+[mh]/, "Resets in <time>").trim());
    await useUpFreeMessages(site.user);
    await home();
    await snap("usedUp");
    await page.click("#promptInput");
    await page.keyboard.type("again");
    await page.click("#sendButton");
    await snap("usedUpSend");
    await closePaywall();
    // The invite code form sits open in invite-only mode.
    await home();
    await page.evaluate(() => document.getElementById("voiceModeButton")?.click());
    await page.waitForSelector("#paywallCouponInput", { state: "visible", timeout: 5000 }).catch(() => {});
    await snap("inviteOnly");
    await page.fill("#paywallCouponInput", "nope");
    await page.click("#paywallCouponApply");
    await snap("badInvite");
    await page.fill("#paywallCouponInput", "tryklui");
    await page.click("#paywallCouponApply");
    await page.waitForFunction(() => /Pro is now active/.test(document.getElementById("paywallCouponStatus")?.textContent || ""), undefined, { timeout: 8000 }).catch(() => {});
    await snap("redeemed");

    // Stripe, stubbed: a paying customer's Settings, and the plans with a trial coupon.
    await page.route("**/api/plans", (route) => route.fulfill({ json: { plans: STRIPE_PLANS } }));
    await page.route("**/api/payments/stripe/coupon", (route) => route.fulfill({ json: STRIPE_COUPON }));
    await page.route("**/api/me", async (route) => {
      const me = await (await route.fetch()).json();
      route.fulfill({ json: { ...me, billingPortalAvailable: true, access: { ...me.access, mode: "subscription" }, subscription: { provider: "stripe", status: "trialing", planId: "pro", currentPeriodEnd: "2026-12-01T20:00:00.000Z", cancelAtPeriodEnd: false } } });
    });
    await home();
    await page.evaluate(() => document.getElementById("profileMenuSettings")?.click());
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('[data-settings-tab="account"]')?.click());
    await snap("stripeAccount");
    await home();
    await page.evaluate(() => document.getElementById("profileMenuUpgrade")?.click());
    await snap("stripePlans");
    if (await page.isVisible("#paywallCouponToggle")) {
      await page.click("#paywallCouponToggle");
      await page.fill("#paywallCouponInput", "tryklui");
      await page.click("#paywallCouponApply");
      await page.waitForSelector("#paywallCouponApplied:not(.hidden)", { timeout: 5000 }).catch(() => {});
      await snap("stripeTrial");
    }

    out.errors = errors;
    results.push({ site: site.user, viewport: viewport.width, out: normalize(out), shots });
    await context.close();
  }
}
await browser.close();
await reset();

let failed = 0;
for (const width of [1440, 390]) {
  const [a, b] = ["old", "new"].map((s) => results.find((r) => r.site === s && r.viewport === width));
  for (const key of new Set([...Object.keys(a.out), ...Object.keys(b.out)])) {
    const x = JSON.stringify(a.out[key]), y = JSON.stringify(b.out[key]);
    let pixels = 0;
    if (a.shots[key] && b.shots[key]) {
      const p = PNG.sync.read(a.shots[key]), q = PNG.sync.read(b.shots[key]);
      pixels = p.width === q.width && p.height === q.height ? pixelmatch(p.data, q.data, null, p.width, p.height, { threshold: 0 }) : -1;
    }
    if (pixels && process.env.PROBE_DUMP) {
      const fs = await import("node:fs");
      fs.writeFileSync(`devtools/parity/out/free-${width}-${key}-old.png`, a.shots[key]);
      fs.writeFileSync(`devtools/parity/out/free-${width}-${key}-new.png`, b.shots[key]);
    }
    if (x !== y) {
      for (const k of Object.keys(a.out[key] || {})) if (JSON.stringify(a.out[key][k]) !== JSON.stringify(b.out[key]?.[k])) console.log(`  ${k}: old=${JSON.stringify(a.out[key][k])}\n  ${k}: new=${JSON.stringify(b.out[key]?.[k])}`);
    }
    if (x !== y || pixels) failed++;
    console.log(`${x === y && !pixels ? "same   " : "DIFFERS"} ${width} ${key} px=${pixels}  old=${x?.slice(0, 300)}`);
  }
}
process.exit(failed ? 1 : 0);

// The pricing screen on the old site and the new client, for a signed-in user
// without a plan: opened by sending, the coupon panel (open, a bad code, a good
// code, remove), Back to chat, then (on desktop) opened from the profile menu's
// Upgrade and closed, then a ?coupon= link. Compares the panel's structure, text
// and pixels after each step. Never presses a plan button: that would start a
// checkout.
// Needs a second local server in subscription mode (payments pointed at a dead
// local address), with its own reference site and client:
//   ACCESS_MODE=subscription PORT=55601 APP_URL=http://localhost:55601 \
//     MAMO_API_KEY=local-dead MAMO_API_BASE=http://127.0.0.1:9 MAMO_COUPONS=FIRST50:50 \
//     node --env-file=clients/devtools/local-backend/parity.env server/index.js
//   node devtools/parity/reference-server.mjs 5182 http://localhost:55601
//   (cd web && KLUI_API_TARGET=http://localhost:55601 npx vite --port 5183)
//   node devtools/parity/paywall-probe.mjs
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { reset, session } from "../local-backend/fixtures.mjs";

const SITES = [
  { origin: "http://localhost:5182", user: "old" },
  { origin: "http://localhost:5183", user: "new" }
];
const normalize = (value) => JSON.parse(JSON.stringify(value)
  .replace(/student@(new\.)?klui\.test/g, "student@klui.test")
  .replace(/localhost:518[23]/g, "<origin>"));

const results = [];
const browser = await chromium.launch();
for (const site of SITES) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await reset();
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500 });
    const auth = JSON.stringify(await session(site.user));
    await context.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), auth);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // Belt and braces: no request may leave for a payment provider.
    await page.route(/^https?:\/\/([^/]*\.)?(mamopay|ziina)\.com\//i, (route) => { errors.push(`blocked ${route.request().url()}`); return route.abort(); });
    const shots = {};
    const paywall = async (name) => {
      await page.waitForTimeout(600);
      // The fixture users' emails differ, and the home greeting types itself out at random.
      await page.evaluate(() => {
        const email = document.getElementById("paywallEmail");
        if (email?.textContent) email.textContent = "student@klui.test";
        document.querySelectorAll(".hero-line, .mobile-home-greeting").forEach((el) => { el.style.visibility = "hidden"; });
      });
      shots[name] = await page.screenshot({ animations: "disabled" });
      return page.evaluate(() => {
        const root = document.getElementById("paywallView");
        const shape = (el, depth = 0) => depth > 6 ? "" : `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${[...el.classList].sort().join(".")}${el.disabled ? ":disabled" : ""}[${[...el.children].map((c) => shape(c, depth + 1)).join(",")}]`;
        return {
          views: ["setupView", "paywallView", "chatView", "researchReportView"].map((id) => `${id}:${document.getElementById(id)?.classList.contains("hidden")}`).join(" "),
          shape: shape(root),
          text: root.innerText.replace(/\s+/g, " ").trim(),
          input: document.getElementById("paywallCouponInput")?.value,
          expanded: document.getElementById("paywallCouponToggle")?.getAttribute("aria-expanded"),
          path: location.pathname + location.search
        };
      });
    };
    const out = {};
    process.stderr.write(`${site.user} ${viewport.width}\n`);
    const home = async (path = "/") => {
      await page.goto(site.origin + path);
      // Without a plan the chat list never loads; wait for the shell instead.
      await page.waitForSelector("#promptInput");
      await page.waitForTimeout(2000);
    };
    const send = async () => {
      await page.click("#promptInput");
      await page.keyboard.type("hello");
      // Enter is a newline on phones.
      await page.click("#sendButton");
      await page.waitForSelector("#paywallView:not(.hidden) #paywallPlans > *", { timeout: 10000 });
    };
    const upgrade = async () => {
      await page.click("#accountButton");
      await page.waitForTimeout(300);
      out.upgradeItem = await page.$eval("#profileMenuUpgrade", (b) => `${b.className}|${b.innerText.trim()}`);
      await page.click("#profileMenuUpgrade");
    };
    await home();
    out.home = await page.evaluate(() => ["paywallView", "chatView"].map((id) => `${id}:${document.getElementById(id).classList.contains("hidden")}`).join(" "));
    await send();
    out.sent = await paywall("sent");
    await page.click("#paywallCouponToggle");
    out.couponOpen = await paywall("couponOpen");
    await page.fill("#paywallCouponInput", "nope");
    await page.click("#paywallCouponApply");
    out.badCoupon = await paywall("badCoupon");
    await page.fill("#paywallCouponInput", "first50");
    await page.click("#paywallCouponApply");
    await page.waitForSelector("#paywallCouponApplied:not(.hidden)", { timeout: 5000 }).catch(() => {});
    out.goodCoupon = await paywall("goodCoupon");
    if (await page.isVisible("#paywallCouponRemove")) {
      await page.click("#paywallCouponRemove");
      out.removed = await paywall("removed");
    }
    if (await page.isVisible("#paywallBackButton")) {
      await page.click("#paywallBackButton");
      out.back = await paywall("back");
    }
    // Phones open Settings from the account button; Upgrade is a desktop menu item.
    if (viewport.width > 500 && await page.isVisible("#chatView")) {
      await upgrade();
      out.upgraded = await paywall("upgraded");
      if (await page.isVisible("#paywallCloseButton")) {
        await page.click("#paywallCloseButton");
        out.closed = await paywall("closed");
      }
    }
    await home("/?coupon=FIRST50");
    await send();
    await page.waitForTimeout(800);
    out.couponLink = await paywall("couponLink");
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
  for (const key of Object.keys(a.out)) {
    const x = JSON.stringify(a.out[key]), y = JSON.stringify(b.out[key]);
    let pixels = 0;
    if (a.shots[key] && b.shots[key]) {
      const p = PNG.sync.read(a.shots[key]), q = PNG.sync.read(b.shots[key]);
      pixels = p.width === q.width && p.height === q.height ? pixelmatch(p.data, q.data, null, p.width, p.height, { threshold: 0 }) : -1;
    }
    if (pixels && process.env.PROBE_DUMP) {
      const fs = await import("node:fs");
      fs.writeFileSync(`devtools/parity/out/paywall-${width}-${key}-old.png`, a.shots[key]);
      fs.writeFileSync(`devtools/parity/out/paywall-${width}-${key}-new.png`, b.shots[key]);
    }
    if (x !== y) {
      const keysOf = (o) => (o && typeof o === "object" ? Object.keys(o) : []);
      for (const k of keysOf(a.out[key])) if (JSON.stringify(a.out[key][k]) !== JSON.stringify(b.out[key]?.[k])) console.log(`  ${k}: old=${JSON.stringify(a.out[key][k])}\n  ${k}: new=${JSON.stringify(b.out[key]?.[k])}`);
    }
    if (x !== y || pixels) failed++;
    console.log(`${x === y && !pixels ? "same   " : "DIFFERS"} ${width} ${key} px=${pixels}  old=${x.slice(0, 400)}${x === y ? "" : `\n                      new=${y.slice(0, 400)}`}`);
  }
}
process.exit(failed ? 1 : 0);

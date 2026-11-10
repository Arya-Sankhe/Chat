// The admin surfaces on the old site and the new client, for a user whose local
// profile role is admin: the profile menu's Admin item, the account drawer and
// its dashboard (loaded, the reports tab), closing it by Escape, the overlay and
// the close button, saving the global system prompt from Settings (then putting
// it back), and signing out from the drawer. The dashboard reads the local
// database only. Resets the fixtures first; needs the local backend running:
//   node devtools/parity/admin-probe.mjs
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import { reset, session, setRole } from "../local-backend/fixtures.mjs";

const SITES = [
  { origin: "http://localhost:5181", user: "old" },
  { origin: "http://localhost:5180", user: "new" }
];
const normalize = (value) => JSON.parse(JSON.stringify(value)
  .replace(/student@(new\.)?klui\.test/g, "student@klui.test"));

const results = [];
const browser = await chromium.launch();
for (const site of SITES) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await reset();
    // Both, so the dashboard's user list (cached a minute by the server) reads
    // the same whichever site loads it.
    for (const user of ["old", "new"]) await setRole(user, "admin");
    const phone = viewport.width < 500;
    const context = await browser.newContext({ viewport, hasTouch: phone });
    const auth = JSON.stringify(await session(site.user));
    await context.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), auth);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com)/, (route) => {
      errors.push(`blocked ${new URL(route.request().url()).host}`);
      return route.abort();
    });
    const shots = {};
    const out = {};
    const snap = async (name) => {
      await page.waitForTimeout(600);
      // Each site signs in as its own fixture user; show both as the same email.
      await page.evaluate(() => {
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walk.nextNode(); node; node = walk.nextNode()) {
          if (node.nodeValue.includes("@new.klui.test")) node.nodeValue = node.nodeValue.replace(/student@new\.klui\.test/g, "student@klui.test");
        }
        document.querySelectorAll(".hero-line, .mobile-home-greeting").forEach((el) => { el.style.visibility = "hidden"; });
        // The server caches the dashboard a minute, so the second site reads it cached.
        document.querySelectorAll("#adminOutput *").forEach((el) => {
          if (el.childNodes.length === 1 && el.firstChild.nodeType === 3 && /^Cached overview/.test(el.textContent)) el.textContent = el.textContent.replace("Cached", "Fresh");
        });
      });
      shots[name] = await page.screenshot({ animations: "disabled" });
      out[name] = await page.evaluate(() => {
        const shape = (el, depth = 0) => depth > 6 ? "" : `${el.tagName.toLowerCase()}.${[...el.classList].sort().join(".")}${el.hidden ? ":hidden" : ""}[${[...el.children].map((c) => shape(c, depth + 1)).join(",")}]`;
        const drawer = document.getElementById("accountDrawer");
        const overlay = document.getElementById("overlay");
        return {
          body: [...document.body.classList].filter((c) => !["mobile-ui", "capacitor-native"].includes(c)).sort().join(" "),
          overlay: `${overlay.hidden}:${overlay.dataset.mode || ""}`,
          drawer: `${drawer.className}|${drawer.getAttribute("aria-hidden")}`,
          shape: shape(drawer),
          text: drawer.innerText.replace(/\s+/g, " ").trim().slice(0, 1200),
          adminItem: (({ className, hidden }) => `${className}|${hidden}`)(document.getElementById("profileMenuAdmin")),
          prompt: `${document.getElementById("settingsSystemPromptSection").className}|${document.getElementById("systemPromptInput").value.slice(0, 80)}|${document.getElementById("saveSystemPromptButton").textContent}`,
          settings: document.getElementById("settingsDrawer").className,
          promptBox: (({ top, height }) => `${Math.round(top)},${Math.round(height)}`)(document.getElementById("systemPromptInput").getBoundingClientRect()),
          toast: document.querySelector("#toast.visible")?.textContent || ""
        };
      });
    };
    const step = async (name, action) => {
      try {
        await Promise.race([action(), new Promise((_, reject) => setTimeout(() => reject(new Error("step timed out")), 30000))]);
      } catch (error) {
        out[`${name}Error`] = error.message.split("\n")[0];
      }
      await snap(name);
      process.stderr.write(`${site.user} ${viewport.width} ${name}\n`);
    };
    const openAdmin = async () => {
      await page.click("#accountButton");
      await page.waitForTimeout(300);
      await page.click("#profileMenuAdmin");
      await page.waitForTimeout(400);
    };

    await page.goto(site.origin + "/");
    await page.waitForSelector("#conversationList [data-open-chat-id]", { state: "attached" });
    await page.waitForTimeout(800);
    if (!phone) {
      await step("profileMenu", () => page.click("#accountButton"));
      await step("drawer", async () => { await page.click("#profileMenuAdmin"); await page.waitForTimeout(1000); });
      await step("dashboard", async () => {
        await page.click("#loadAdminButton");
        await page.waitForSelector("#adminOutput [data-admin-tab]", { timeout: 10000 });
      });
      await step("reportsTab", () => page.click("[data-admin-tab=reports]"));
      await step("escape", () => page.keyboard.press("Escape"));
      await step("overlayClick", async () => {
        await openAdmin();
        await page.mouse.click(200, 450);
      });
      await step("closeButton", async () => {
        await openAdmin();
        await page.click("#closeAccountButton");
      });
      await step("settings", async () => {
        await page.click("#accountButton");
        await page.waitForTimeout(300);
        await page.click("#profileMenuSettings");
      });
    } else {
      // Phones open Settings from the account button.
      await step("settings", async () => {
        await page.click("#nativeMobileMenu");
        await page.waitForTimeout(400);
        await page.click("#accountButton");
      });
      // Phone Settings opens on its section list.
      await step("general", async () => {
        await page.click("[data-settings-tab=general] >> visible=true");
        await page.locator("#systemPromptInput").scrollIntoViewIfNeeded();
      });
    }
    const original = await page.inputValue("#systemPromptInput");
    await step("promptSaved", async () => {
      await page.fill("#systemPromptInput", "You are a careful tutor. (parity probe)");
      await page.click("#saveSystemPromptButton");
      await page.waitForSelector("#toast.visible", { timeout: 8000 });
    });
    // Put the global prompt back for the next run.
    // (The textarea can be scrolled away by then; set it directly.)
    await page.evaluate((value) => {
      document.getElementById("systemPromptInput").value = value;
      document.getElementById("saveSystemPromptButton").click();
    }, original);
    await page.waitForTimeout(1500);
    if (!phone) {
      await step("signedOut", async () => {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        await openAdmin();
        await page.click("#signOutButton");
        await page.waitForTimeout(1500);
      });
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
  for (const key of Object.keys(a.out)) {
    const x = JSON.stringify(a.out[key]), y = JSON.stringify(b.out[key]);
    // A hair above 0: rounded corners over a blurred backdrop can differ by one
    // colour level between runs.
    let pixels = 0;
    if (a.shots[key] && b.shots[key]) {
      const p = PNG.sync.read(a.shots[key]), q = PNG.sync.read(b.shots[key]);
      pixels = p.width === q.width && p.height === q.height ? pixelmatch(p.data, q.data, null, p.width, p.height, { threshold: 0.01 }) : -1;
      if (pixels && process.env.PROBE_DUMP) {
        const fs = await import("node:fs");
        fs.writeFileSync(`devtools/parity/out/admin-${width}-${key}-old.png`, a.shots[key]);
        fs.writeFileSync(`devtools/parity/out/admin-${width}-${key}-new.png`, b.shots[key]);
      }
    }
    if (x !== y || pixels) failed++;
    console.log(`${x === y && !pixels ? "same   " : "DIFFERS"} ${width} ${key} px=${pixels}  old=${x.slice(0, process.env.PROBE_FULL ? 4000 : 300)}`);
    if (x !== y) {
      for (const k of Object.keys(a.out[key] || {})) {
        if (JSON.stringify(a.out[key][k]) !== JSON.stringify(b.out[key]?.[k])) console.log(`    ${k}: old=${JSON.stringify(a.out[key][k]).slice(0, 600)}\n    ${k}: new=${JSON.stringify(b.out[key]?.[k]).slice(0, 600)}`);
      }
      if (typeof a.out[key] !== "object") console.log(`    new=${y.slice(0, 500)}`);
    }
  }
}
process.exit(failed ? 1 : 0);

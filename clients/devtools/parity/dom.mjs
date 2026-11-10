// Prints the old site's rendered DOM for a selector, signed in as the parity
// user, to port markup from. Usage: node dom.mjs <path> <selector> [width] [max-chars]
import { chromium } from "playwright";
import { session } from "../local-backend/fixtures.mjs";

const [route = "/", selector = "body", width = "1440", max = "8000"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 } });
await page.addInitScript((value) => localStorage.setItem("klui.auth.v1", value), JSON.stringify(await session("old")));
await page.goto(`http://localhost:5181${route}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
console.log(await page.evaluate(([sel, n]) => [...document.querySelectorAll(sel)].map((el) => el.outerHTML).join("\n").slice(0, n), [selector, Number(max)]));
console.log("\n[body]", await page.evaluate(() => `class="${document.body.className}" data=${JSON.stringify({ ...document.body.dataset })} html.class="${document.documentElement.className}" style="${document.documentElement.getAttribute("style") || ""}"`));
await browser.close();

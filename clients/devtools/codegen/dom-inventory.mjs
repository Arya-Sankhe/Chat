// Lists what the old site's scripts change in the DOM after load: the static
// public/index.html is only part of the spec. Compares it with a settled DOM
// saved by the parity harness (out/<state>/old.html).
// Usage: node devtools/codegen/dom-inventory.mjs <settled.html> [more.html...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const original = fs.readFileSync(path.join(here, "../../../public/index.html"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();

for (const file of process.argv.slice(2)) {
  const settled = fs.readFileSync(file, "utf8");
  const report = await page.evaluate(([a, b]) => {
    const parse = (html) => new DOMParser().parseFromString(html, "text/html");
    const before = parse(a), after = parse(b);
    const label = (el) => {
      if (!el || el.nodeType !== 1) return "?";
      const cls = el.getAttribute("class");
      return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls.trim().split(/\s+/).join(".") : ""}`;
    };
    // The nearest ancestor with an id names where a change happened.
    const anchor = (el) => {
      let node = el.parentElement;
      while (node && !node.id && node.tagName !== "BODY") node = node.parentElement;
      return node ? label(node) : "(detached)";
    };
    const attrs = (el) => Object.fromEntries([...el.attributes].map((x) => [x.name, x.value]));
    const out = [];
    for (const root of ["html", "body"]) {
      const x = attrs(before.querySelector(root)), y = attrs(after.querySelector(root));
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (x[k] !== y[k]) out.push(`${root}[${k}]: ${JSON.stringify(x[k] ?? null)} -> ${JSON.stringify(y[k] ?? null)}`);
      }
    }
    const ids = (doc) => new Map([...doc.querySelectorAll("body [id]")].map((el) => [el.id, el]));
    const ib = ids(before), ia = ids(after);
    for (const [id, el] of ib) {
      const now = ia.get(id);
      if (!now) { out.push(`removed  #${id} (was in ${anchor(el)})`); continue; }
      if ((el.parentElement?.id || anchor(el)) !== (now.parentElement?.id || anchor(now))) out.push(`moved    #${id}: ${anchor(el)} -> ${anchor(now)}`);
      const x = attrs(el), y = attrs(now);
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (x[k] !== y[k] && k !== "style") out.push(`attr     #${id}[${k}]: ${JSON.stringify(x[k] ?? null)} -> ${JSON.stringify(y[k] ?? null)}`);
        if (x[k] !== y[k] && k === "style") out.push(`style    #${id}: ${y[k] ?? "(none)"}`);
      }
      // Content an id'd element gained that the static markup did not have.
      const kidsB = el.querySelectorAll("*").length, kidsA = now.querySelectorAll("*").length;
      if (!el.children.length && now.children.length) out.push(`filled   #${id}: ${now.children.length} child(ren), first ${label(now.firstElementChild)}`);
      else if (kidsB !== kidsA && ![...now.querySelectorAll("[id]")].length) out.push(`changed  #${id}: ${kidsB} -> ${kidsA} descendants`);
    }
    for (const [id, el] of ia) if (!ib.has(id)) out.push(`added    #${id} ${label(el)} in ${anchor(el)}`);
    // New body-level nodes without ids (portals, reparented sheets).
    const top = (doc) => [...doc.body.children].map(label);
    const tb = new Set(top(before));
    for (const l of top(after)) if (!tb.has(l)) out.push(`body+    ${l}`);
    return out;
  }, [original, settled]);
  console.log(`\n== ${path.relative(process.cwd(), file)} (${report.length})\n${report.join("\n")}`);
}
await browser.close();

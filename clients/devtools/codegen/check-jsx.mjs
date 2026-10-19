// Proves html-to-jsx output is faithful: renders the generated component with
// React, parses it and the original region in Chromium, and compares tags,
// attributes and rendered text (whitespace collapsed, as the browser renders it).
// Usage: node devtools/codegen/check-jsx.mjs <css-selector>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const selector = process.argv[2];
const tsx = execFileSync("node", [path.join(here, "html-to-jsx.mjs"), selector, "Region"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const js = ts.transpileModule(tsx, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const temp = path.join(here, `.check-${process.pid}.mjs`);
fs.writeFileSync(temp, js);
let rendered;
try {
  const { Region } = await import(pathToFileURL(temp).href);
  rendered = renderToStaticMarkup(createElement(Region));
} finally {
  fs.rmSync(temp);
}

const source = fs.readFileSync(path.join(here, "../../../public/index.html"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
const problems = await page.evaluate(([original, sel, markup]) => {
  const doc = new DOMParser().parseFromString(original, "text/html");
  const a = doc.querySelector(sel);
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  // React 19 may hoist resource hints (e.g. an image preload) ahead of the region.
  const b = [...holder.children].find((el) => el.tagName !== "LINK");
  const out = [];
  const where = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className?.baseVal ?? el.className ? "." + String(el.className?.baseVal ?? el.className).split(" ").join(".") : ""}`;
  const kids = (el) => [...el.childNodes].filter((n) => (n.nodeType === 1 && n.tagName !== "SCRIPT") || n.nodeType === 3);
  // Adjacent text merges and whitespace collapses, as in layout.
  // Edge whitespace in a box never renders; between two non-inline siblings it
  // doesn't either, so both count as empty.
  const INLINE = new Set(["A", "ABBR", "B", "BUTTON", "CODE", "EM", "I", "IMG", "INPUT", "KBD", "LABEL", "SELECT", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "svg", "TEXTAREA", "U", "BR"]);
  const textOf = (nodes) => {
    const elements = nodes.filter((n) => n.nodeType === 1);
    const parts = nodes.map((n) => (n.nodeType === 3 ? n.data : "\u0000")).join("").replace(/\s+/g, " ").split("\u0000");
    return parts.map((s, i) => {
      if (i === 0) return s.trimStart();
      if (i === parts.length - 1) return s.trimEnd();
      return s === " " && !(INLINE.has(elements[i - 1].tagName) && INLINE.has(elements[i].tagName)) ? "" : s;
    });
  };
  const cmp = (x, y) => {
    if (x.tagName !== y.tagName) return out.push(`tag ${where(x)} vs ${where(y)}`);
    const ax = [...x.attributes].map((t) => `${t.name}=${t.value}`).sort().join("\n");
    const ay = [...y.attributes].map((t) => `${t.name}=${t.value}`).sort().join("\n");
    if (ax !== ay) out.push(`attrs ${where(x)}:\n  old ${ax.replace(/\n/g, " | ")}\n  new ${ay.replace(/\n/g, " | ")}`);
    if (x.tagName === "STYLE") return;
    const kx = kids(x), ky = kids(y);
    if (textOf(kx).join("|") !== textOf(ky).join("|")) out.push(`text ${where(x)}`);
    const ex = kx.filter((n) => n.nodeType === 1), ey = ky.filter((n) => n.nodeType === 1);
    if (ex.length !== ey.length) return out.push(`children ${where(x)} ${ex.length} vs ${ey.length}`);
    ex.forEach((c, i) => cmp(c, ey[i]));
  };
  cmp(a, b);
  return out;
}, [source, selector, rendered]);
await browser.close();
console.log(problems.length ? problems.join("\n") : `${selector}: identical`);
process.exitCode = problems.length ? 1 : 0;

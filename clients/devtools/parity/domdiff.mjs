// Structural diff of two saved DOMs (the harness's old.html / new.html): tags,
// attributes and rendered text, with whitespace compared as layout sees it.
// Fixture identities differ per user by design, so ids and emails are
// normalized first. Used by run.mjs; also runnable on its own:
//   node devtools/parity/domdiff.mjs out/<state>/old.html out/<state>/new.html
import fs from "node:fs";
import { chromium } from "playwright";

const normalize = (html) => html
  .replace(/00000000-0000-4000-([0-9a-f]{4})-[ab](\d{11})/g, "00000000-0000-4000-$1-X$2")
  .replace(/00000000-0000-4000-8000-0000000000[ab]1/g, "USER")
  .replace(/student(\.new)?@klui\.test/g, "EMAIL");

/** Runs in the page: returns a list of human-readable differences. */
function compareInPage([a, b]) {
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const docA = parse(a), docB = parse(b);
  const out = [];
  const label = (el) => {
    const cls = el.getAttribute("class");
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls.trim().split(/\s+/).join(".") : ""}`;
  };
  const path = (el) => {
    const parts = [];
    for (let node = el; node && node.tagName !== "HTML"; node = node.parentElement) {
      parts.unshift(label(node));
      if (node.id) break;
    }
    return parts.join(" > ");
  };
  const INLINE = new Set(["A", "ABBR", "B", "BUTTON", "CODE", "EM", "I", "IMG", "INPUT", "KBD", "LABEL", "SELECT", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "svg", "TEXTAREA", "U", "BR"]);
  // Scripts and the dev server's own nodes are not part of the page's UI.
  const ignored = (n) => n.nodeType === 1 && (n.tagName === "SCRIPT" || n.tagName === "NOSCRIPT" || n.tagName === "VITE-ERROR-OVERLAY" || (n.tagName === "STYLE" && n.hasAttribute("data-vite-dev-id")) || n.hasAttribute?.("data-parity"));
  const kids = (el) => [...el.childNodes].filter((n) => (n.nodeType === 1 && !ignored(n)) || n.nodeType === 3);
  const textOf = (nodes) => {
    const elements = nodes.filter((n) => n.nodeType === 1);
    const parts = nodes.map((n) => (n.nodeType === 3 ? n.data : "\u0000")).join("").replace(/\s+/g, " ").split("\u0000");
    return parts.map((s, i) => {
      if (i === 0) return s.trimStart();
      if (i === parts.length - 1) return s.trimEnd();
      return s === " " && !(INLINE.has(elements[i - 1].tagName) && INLINE.has(elements[i].tagName)) ? "" : s;
    });
  };
  // Class order and style declaration order don't affect rendering.
  const canonical = (name, value) => name === "class" ? value.trim().split(/\s+/).sort().join(" ")
    : name === "style" ? value.replace(/;\s*$/, "").split(/;\s*/).filter(Boolean).sort().join("; ")
      : value;
  // An emptied style attribute (style="") renders like none.
  const attrs = (el) => new Map([...el.attributes].filter((t) => !(t.name === "style" && !t.value.trim())).map((t) => [t.name, canonical(t.name, t.value)]));
  const cmp = (x, y) => {
    if (out.length > 200) return;
    if (x.tagName !== y.tagName) { out.push(`tag      ${path(x)}  vs  ${label(y)}`); return; }
    const ax = attrs(x), ay = attrs(y);
    for (const k of new Set([...ax.keys(), ...ay.keys()])) {
      if (ax.get(k) !== ay.get(k)) out.push(`attr     ${path(x)} [${k}]  old=${JSON.stringify(ax.get(k) ?? null)}  new=${JSON.stringify(ay.get(k) ?? null)}`);
    }
    if (x.tagName === "STYLE") return;
    const kx = kids(x), ky = kids(y);
    const tx = textOf(kx), ty = textOf(ky);
    // With different children the text runs can't be paired; the missing or
    // extra nodes are reported instead.
    const sameShape = kx.filter((n) => n.nodeType === 1).length === ky.filter((n) => n.nodeType === 1).length;
    if (sameShape && tx.join("|") !== ty.join("|")) out.push(`text     ${path(x)}  old=${JSON.stringify(tx.filter(Boolean).join(" ").slice(0, 80))}  new=${JSON.stringify(ty.filter(Boolean).join(" ").slice(0, 80))}`);
    const ex = kx.filter((n) => n.nodeType === 1), ey = ky.filter((n) => n.nodeType === 1);
    // Align children by identity (tag, id, first class) so one missing node is
    // reported once instead of shifting every comparison after it.
    const key = (el) => `${el.tagName}#${el.id}.${(el.getAttribute("class") || "").trim().split(/\s+/)[0]}`;
    const n = ex.length, m = ey.length;
    const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = key(ex[i]) === key(ey[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && key(ex[i]) === key(ey[j])) { cmp(ex[i++], ey[j++]); continue; }
      if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) out.push(`missing  ${path(ex[i++])}`);
      else out.push(`extra    ${path(x)} > ${label(ey[j++])}`);
    }
  };
  for (const root of ["html", "body"]) {
    const ax = attrs(docA.querySelector(root)), ay = attrs(docB.querySelector(root));
    for (const k of new Set([...ax.keys(), ...ay.keys()])) {
      if (ax.get(k) !== ay.get(k)) out.push(`attr     ${root} [${k}]  old=${JSON.stringify(ax.get(k) ?? null)}  new=${JSON.stringify(ay.get(k) ?? null)}`);
    }
  }
  cmp(docA.body, docB.body);
  return out;
}

export async function domDiff(browser, oldHtml, newHtml) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(compareInPage, [normalize(oldHtml), normalize(newHtml)]);
  } finally {
    await page.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [a, b] = process.argv.slice(2);
  const browser = await chromium.launch();
  const lines = await domDiff(browser, fs.readFileSync(a, "utf8"), fs.readFileSync(b, "utf8"));
  await browser.close();
  console.log(lines.length ? lines.join("\n") : "identical");
}

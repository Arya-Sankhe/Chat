// One-off generator: converts regions of the old site's public/index.html into
// TSX so the new web client starts from byte-for-byte the same markup. The
// output is hand-owned afterwards; this is kept only to re-derive a region.
// Usage: node devtools/codegen/html-to-jsx.mjs <css-selector> [ComponentName]
// Parses with Chromium (already a dev dependency) so the tree is exactly what a
// browser builds from the file; inline <script> elements are dropped and listed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "../../../public/index.html"), "utf8");
const [selector, componentName = "Region"] = process.argv.slice(2);
if (!selector) throw new Error("usage: html-to-jsx.mjs <selector> [ComponentName]");

const browser = await chromium.launch();
const page = await browser.newPage();
const tree = await page.evaluate(([source, sel]) => {
  const doc = new DOMParser().parseFromString(source, "text/html");
  const root = doc.querySelector(sel);
  if (!root) return null;
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return { text: node.data };
    if (node.nodeType === Node.COMMENT_NODE) return { comment: node.data };
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    return {
      tag: node.namespaceURI === "http://www.w3.org/2000/svg" ? node.tagName : node.tagName.toLowerCase(),
      svg: node.namespaceURI === "http://www.w3.org/2000/svg",
      attrs: [...node.attributes].map((a) => [a.name, a.value]),
      children: [...(node.tagName === "TEMPLATE" ? node.content.childNodes : node.childNodes)].map(walk).filter(Boolean)
    };
  };
  return walk(root);
}, [html, selector]);
await browser.close();
if (!tree) throw new Error(`no element matches ${selector}`);

const RENAMED = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly", maxlength: "maxLength",
  minlength: "minLength", autocomplete: "autoComplete", autocapitalize: "autoCapitalize", autocorrect: "autoCorrect",
  spellcheck: "spellCheck", fetchpriority: "fetchPriority", contenteditable: "contentEditable",
  enterkeyhint: "enterKeyHint", inputmode: "inputMode", novalidate: "noValidate", autofocus: "autoFocus",
  colspan: "colSpan", rowspan: "rowSpan", srcset: "srcSet", crossorigin: "crossOrigin", playsinline: "playsInline",
  autoplay: "autoPlay", allowfullscreen: "allowFullScreen", referrerpolicy: "referrerPolicy", datetime: "dateTime",
  enctype: "encType", accesskey: "accessKey", "accept-charset": "acceptCharset", "http-equiv": "httpEquiv",
  "xlink:href": "xlinkHref", "xml:space": "xmlSpace", "xmlns:xlink": "xmlnsXlink"
};
const BOOLEAN = new Set(["hidden", "disabled", "readOnly", "multiple", "required", "noValidate", "autoFocus", "muted",
  "playsInline", "autoPlay", "allowFullScreen", "open", "loop", "controls", "defaultChecked", "selected", "inert"]);
// React types these as numbers; the rendered attribute is the same.
const NUMERIC = new Set(["maxLength", "minLength", "rows", "cols", "size", "span", "colSpan", "rowSpan", "tabIndex",
  "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-level", "aria-posinset", "aria-setsize", "aria-colcount", "aria-rowcount"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const dropped = [];

const camel = (name) => name.replace(/[-:]([a-z])/g, (_, c) => c.toUpperCase());
const str = (value) => JSON.stringify(value);

function propName(name, el) {
  if (name.startsWith("aria-") || name.startsWith("data-")) return name;
  if (RENAMED[name]) return RENAMED[name];
  if (el.svg && /[-:]/.test(name)) return camel(name);
  if (el.tag === "input" && name === "checked") return "defaultChecked";
  if ((el.tag === "input" || el.tag === "textarea") && name === "value") return "defaultValue";
  return name;
}

function styleObject(css) {
  const entries = css.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(":");
    const key = d.slice(0, i).trim();
    return `${str(key.startsWith("--") ? key : camel(key))}: ${str(d.slice(i + 1).trim())}`;
  });
  return `{{ ${entries.join(", ")} }}`;
}

function attrs(el) {
  return el.attrs.map(([name, value]) => {
    const prop = propName(name, el);
    if (prop === "style") return ` style=${styleObject(value)}`;
    if (BOOLEAN.has(prop) && (value === "" || value === name)) return ` ${prop}`;
    if (NUMERIC.has(prop) && /^-?\d+(\.\d+)?$/.test(value)) return ` ${prop}={${value}}`;
    return ` ${prop}=${/["{}<>\\\n]/.test(value) ? `{${str(value)}}` : `"${value}"`}`;
  }).join("");
}

// HTML collapses whitespace runs outside pre/textarea, so emitting each text
// node collapsed renders identically while staying stable under JSX rules.
function text(value, pre) {
  if (pre) return `{${str(value)}}`;
  const collapsed = value.replace(/\s+/g, " ");
  if (collapsed === " ") return `{" "}`;
  if (/^[^{}<>&"'`]*$/.test(collapsed) && collapsed.trim() === collapsed) return collapsed;
  return `{${str(collapsed)}}`;
}

function emit(node, depth, pre = false) {
  const pad = "  ".repeat(depth);
  if (node.comment != null) return "";
  if (node.text != null) return pad + text(node.text, pre);
  if (node.tag === "script") {
    dropped.push(`<script> ${node.children.map((c) => c.text || "").join("").trim().slice(0, 60)}...`);
    return "";
  }
  if (node.tag === "style") {
    return `${pad}<style>{${str(node.children.map((c) => c.text || "").join(""))}}</style>`;
  }
  const open = `${pad}<${node.tag}${attrs(node)}`;
  const kids = node.children.filter((c) => c.comment == null && c.tag !== "script");
  if (VOID.has(node.tag) || !kids.length) return `${open} />`;
  const inPre = pre || node.tag === "pre" || node.tag === "textarea";
  if (node.tag === "textarea") return `${open} defaultValue={${str(kids.map((c) => c.text || "").join(""))}} />`;
  // Leading/trailing whitespace inside a block renders nothing; drop it so the
  // output reads like hand-written JSX.
  let list = kids;
  if (!inPre) {
    while (list.length && list[0].text != null && !list[0].text.trim()) list = list.slice(1);
    while (list.length && list.at(-1).text != null && !list.at(-1).text.trim()) list = list.slice(0, -1);
  }
  if (list.length === 1 && list[0].text != null) return `${open}>${text(list[0].text, inPre)}</${node.tag}>`;
  const body = list.map((c) => emit(c, depth + 1, inPre)).filter(Boolean)
    // A newline-only text node between elements is the source indentation.
    .filter((line) => line.trim() !== `{" "}` || !whitespaceIsIgnorable(list));
  return `${open}>\n${body.join("\n")}\n${pad}</${node.tag}>`;
}

// Whitespace between siblings only shows when the siblings are inline content;
// keep it whenever any sibling is a text node or an inline-level tag.
const INLINE = new Set(["a", "abbr", "b", "button", "code", "em", "i", "img", "input", "kbd", "label", "select",
  "small", "span", "strong", "sub", "sup", "svg", "textarea", "u", "br"]);
function whitespaceIsIgnorable(list) {
  return !list.some((c) => (c.text != null && c.text.trim()) || INLINE.has(c.tag));
}

const jsx = emit(tree, 2);
process.stdout.write(`export function ${componentName}() {\n  return (\n${jsx}\n  );\n}\n`);
if (dropped.length) process.stderr.write(`Dropped ${dropped.length} inline script(s):\n${dropped.join("\n")}\n`);

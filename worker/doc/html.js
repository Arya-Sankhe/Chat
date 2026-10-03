// DocSpec -> print HTML. Chromium prints this to the PDF, so everything here is paged-media
// CSS: @page margin boxes carry running headers and footers, blocks avoid splitting across
// pages, headings stay with what follows, table headers repeat on every page.
//
// Every block carries data-block="<id>", so a selection in the viewer maps back to the block.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import katex from "katex";
import { chartSvg, formatValue } from "./charts.js";
import { parseInline, textBlocks } from "./inline.js";
import { plain } from "./spec.js";
import { resolveStyle } from "./themes.js";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = path.resolve(HERE, "../fonts/doc");
const KATEX_CSS_PATH = require.resolve("katex/dist/katex.min.css");

const FONT_FILES = {
  "Inter": [[400, "normal", "Inter-Regular"], [500, "normal", "Inter-Medium"], [600, "normal", "Inter-SemiBold"], [700, "normal", "Inter-Bold"], [800, "normal", "Inter-ExtraBold"], [400, "italic", "Inter-Italic"], [600, "italic", "Inter-SemiBoldItalic"], [700, "italic", "Inter-SemiBoldItalic"]],
  "Source Serif 4": [[400, "normal", "SourceSerif4-Regular"], [600, "normal", "SourceSerif4-SemiBold"], [700, "normal", "SourceSerif4-Bold"], [400, "italic", "SourceSerif4-Italic"], [600, "italic", "SourceSerif4-SemiBoldItalic"], [700, "italic", "SourceSerif4-SemiBoldItalic"]],
  "Lora": [[400, "normal", "Lora-Regular"], [600, "normal", "Lora-SemiBold"], [700, "normal", "Lora-Bold"], [400, "italic", "Lora-Italic"]],
  "EB Garamond": [[400, "normal", "EBGaramond-Regular"], [600, "normal", "EBGaramond-SemiBold"], [700, "normal", "EBGaramond-Bold"], [400, "italic", "EBGaramond-Italic"]],
  "IBM Plex Sans": [[400, "normal", "IBMPlexSans-Regular"], [500, "normal", "IBMPlexSans-Medium"], [600, "normal", "IBMPlexSans-SemiBold"], [700, "normal", "IBMPlexSans-Bold"], [400, "italic", "IBMPlexSans-Italic"]],
  "JetBrains Mono": [[400, "normal", "JetBrainsMono-Regular"], [600, "normal", "JetBrainsMono-SemiBold"]]
};

let katexCss = null;
function katexStyles() {
  if (katexCss === null) {
    const dir = path.dirname(KATEX_CSS_PATH);
    katexCss = fs.readFileSync(KATEX_CSS_PATH, "utf8").replace(/url\((['"]?)fonts\//g, (_m, q) => `url(${q}${pathToFileURL(path.join(dir, "fonts")).href}/`);
  }
  return katexCss;
}

function fontFaces(families) {
  const out = [];
  for (const family of new Set(families)) {
    for (const [weight, style, file] of FONT_FILES[family] || []) {
      const fontPath = path.join(FONT_DIR, `${file}.ttf`);
      out.push(`@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:url("${pathToFileURL(fontPath).href}") format("truetype");}`);
    }
  }
  return out.join("\n");
}

export function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function smartQuotes(text) {
  return text
    .replace(/(^|[\s([{“‘—–-])"(?=\S)/g, "$1“").replace(/"/g, "”")
    .replace(/(^|[\s([{“—–-])'(?=\S)/g, "$1‘").replace(/'/g, "’")
    .replace(/ -- /g, " — ").replace(/(\d)-(\d)(?=\D|$)/g, "$1–$2");
}

function mathHtml(latex, display = false) {
  try {
    return katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: "ignore", output: "html", trust: false });
  } catch {
    return `<code>${esc(latex)}</code>`;
  }
}

export function inline(text) {
  return parseInline(text).map((run) => {
    if (run.math) return run.display ? `<span class="math-display">${mathHtml(run.text, true)}</span>` : mathHtml(run.text);
    if (run.code) return `<code>${esc(run.text)}</code>`;
    let html = esc(smartQuotes(run.text)).replace(/\n/g, "<br>");
    if (run.sup) html = `<sup>${html}</sup>`;
    if (run.sub) html = `<sub>${html}</sub>`;
    if (run.strike) html = `<s>${html}</s>`;
    if (run.italic) html = `<em>${html}</em>`;
    if (run.bold) html = `<strong>${html}</strong>`;
    if (run.href) html = `<a href="${esc(run.href)}">${html}</a>`;
    return html;
  }).join("");
}

function richText(text) {
  return textBlocks(text).map((block) => {
    if (block.type === "list") {
      const tag = block.style === "number" ? "ol" : "ul";
      return `<${tag} class="${block.style === "check" ? "checklist" : ""}">${block.items.map((item) => {
        const value = typeof item === "string" ? item : item.text;
        const box = block.style === "check" ? `<span class="box${item.checked ? " on" : ""}"></span>` : "";
        return `<li>${box}${inline(value)}</li>`;
      }).join("")}</${tag}>`;
    }
    if (block.type === "equation") return `<div class="equation">${mathHtml(block.latex, true)}</div>`;
    return `<p>${inline(block.text)}</p>`;
  }).join("");
}

function listHtml(items, style, start, depth = 0) {
  const tag = style === "number" && depth === 0 ? "ol" : style === "number" ? "ol" : "ul";
  const cls = style === "check" ? ' class="checklist"' : "";
  const startAttr = start && start !== 1 && depth === 0 ? ` start="${start}"` : "";
  return `<${tag}${cls}${startAttr}>${items.map((item) => {
    const text = typeof item === "string" ? item : item.text;
    const children = typeof item === "object" && item.items?.length ? listHtml(item.items, style === "check" ? "bullet" : style, null, depth + 1) : "";
    const box = style === "check" && depth === 0 ? `<span class="box${item.checked ? " on" : ""}"></span>` : "";
    return `<li>${box}${inline(text)}${children}</li>`;
  }).join("")}</${tag}>`;
}

const NUMERIC = /^[\s(+−–-]*[$€£¥₹]?\s*[\d.,]+\s*(%|[kKmMbB]n?|x|×|pts?|pp|bps|°C?|mL|L|g|kg|mg|m|cm|mm|km|s|ms|min|h|hrs?|yrs?|years?)?\)?\s*([±]\s*[\d.,]+\s*%?)?$/;

export function columnAlignments(block) {
  return block.columns.map((column, i) => {
    if (typeof column === "object" && column.align) return column.align;
    const cells = block.rows.map((row) => plain(row[i] || "").trim()).filter((cell) => cell && !/^[—–-]$/.test(cell));
    if (i === 0 || !cells.length) return "left";
    const numeric = cells.filter((cell) => NUMERIC.test(cell)).length;
    return numeric / cells.length >= 0.75 ? "right" : "left";
  });
}

// Relative column widths from content length, so prose columns get room and numbers stay tight.
export function columnWeights(block) {
  return block.columns.map((column, i) => {
    if (typeof column === "object" && column.width) return column.width;
    // Body cells set the width; a long header wraps, so only its longest word counts.
    const lengths = block.rows.map((row) => plain(row[i] || "").length);
    const sorted = lengths.slice().sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length * 0.75)] || 4;
    const longestWord = Math.max(...[typeof column === "string" ? column : column.label, ...block.rows.map((row) => row[i] || "")].flatMap((value) => plain(value).split(/[\s/–-]+/)).map((word) => word.length));
    return Math.max(longestWord * 1.25 + 3, Math.min(60, typical), 6);
  });
}

function headingNumbers(blocks, enabled) {
  const numbers = new Map();
  if (!enabled) return numbers;
  // Writers sometimes number their own headings; then numbering is left to them.
  if (blocks.some((block) => block.type === "heading" && /^(\d+(\.\d+)*[.)]?|[IVX]+\.|[A-Z]\.)\s/.test(block.text))) return numbers;
  const counter = [0, 0, 0];
  for (const block of blocks) {
    if (block.type !== "heading" || block.level > 2) continue;
    counter[block.level - 1] += 1;
    for (let i = block.level; i < counter.length; i += 1) counter[i] = 0;
    numbers.set(block.id, block.level === 1 ? `${counter[0]}.` : `${counter[0]}.${counter[1]}`);
  }
  return numbers;
}

function cssContent(template, doc) {
  // "{page}" / "{pages}" / "{title}" -> CSS content concatenation.
  const parts = String(template || "").split(/(\{page\}|\{pages\}|\{title\}|\{author\})/g).filter((part) => part !== "");
  if (!parts.length) return "none";
  return parts.map((part) => {
    if (part === "{page}") return "counter(page)";
    if (part === "{pages}") return "counter(pages)";
    const value = part === "{title}" ? doc.title || "" : part === "{author}" ? doc.author || "" : part;
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
  }).join(" ");
}

function surname(author) {
  const words = String(author || "").replace(/,.*$/, "").trim().split(/\s+/);
  return words[words.length - 1] || "";
}

function runningSlots(doc, theme) {
  const short = (value, max) => {
    const text = plain(value || "");
    return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
  };
  const layout = theme.layout;
  const header = { left: "", center: "", right: "" };
  const footer = { left: "", center: "", right: "" };
  if (layout.header === "surname-page") header.right = `${surname(doc.author)} {page}`.trim();
  if (layout.header === "page-right") header.right = "{page}";
  if (layout.footer === "title-page") {
    footer.left = short(doc.title, 70);
    footer.right = "Page {page} of {pages}";
  } else if (layout.footer === "title-section-page") {
    footer.left = short(doc.kicker || doc.title, 60);
    footer.center = doc.kicker ? short(doc.title, 50) : "";
    footer.right = "Page {page} of {pages}";
  } else if (layout.footer === "page-center") {
    footer.center = "{page}";
  }
  // A header or footer the document sets replaces the style's default one.
  for (const slot of ["left", "center", "right"]) {
    if (doc.header) header[slot] = doc.header[slot] ?? "";
    if (doc.footer) footer[slot] = doc.footer[slot] ?? "";
  }
  return { header, footer };
}

const PAGE_SIZES = { A4: "A4", Letter: "letter", Legal: "legal" };

// No glyph-swapping font features (tabular-nums, contextual alternates): Chromium's PDF writer
// gives the swapped glyphs no Unicode, so digits and hyphens would select and copy as garbage.
function css(doc, theme) {
  const c = theme.colors;
  const f = theme.fonts.pdf;
  const t = theme.type;
  const l = theme.layout;
  const [mt, mr, mb, ml] = l.margins;
  const { header, footer } = runningSlots(doc, theme);
  const slotCss = (slots, where) => ["left", "center", "right"].map((slot) => {
    const value = slots[slot];
    if (!value) return "";
    return `@${where}-${slot}{content:${cssContent(value, doc)};}`;
  }).join("");
  const firstPageHeader = l.titleBlock === "apa" ? "" : "@top-left{content:none}@top-center{content:none}@top-right{content:none}";
  const keepHeaderOnFirst = l.header === "surname-page" || l.header === "page-right";
  const stack = (face) => `"${face}", ${["Source Serif 4", "Lora", "EB Garamond", "Liberation Serif", "Gelasio", "Caladea"].includes(face) ? "serif" : "sans-serif"}`;
  const headingCase = t.headingCase === "upper" ? "uppercase" : "none";
  const smallCaps = t.headingCase === "smallcaps" ? "small-caps" : "normal";
  const justify = l.justify ?? (theme.name === "academic" || theme.name === "lab");
  return `
${fontFaces([f.heading, f.body, f.label, f.mono].filter((face) => FONT_FILES[face]))}
${katexStyles()}
@page{size:${PAGE_SIZES[doc.page?.size] || "A4"} ${doc.page?.orientation === "landscape" ? "landscape" : "portrait"};margin:${mt}mm ${mr}mm ${mb}mm ${ml}mm;
  ${slotCss(header, "top")}${slotCss(footer, "bottom")}
  @bottom-left{font:${t.base * 0.78}pt ${stack(f.label)};color:#${c.muted};letter-spacing:${l.plain ? 0 : 0.02}em;vertical-align:top;padding-top:4mm;${l.plain ? "" : `border-top:0.6pt solid #${c.rule};`}}
  @bottom-center{font:${t.base * 0.78}pt ${stack(f.label)};color:#${c.muted};vertical-align:top;padding-top:4mm;${l.plain ? "" : `border-top:0.6pt solid #${c.rule};`}}
  @bottom-right{font:${t.base * 0.78}pt ${stack(f.label)};color:#${c.muted};vertical-align:top;padding-top:4mm;${l.plain ? "" : `border-top:0.6pt solid #${c.rule};`}}
  @top-left{font:${l.plain ? `${t.base}pt` : `${t.base * 0.78}pt`} ${stack(l.plain ? f.body : f.label)};color:#${l.plain ? c.text : c.muted};vertical-align:bottom;padding-bottom:4mm;}
  @top-center{font:${l.plain ? `${t.base}pt` : `${t.base * 0.78}pt`} ${stack(l.plain ? f.body : f.label)};color:#${l.plain ? c.text : c.muted};vertical-align:bottom;padding-bottom:4mm;}
  @top-right{font:${l.plain ? `${t.base}pt` : `${t.base * 0.78}pt`} ${stack(l.plain ? f.body : f.label)};color:#${l.plain ? c.text : c.muted};vertical-align:bottom;padding-bottom:${l.plain ? "6mm" : "4mm"};}
}
${keepHeaderOnFirst ? "" : `@page:first{${firstPageHeader}}`}
:root{--ink:#${c.ink};--text:#${c.text};--muted:#${c.muted};--faint:#${c.faint};--rule:#${c.rule};--accent:#${c.accent};--accent2:#${c.accent2};--surface:#${c.surface};--surface2:#${c.surfaceStrong};--th:#${c.tableHead};--tht:#${c.tableHeadText};--stripe:#${c.stripe};--pos:#${c.positive};--neg:#${c.negative};--warn:#${c.warn};}
*{box-sizing:border-box;}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{margin:0;font-family:${stack(f.body)};font-size:${t.base}pt;line-height:${t.line};color:var(--text);font-kerning:normal;text-rendering:geometricPrecision;orphans:3;widows:3;font-feature-settings:"calt" 0;}
main{width:100%;}
p{margin:0 0 ${t.paragraphGap ?? 0.62}em;${justify ? "text-align:justify;hyphens:auto;" : ""}${t.indent ? "text-indent:0.5in;" : ""}}
a{color:var(--accent);text-decoration:none;}
strong{font-weight:${f.body === "Inter" ? 650 : 700};color:${l.plain ? "inherit" : "var(--ink)"};}
code{font-family:${stack(f.mono)};font-size:0.88em;background:var(--surface);padding:0.05em 0.3em;border-radius:3px;}
sup,sub{font-size:0.7em;line-height:0;}
.katex{font-size:1.08em;}
.katex-display{margin:0;}
.math-display{display:block;margin:0.45em 0;text-align:center;text-indent:0;}
h1,h2,h3,h4{font-family:${stack(f.heading)};color:var(--ink);font-weight:${t.headingWeight};margin:0;break-after:avoid;page-break-after:avoid;line-height:1.25;}
.keep{break-inside:avoid;page-break-inside:avoid;}

/* Title blocks */
.title-block{margin:0 0 ${l.plain ? "0" : "1.4em"};}
.kicker{font-family:${stack(f.label)};font-size:${t.base * 0.78}pt;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--accent);margin:0 0 0.7em;}
.doc-title{font-size:${t.title}pt;line-height:1.12;letter-spacing:${f.heading === "Inter" ? "-0.02em" : "-0.005em"};margin:0;}
.doc-subtitle{font-size:${t.subtitle}pt;color:var(--muted);margin:0.45em 0 0;line-height:1.4;font-weight:400;}
.title-rule{border:0;border-top:${theme.name === "briefing" ? "2.5pt" : "1.2pt"} solid var(--ink);margin:1.1em 0 0;}
.meta-grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:0.4em 1.4em;margin:1.05em 0 0;padding:0.75em 0 0;border-top:0.6pt solid var(--rule);}
.title-rule + .meta-grid{border-top:0;padding-top:0;}
.meta-grid .label{display:block;font-family:${stack(f.label)};font-size:${t.base * 0.72}pt;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);font-weight:600;}
.meta-grid .value{display:block;font-size:${t.base * 0.95}pt;color:var(--ink);font-weight:500;}
.title-block.center{text-align:center;}
.title-block.center .doc-subtitle{font-style:italic;}
.title-block.center .byline{margin-top:0.9em;color:var(--muted);font-size:${t.base}pt;}
.title-block.center .meta-grid{justify-content:center;text-align:center;border-top:0;}
.mla-head p, .apa-title p{text-indent:0;text-align:left;margin:0;}
.mla-title{text-align:center;text-indent:0 !important;margin:0;font-weight:400;}
.apa-titlepage{height:100%;text-align:center;padding-top:28%;break-after:page;}
.apa-titlepage p{text-indent:0;text-align:center;margin:0;}
.apa-titlepage .apa-main-title{font-weight:700;margin-bottom:${t.base * 2}pt;}
.apa-running-title{text-align:center;font-weight:700;text-indent:0;margin:0;}
.cv-head{text-align:${l.cvAlign === "left" ? "left" : "center"};margin:0 0 0.5em;}
.cv-name{font-size:${t.title}pt;line-height:1.1;margin:0;${theme.name === "cv_modern" ? "color:var(--accent);letter-spacing:-0.01em;" : "letter-spacing:0.01em;"}}
.cv-headline{margin:0.3em 0 0;font-size:${t.base * 1.02}pt;color:var(--muted);}
.cv-contact{margin:0.35em 0 0;font-size:${t.base * 0.93}pt;color:var(--text);}
.cv-contact span + span::before{content:"${theme.name === "cv" ? "  ◇  " : "  |  "}";white-space:pre;color:var(--faint);}
.letterhead{margin:0 0 2.2em;padding-bottom:0.9em;border-bottom:1pt solid var(--accent);}
.letterhead .lh-name{font-size:${t.title}pt;color:var(--ink);margin:0;line-height:1.1;}
.letterhead .lh-sub{margin:0.25em 0 0;color:var(--muted);font-family:${stack(f.label)};font-size:${t.base * 0.82}pt;letter-spacing:0.02em;}
.letterhead .lh-contact{margin:0.35em 0 0;font-family:${stack(f.label)};font-size:${t.base * 0.8}pt;color:var(--muted);}
.letterhead .lh-contact span + span::before{content:"  ·  ";white-space:pre;}

/* Headings */
.h{display:flex;align-items:baseline;gap:0.8em;}
.h .num{color:inherit;font-weight:inherit;}
.h .tag{margin-left:auto;font-family:${stack(f.label)};font-size:${t.base * 0.74}pt;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);white-space:nowrap;}
h2.h{font-size:${t.h1}pt;margin:${l.plain ? "0.6em 0 0.3em" : "1.55em 0 0.6em"};text-transform:${headingCase};font-variant:${smallCaps};letter-spacing:${t.tracking}em;${l.headingRule === "below" ? "padding-bottom:0.35em;border-bottom:0.8pt solid var(--rule);" : ""}${l.headingRule === "above" ? "padding-top:0.5em;border-top:1pt solid var(--ink);" : ""}}
h3.h{font-size:${t.h2}pt;margin:1.15em 0 0.4em;${theme.name === "briefing" ? "color:var(--ink);" : ""}}
h4.h{font-size:${t.h3}pt;margin:0.95em 0 0.3em;color:${l.plain ? "var(--ink)" : "var(--accent)"};${theme.name === "briefing" || theme.name === "lab" ? "text-transform:uppercase;letter-spacing:0.08em;font-size:" + t.h3 * 0.86 + "pt;" : ""}}
main > .h:first-child, .title-block + .h{margin-top:0.2em;}
.mla h2.h,.apa h2.h{justify-content:center;text-align:center;font-weight:700;}
.mla h3.h,.apa h3.h{font-weight:700;}
.apa h4.h{font-style:italic;font-weight:700;color:var(--ink);}
.cvdoc h2.h{margin:0.95em 0 0.4em;padding-bottom:0.12em;border-bottom:0.8pt solid ${theme.name === "cv" ? "var(--ink)" : "var(--rule)"};font-size:${t.h1}pt;${theme.name === "cv_modern" ? "color:var(--accent);" : ""}}

/* Text blocks */
.lead{font-size:${t.base * 1.12}pt;line-height:1.55;color:var(--ink);}
ul,ol{margin:0 0 0.75em;padding-left:1.35em;}
li{margin:0 0 0.28em;padding-left:0.15em;}
li > ul, li > ol{margin:0.28em 0 0.2em;}
/* List numbers and bullets take the item text's colour, as heading numbers take the heading's. */
ul li::marker,ol li::marker{font-variant-numeric:normal;color:inherit;font-weight:inherit;}
ul.checklist{list-style:none;padding-left:0.2em;}
ul.checklist > li{display:flex;gap:0.55em;align-items:baseline;}
.box{flex:0 0 auto;width:0.8em;height:0.8em;border:1pt solid var(--muted);border-radius:2px;transform:translateY(0.1em);display:inline-block;}
.box.on{background:var(--accent);border-color:var(--accent);box-shadow:inset 0 0 0 1.5pt #fff;}
blockquote{margin:1em 0 1.1em;padding:0.1em 0 0.1em 1.1em;border-left:2.5pt solid var(--accent);font-family:${stack(f.heading === "Inter" ? f.body : f.heading)};font-style:italic;font-size:${t.base * 1.06}pt;color:var(--ink);break-inside:avoid;}
.plain blockquote{border-left:0;padding-left:0.5in;font-style:normal;font-size:inherit;color:inherit;}
blockquote p{text-indent:0;margin:0 0 0.3em;}
blockquote cite{display:block;font-style:normal;font-size:${t.base * 0.85}pt;color:var(--muted);margin-top:0.4em;}
blockquote cite::before{content:"— ";}
hr.divider{border:0;border-top:0.8pt solid var(--rule);margin:1.3em 0;}
.page-break{break-after:page;height:0;}
pre.code{font-family:${stack(f.mono)};font-size:${t.base * 0.84}pt;line-height:1.5;background:var(--surface);border:0.6pt solid var(--rule);border-radius:4px;padding:0.8em 1em;white-space:pre-wrap;word-break:break-word;margin:0 0 1em;break-inside:avoid;}
.equation{display:flex;align-items:center;justify-content:center;position:relative;margin:0.75em 0 0.95em;break-inside:avoid;}
.equation .eq-num{position:absolute;right:0;color:var(--muted);font-size:${t.base * 0.9}pt;}

/* Callouts */
.callout{margin:0.9em 0 1.1em;padding:0.8em 1em 0.75em;border-radius:${l.calloutStyle === "box" ? "4px" : "0 4px 4px 0"};background:var(--cbg);${l.calloutStyle === "bar" ? "border-left:3pt solid var(--cc);" : l.calloutStyle === "box" ? "border:0.8pt solid var(--cline);" : "border:0;background:none;padding-left:0;"}break-inside:avoid;}
.callout .ct{font-family:${stack(f.label)};font-size:${t.base * 0.8}pt;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--cc);margin:0 0 0.35em;}
.callout p{margin:0 0 0.4em;text-indent:0;text-align:left;}
.callout p:last-child,.callout ul:last-child,.callout ol:last-child{margin-bottom:0;}
.callout ul,.callout ol{margin-bottom:0.4em;}
.callout.v-abstract{--cc:var(--ink);}
.callout.v-abstract p{text-align:${justify ? "justify" : "left"};}
.plain .callout{padding:0.5em 0;background:none;border:0;}

/* Tables */
figure{margin:0;}
.tbl{margin:1em 0 1.25em;}
.tbl.small{break-inside:avoid;}
.cap{font-family:${stack(f.label)};font-size:${t.base * 0.84}pt;color:var(--ink);font-weight:700;margin:0 0 0.5em;break-after:avoid;}
.cap .lbl{color:var(--accent);margin-right:0.35em;}
.cap.below{font-weight:400;color:var(--muted);margin:0.5em 0 0;font-style:${theme.name === "lab" || theme.name === "academic" ? "normal" : "normal"};}
.cap.below .lbl{color:var(--ink);font-weight:700;}
table{width:100%;border-collapse:collapse;table-layout:auto;font-size:${t.base * (theme.name === "mla" || theme.name === "apa" ? 1 : 0.88)}pt;line-height:1.38;font-family:${stack(theme.name === "lab" || theme.name === "homework" ? f.label : f.body)};}
thead{display:table-header-group;}
tr{break-inside:avoid;}
th,td{padding:0.5em 0.7em;vertical-align:top;text-align:left;overflow-wrap:break-word;hyphens:manual;}
td.r,th.r{text-align:right;}
td.c,th.c{text-align:center;}
th{font-weight:700;font-size:0.92em;}
tbody td:first-child{font-weight:${theme.name === "mla" || theme.name === "apa" ? 400 : 600};color:var(--ink);}
.t-dark thead th{background:var(--th);color:var(--tht);font-family:${stack(f.label)};font-size:0.86em;letter-spacing:0.03em;}
.t-dark tbody tr:nth-child(even) td{background:var(--stripe);}
.t-dark tbody td{border-bottom:0.6pt solid var(--rule);}
.t-dark{border-bottom:0.8pt solid var(--rule);}
.t-light thead th{background:var(--th);color:var(--tht);border-bottom:1pt solid var(--ink);font-family:${stack(f.label)};}
.t-light tbody td{border-bottom:0.6pt solid var(--rule);}
.t-light tbody tr:nth-child(even) td{background:var(--stripe);}
.t-rules{border-top:1.4pt solid var(--ink);border-bottom:1.4pt solid var(--ink);}
.t-rules thead th{border-bottom:0.8pt solid var(--ink);color:var(--ink);}
.t-rules td{padding-top:0.38em;padding-bottom:0.38em;}
.t-grid th,.t-grid td{border:0.6pt solid var(--rule);}
.t-grid thead th{background:var(--surface);color:var(--ink);}
.t-plain thead th{border-bottom:0.8pt solid var(--rule);color:var(--muted);}
tr.hl td{background:var(--hl) !important;}
tr.hl td:first-child{box-shadow:inset 2.5pt 0 0 var(--accent);}
tr.total td{font-weight:700;color:var(--ink);border-top:1pt solid var(--ink);background:transparent !important;}
.compact td,.compact th{padding:0.3em 0.55em;}
.tnote{font-size:${t.base * 0.78}pt;color:var(--muted);margin:0.45em 0 0;line-height:1.4;}

/* Charts */
.chart{margin:1.1em 0 1.3em;break-inside:avoid;}
.chart svg{width:100%;height:auto;display:block;}
.chart .chead{margin:0 0 0.7em;}
.chart .ctitle{font-family:${stack(f.label)};font-size:${t.base * 0.94}pt;font-weight:700;color:var(--ink);}
.chart .csub{font-size:${t.base * 0.82}pt;color:var(--muted);margin-top:0.15em;}
.chart.boxed{padding:1em 1.1em 0.9em;border:0.7pt solid var(--rule);border-radius:5px;}

/* Data blocks */
.stats{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:0.7em;margin:0.4em 0 1.3em;break-inside:avoid;}
.stat{padding:0.75em 0.9em 0.7em;background:var(--surface);border-top:2.5pt solid var(--accent);border-radius:0 0 4px 4px;}
.stat .sv{font-family:${stack(f.heading === "Inter" || f.heading === "IBM Plex Sans" ? f.heading : f.label)};font-size:${t.base * 1.85}pt;font-weight:700;color:var(--ink);line-height:1.1;letter-spacing:-0.01em;}
.stat .sl{font-family:${stack(f.label)};font-size:${t.base * 0.74}pt;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:var(--muted);margin-top:0.4em;line-height:1.3;}
.stat .sn{font-size:${t.base * 0.78}pt;color:var(--muted);margin-top:0.2em;}
.stat.t-negative{border-top-color:var(--neg);} .stat.t-negative .sv{color:var(--neg);}
.stat.t-positive{border-top-color:var(--pos);} .stat.t-positive .sv{color:var(--pos);}
.stat.t-warn{border-top-color:var(--warn);}
.cards{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:0.75em;margin:0.5em 0 1.2em;}
.card{padding:0.85em 1em;border:0.7pt solid var(--rule);border-radius:5px;break-inside:avoid;background:#fff;}
.card .kt{display:flex;justify-content:space-between;gap:0.6em;align-items:baseline;margin:0 0 0.35em;}
.card .kt b{font-family:${stack(f.heading)};font-size:${t.base * 1.02}pt;color:var(--ink);line-height:1.3;}
.card .kt i{font-style:normal;font-family:${stack(f.label)};font-size:${t.base * 0.7}pt;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);white-space:nowrap;}
.card p{margin:0 0 0.35em;font-size:${t.base * 0.94}pt;text-align:left;text-indent:0;}
.card p:last-child,.card ul:last-child{margin-bottom:0;}
.card ul{margin-bottom:0.3em;font-size:${t.base * 0.94}pt;}
.steps{margin:0.5em 0 1.2em;counter-reset:step;}
.step{display:grid;grid-template-columns:2.1em 1fr;gap:0 0.8em;padding:0 0 0.85em;break-inside:avoid;position:relative;}
.step::before{counter-increment:step;content:counter(step);width:1.75em;height:1.75em;border-radius:50%;background:var(--accent);color:#fff;font-family:${stack(f.label)};font-weight:700;font-size:${t.base * 0.85}pt;display:flex;align-items:center;justify-content:center;grid-row:span 2;}
.step:not(:last-child)::after{content:"";position:absolute;left:0.87em;top:2.05em;bottom:0.25em;width:0;border-left:1pt solid var(--rule);}
.step b{font-family:${stack(f.heading)};font-size:${t.base * 1.02}pt;color:var(--ink);display:block;margin:0.15em 0 0.2em;}
.step p{margin:0 0 0.3em;text-indent:0;text-align:left;}
.step p:last-child{margin-bottom:0;}
.steps.row{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:0.6em;}
.steps.row .step{display:block;padding:0.75em 0.85em;border:0.7pt solid var(--rule);border-top:2.5pt solid var(--accent);border-radius:0 0 4px 4px;background:var(--surface);}
.steps.row .step::before{display:block;width:auto;height:auto;background:none;color:var(--accent);border-radius:0;justify-content:flex-start;content:"STEP " counter(step, decimal-leading-zero);font-size:${t.base * 0.72}pt;letter-spacing:0.1em;margin-bottom:0.3em;}
.steps.row .step::after{display:none;}
.fields{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:0;margin:0.6em 0 1.2em;border-top:0.7pt solid var(--rule);break-inside:avoid;}
.field{display:grid;grid-template-columns:minmax(6.5em,38%) 1fr;gap:0.8em;padding:0.48em 0.2em;border-bottom:0.7pt solid var(--rule);}
.fields.c1 .field{grid-template-columns:minmax(8em,28%) 1fr;}
.field .fl{font-family:${stack(f.label)};font-size:${t.base * 0.84}pt;font-weight:700;color:var(--ink);}
.field .fv{color:var(--text);}
.field .fv.blank{border-bottom:0.7pt solid var(--muted);min-height:1.3em;}
.fields.boxed{border:0.7pt solid color-mix(in srgb, var(--accent2) 30%, white);border-radius:4px;background:color-mix(in srgb, var(--accent2) 7%, white);padding:0 0.6em;}
.fields.boxed .field:last-child{border-bottom:0;}

/* Problems and answers */
.problem{margin:1.5em 0 0.7em;break-inside:avoid;}
.problem .ph{display:flex;align-items:baseline;gap:0.65em;margin:0 0 0.55em;break-after:avoid;}
.problem .badge{font-family:${stack(f.label)};font-size:${t.base * 0.72}pt;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#fff;background:var(--accent);padding:0.25em 0.6em;border-radius:3px;white-space:nowrap;}
.problem .pt{font-family:${stack(f.heading)};font-size:${t.h2}pt;font-weight:700;color:var(--ink);}
.problem .pb{padding:0.75em 1em;background:var(--surface);border-radius:4px;}
.problem .pb p{margin:0 0 0.4em;text-indent:0;}
.problem .pb p:last-child,.problem .pb ol:last-child,.problem .pb ul:last-child{margin-bottom:0;}
.answer{display:flex;gap:1em;align-items:center;margin:0.8em 0 1.4em;padding:0.6em 1em;border:1pt solid var(--accent2);background:color-mix(in srgb, var(--accent2) 7%, white);border-radius:4px;break-inside:avoid;}
.answer .al{font-family:${stack(f.label)};font-size:${t.base * 0.72}pt;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--accent2);white-space:nowrap;}
.answer .av{flex:1;color:var(--ink);font-weight:500;}
.answer .av p{margin:0;text-indent:0;}
.answer .katex-display{margin:0.2em 0;}
.plain .answer{border-color:var(--ink);background:none;}
.plain .answer .al{color:var(--ink);}

/* CV entries */
.entry{margin:0 0 0.6em;break-inside:avoid;}
.entry .er{display:flex;justify-content:space-between;gap:1em;align-items:baseline;}
.entry .e1 b{font-weight:700;color:var(--ink);}
.entry .e2{font-style:${theme.name === "cv" ? "italic" : "normal"};color:${theme.name === "cv" ? "var(--text)" : "var(--muted)"};}
.entry .date{white-space:nowrap;color:${theme.name === "cv" ? "var(--text)" : "var(--muted)"};}
.entry ul{margin:0.18em 0 0;padding-left:1.15em;}
.entry li{margin:0 0 0.12em;}
.entry li::marker{color:var(--text);}
.entry p{margin:0.1em 0 0;text-indent:0;}
.cvdoc p{margin-bottom:0.3em;}
.cvdoc .fields{border-top:0;margin:0.2em 0 0.4em;display:block;}
.cvdoc .field{display:block;border:0;padding:0.06em 0;}
.cvdoc .field .fl{font-family:inherit;font-size:inherit;}
.cvdoc .field .fl::after{content:": ";}
.cvdoc .field .fl,.cvdoc .field .fv{display:inline;}

/* References */
.refs{margin:0.4em 0 1em;padding:0;list-style:none;}
.refs li{break-inside:avoid;padding-left:0.5in;text-indent:-0.5in;margin:0 0 ${theme.layout.plain ? "0" : "0.5em"};font-size:${theme.layout.plain ? t.base : t.base * 0.9}pt;line-height:${theme.layout.plain ? t.line : 1.45};}
.refs.numbered{counter-reset:ref;}
.refs.numbered li{padding-left:2em;text-indent:-2em;}
.refs.numbered li::before{counter-increment:ref;content:"[" counter(ref) "]";display:inline-block;width:2em;text-indent:0;}
.mla .refs-title{break-before:page;}
.refs-title{${theme.layout.plain ? "text-align:center;font-weight:400;font-size:inherit;margin:0 0 0;" : ""}}
img.fig{max-width:100%;display:block;margin:0 auto;border-radius:3px;}
.figure{margin:1em 0 1.2em;break-inside:avoid;text-align:center;}
.toc{margin:0.5em 0 1.5em;padding:0.9em 1.1em;background:var(--surface);border-radius:4px;break-inside:avoid;}
.toc .tt{font-family:${stack(f.label)};font-size:${t.base * 0.78}pt;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-bottom:0.4em;}
.toc ol{margin:0;padding-left:1.4em;columns:2;column-gap:2em;}
.toc li{margin:0 0 0.2em;break-inside:avoid;}
`;
}

const CALLOUT_LOOK = {
  note: ["accent", "Note"], tip: ["accent2", "Tip"], key: ["accent", "Key point"], important: ["warn", "Important"],
  warning: ["neg", "Warning"], example: ["accent2", "Example"], definition: ["accent", "Definition"],
  summary: ["accent", "Summary"], success: ["pos", "Result"], abstract: ["ink", "Abstract"]
};

function calloutVars(variant, theme) {
  const c = theme.colors;
  const token = CALLOUT_LOOK[variant]?.[0] || "accent";
  const color = { accent: c.accent, accent2: c.accent2, warn: c.warn, neg: c.negative, pos: c.positive, ink: c.ink }[token] || c.accent;
  const neutral = token === "ink" ? c.surface : null;
  return `--cc:#${color};--cbg:${neutral ? `#${neutral}` : `color-mix(in srgb, #${color} 6%, white)`};--cline:color-mix(in srgb, #${color} 30%, white);`;
}

function titleBlock(doc, theme) {
  const layout = theme.layout;
  const meta = [...(doc.meta || [])];
  if (layout.titleBlock === "mla") {
    const lines = meta.length ? meta.map((item) => item.value) : [doc.author, doc.date].filter(Boolean);
    return `<div class="mla-head">${lines.map((value) => `<p>${inline(value)}</p>`).join("")}</div>${doc.title ? `<p class="mla-title">${inline(doc.title)}</p>` : ""}`;
  }
  if (layout.titleBlock === "apa") {
    const lines = meta.length ? meta.map((item) => item.value) : [doc.author, doc.date].filter(Boolean);
    return `<section class="apa-titlepage"><p class="apa-main-title">${inline(doc.title || "")}</p>${doc.subtitle ? `<p>${inline(doc.subtitle)}</p>` : ""}${lines.map((value) => `<p>${inline(value)}</p>`).join("")}</section>${doc.title ? `<p class="apa-running-title">${inline(doc.title)}</p>` : ""}`;
  }
  if (layout.titleBlock === "cv") {
    const contact = doc.contact?.length ? doc.contact : meta.map((item) => item.value);
    return `<header class="cv-head"><h1 class="cv-name">${inline(doc.title || doc.author || "")}</h1>${doc.subtitle ? `<p class="cv-headline">${inline(doc.subtitle)}</p>` : ""}${contact.length ? `<p class="cv-contact">${contact.map((item) => `<span>${inline(item)}</span>`).join("")}</p>` : ""}</header>`;
  }
  if (layout.titleBlock === "letterhead") {
    const contact = doc.contact?.length ? doc.contact : meta.map((item) => item.value);
    return `<header class="letterhead"><h1 class="lh-name">${inline(doc.title || doc.author || "")}</h1>${doc.subtitle ? `<p class="lh-sub">${inline(doc.subtitle)}</p>` : ""}${contact.length ? `<p class="lh-contact">${contact.map((item) => `<span>${inline(item)}</span>`).join("")}</p>` : ""}</header>`;
  }
  if (!doc.title && !doc.subtitle && !doc.kicker && !meta.length) return "";
  const center = layout.titleBlock === "center";
  // With a labelled grid, the author and date join it rather than disappearing.
  if (meta.length && meta.some((item) => item.label)) {
    const has = (value) => meta.some((item) => plain(item.value).toLowerCase() === plain(value).toLowerCase());
    const extra = [];
    if (doc.author && !has(doc.author)) extra.push({ label: "Author", value: doc.author });
    if (doc.date && !has(doc.date) && meta.length < 4) extra.push({ label: "Date", value: doc.date });
    meta.unshift(...extra.slice(0, Math.max(0, 4 - meta.length)));
  }
  const cols = Math.min(4, Math.max(1, meta.length));
  const metaHtml = meta.length
    ? (center && meta.every((item) => !item.label)
      ? `<p class="byline">${meta.map((item) => inline(item.value)).join(" · ")}</p>`
      : `<div class="meta-grid" style="--cols:${cols}">${meta.map((item) => `<div>${item.label ? `<span class="label">${inline(item.label)}</span>` : ""}<span class="value">${inline(item.value)}</span></div>`).join("")}</div>`)
    : "";
  const byline = !meta.length && (doc.author || doc.date) ? `<p class="${center ? "byline" : "doc-subtitle"}">${[doc.author, doc.date].filter(Boolean).map(inline).join(" · ")}</p>` : "";
  return `<header class="title-block${center ? " center" : ""}">${doc.kicker ? `<div class="kicker">${inline(doc.kicker)}</div>` : ""}${doc.title ? `<h1 class="doc-title">${inline(doc.title)}</h1>` : ""}${doc.subtitle ? `<p class="doc-subtitle">${inline(doc.subtitle)}</p>` : ""}${byline}${layout.titleRule && !center ? '<hr class="title-rule">' : ""}${metaHtml}</header>`;
}

function tableHtml(block, theme, label) {
  const aligns = columnAlignments(block);
  const weights = columnWeights(block);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const style = theme.layout.tableStyle;
  const highlight = new Set(Array.isArray(block.highlight) ? block.highlight : block.highlight !== undefined ? [block.highlight] : []);
  const cls = (i) => (aligns[i] === "right" ? ' class="r"' : aligns[i] === "center" ? ' class="c"' : "");
  const hasHeader = block.columns.some((column) => (typeof column === "string" ? column : column.label));
  const head = hasHeader ? `<thead><tr>${block.columns.map((column, i) => `<th${cls(i)}>${inline(typeof column === "string" ? column : column.label)}</th>`).join("")}</tr></thead>` : "";
  const rows = block.rows.map((row, r) => {
    const classes = [highlight.has(r) ? "hl" : "", block.total && r === block.rows.length - 1 ? "total" : ""].filter(Boolean).join(" ");
    return `<tr${classes ? ` class="${classes}"` : ""}>${row.map((cell, i) => `<td${cls(i)}>${inline(cell)}</td>`).join("")}</tr>`;
  }).join("");
  const captionBelow = theme.name === "lab" || theme.name === "academic" || theme.layout.plain;
  const caption = block.caption ? `<div class="cap${captionBelow ? "" : ""}">${label ? `<span class="lbl">${esc(label)}</span>` : ""}${inline(block.caption)}</div>` : "";
  const note = [block.note ? `${theme.layout.plain ? "<em>Note.</em> " : ""}${inline(block.note)}` : "", block.source ? `Source: ${inline(block.source)}` : ""].filter(Boolean).join(" ");
  const small = block.rows.length <= 12;
  return `<figure class="tbl${small ? " small" : ""}" data-block="${block.id}">${caption}<table class="t-${style}${block.compact || block.rows.length > 14 ? " compact" : ""}" style="--hl:color-mix(in srgb, #${theme.colors.accent} 9%, white)"><colgroup>${weights.map((weight) => `<col style="width:${((weight / total) * 100).toFixed(1)}%">`).join("")}</colgroup>${head}<tbody>${rows}</tbody></table>${note ? `<p class="tnote">${note}</p>` : ""}</figure>`;
}

function chartHtml(block, theme, label) {
  const svg = chartSvg(block, theme, theme.fonts.pdf);
  if (!svg) return "";
  const title = block.title || block.caption;
  const lab = theme.name === "lab" || theme.name === "academic" || theme.layout.plain;
  const head = title && !lab ? `<div class="chead"><div class="ctitle">${inline(block.title || block.caption)}</div>${block.title && block.caption ? `<div class="csub">${inline(block.caption)}</div>` : ""}</div>` : "";
  const below = lab && (title || label) ? `<div class="cap below">${label ? `<span class="lbl">${esc(label)}</span>` : ""}${inline([block.title, block.caption].filter(Boolean).join(". "))}</div>` : "";
  const note = [block.note ? inline(block.note) : "", block.source ? `Source: ${inline(block.source)}` : ""].filter(Boolean).join(" ");
  return `<figure class="chart${theme.name === "briefing" ? " boxed" : ""}" data-block="${block.id}">${head}${svg}${below}${note ? `<p class="tnote">${note}</p>` : ""}</figure>`;
}

export function blockHtml(block, ctx) {
  const { theme, numbers } = ctx;
  const id = `data-block="${block.id}"`;
  switch (block.type) {
    case "heading": {
      const tag = `h${block.level + 1}`;
      const number = numbers.get(block.id);
      return `<${tag} class="h" ${id}>${number ? `<span class="num">${number}</span>` : ""}<span class="ht">${inline(block.text)}</span>${block.tag && block.level === 1 ? `<span class="tag">${inline(block.tag)}</span>` : ""}</${tag}>`;
    }
    case "paragraph":
      return `<p ${id}${block.lead ? ' class="lead"' : ""}${block.align ? ` style="text-align:${block.align};text-indent:0"` : ""}>${inline(block.text)}</p>`;
    case "list":
      return listHtml(block.items, block.style, block.start).replace(/^<(ul|ol)/, `<$1 ${id}`);
    case "table":
      ctx.tables += 1;
      return tableHtml(block, theme, ctx.labels ? `Table ${ctx.tables}.` : "");
    case "chart":
      ctx.figures += 1;
      return chartHtml(block, theme, ctx.labels ? `Figure ${ctx.figures}.` : "");
    case "callout": {
      const look = CALLOUT_LOOK[block.variant] || CALLOUT_LOOK.note;
      const title = block.title || (block.variant === "abstract" ? "Abstract" : ["note", "key"].includes(block.variant) && !block.title ? "" : look[1]);
      return `<aside class="callout v-${block.variant}" style="${calloutVars(block.variant, theme)}" ${id}>${title ? `<div class="ct">${inline(title)}</div>` : ""}${richText(block.text)}</aside>`;
    }
    case "quote":
      return `<blockquote ${id}>${richText(block.text)}${block.cite ? `<cite>${inline(block.cite)}</cite>` : ""}</blockquote>`;
    case "equation": {
      ctx.equations += 1;
      const number = theme.layout.numberEquations ? `<span class="eq-num">(${ctx.equations})</span>` : "";
      return `<div class="equation" ${id}>${mathHtml(block.latex, true)}${number}</div>`;
    }
    case "code":
      return `<pre class="code" ${id}>${esc(block.text)}</pre>`;
    case "stats":
      return `<div class="stats" style="--n:${block.items.length}" ${id}>${block.items.map((item) => `<div class="stat${item.tone ? ` t-${item.tone}` : ""}"><div class="sv">${inline(item.value)}</div><div class="sl">${inline(item.label)}</div>${item.note ? `<div class="sn">${inline(item.note)}</div>` : ""}</div>`).join("")}</div>`;
    case "cards":
      return `<div class="cards" style="--cols:${Math.min(block.columns || 2, block.items.length)}" ${id}>${block.items.map((item) => `<div class="card">${item.title || item.tag ? `<div class="kt"><b>${inline(item.title)}</b>${item.tag ? `<i>${inline(item.tag)}</i>` : ""}</div>` : ""}${richText(item.text)}</div>`).join("")}</div>`;
    case "steps": {
      const row = block.items.length >= 3 && block.items.length <= 5 && block.items.every((item) => plain(item.text).length <= 150);
      return `<div class="steps${row ? " row" : ""}" style="--n:${block.items.length}" ${id}>${block.items.map((item) => `<div class="step"><div>${item.title ? `<b>${inline(item.title)}</b>` : ""}${richText(item.text)}</div></div>`).join("")}</div>`;
    }
    case "fields": {
      const cols = block.columns || 1;
      return `<div class="fields c${cols}${block.boxed ? " boxed" : ""}" style="--cols:${cols}" ${id}>${block.items.map((item) => `<div class="field"><span class="fl">${inline(item.label)}</span><span class="fv${item.value ? "" : " blank"}">${item.value ? inline(item.value) : "&nbsp;"}</span></div>`).join("")}</div>`;
    }
    case "problem":
      return `<section class="problem" ${id}><div class="ph">${block.label ? `<span class="badge">${inline(block.label)}</span>` : ""}${block.title ? `<span class="pt">${inline(block.title)}</span>` : ""}</div>${block.text ? `<div class="pb">${richText(block.text)}</div>` : ""}</section>`;
    case "answer":
      return `<div class="answer" ${id}><span class="al">${inline(block.label)}</span><div class="av">${richText(block.text)}</div></div>`;
    case "entry": {
      const first = [block.org ? `<b>${inline(block.org)}</b>` : "", block.location ? `<span class="date">${inline(block.location)}</span>` : ""];
      const second = [block.title ? `<span class="e2">${inline(block.title)}</span>` : "", block.dates ? `<span class="date">${inline(block.dates)}</span>` : ""];
      // Without an organisation the role leads the entry.
      const rows = block.org
        ? [first, second]
        : [[block.title ? `<b>${inline(block.title)}</b>` : "", block.dates ? `<span class="date">${inline(block.dates)}</span>` : ""], block.location ? [`<span class="e2">${inline(block.location)}</span>`, ""] : null].filter(Boolean);
      if (theme.name === "cv_modern" && block.org) {
        rows[0] = [`<span class="el"><b>${inline(block.title || "")}</b>${block.title ? '<span class="e2"> · </span>' : ""}<span class="e2">${inline(block.org)}</span></span>`, block.dates ? `<span class="date">${inline(block.dates)}</span>` : ""];
        rows[1] = block.location || block.subtitle ? [`<span class="e2">${inline(block.subtitle || "")}</span>`, block.location ? `<span class="date">${inline(block.location)}</span>` : ""] : null;
      }
      const lines = rows.filter(Boolean).filter((row) => row.some(Boolean)).map((row, i) => `<div class="er e${i + 1}">${row[0] || "<span></span>"}${row[1] || ""}</div>`).join("");
      const sub = block.subtitle && theme.name !== "cv_modern" ? `<p class="e2">${inline(block.subtitle)}</p>` : "";
      return `<div class="entry" ${id}>${lines}${sub}${block.text ? `<p>${inline(block.text)}</p>` : ""}${block.bullets.length ? `<ul>${block.bullets.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>` : ""}</div>`;
    }
    case "references": {
      const numbered = block.items.every((item) => /^\[\d+\]/.test(item)) ? false : ctx.numberedRefs;
      // A reference list always sits under a heading; add one when the writer did not.
      const previous = ctx.blocks[ctx.blocks.indexOf(block) - 1];
      const fallbackTitle = theme.name === "mla" ? "Works Cited" : "References";
      const heading = block.title || (previous?.type === "heading" ? "" : fallbackTitle);
      const title = heading ? `<h2 class="h refs-title">${inline(heading)}</h2>` : "";
      return `${title}<ol class="refs${numbered ? " numbered" : ""}${block.items.length <= 6 ? " keep" : ""}" ${id}>${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`;
    }
    case "figure":
      ctx.figures += 1;
      return `<figure class="figure" ${id}><img class="fig" src="${esc(block.src)}" style="width:${block.width || 100}%" alt="">${block.caption ? `<div class="cap below">${ctx.labels ? `<span class="lbl">Figure ${ctx.figures}.</span>` : ""}${inline(block.caption)}</div>` : ""}</figure>`;
    case "divider":
      return `<hr class="divider" ${id}>`;
    case "page_break":
      return `<div class="page-break" ${id}></div>`;
    case "toc": {
      const heads = ctx.blocks.filter((entry) => entry.type === "heading" && entry.level === 1);
      return heads.length ? `<nav class="toc" ${id}><div class="tt">Contents</div><ol>${heads.map((entry) => `<li>${inline(entry.text)}</li>`).join("")}</ol></nav>` : "";
    }
    default:
      return "";
  }
}

export function renderHtml(doc) {
  const theme = resolveStyle(doc);
  const blocks = doc.blocks || [];
  const ctx = {
    theme,
    blocks,
    numbers: headingNumbers(blocks, theme.layout.numberHeadings),
    tables: 0,
    figures: 0,
    equations: 0,
    labels: ["lab", "academic", "apa", "mla"].includes(theme.name) || blocks.filter((block) => block.type === "table" || block.type === "chart").length >= 3,
    numberedRefs: theme.name === "lab"
  };
  const classes = [theme.name, theme.layout.plain ? "plain" : "", theme.layout.cv ? "cvdoc" : ""].filter(Boolean).join(" ");
  const toc = doc.toc && !blocks.some((block) => block.type === "toc") ? blockHtml({ type: "toc", id: "toc" }, ctx) : "";
  const body = blocks.map((block) => blockHtml(block, ctx)).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(plain(doc.title || "Document"))}</title><style>${css(doc, theme)}</style></head><body><main class="${classes}">${titleBlock(doc, theme)}${toc}${body}</main></body></html>`;
}

export { formatValue };

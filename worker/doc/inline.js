// Inline markup shared by the HTML and DOCX renderers. A text field becomes a list of runs:
// { text, bold, italic, code, strike, sup, sub, href, math }.
//
// Math is $...$ with a non-space, non-digit first character, so prices ("$5 and $10") stay text;
// a span that starts with a digit is math only when it holds LaTeX syntax (\, ^, _, braces).

const PATTERNS = [
  // LaTeX delimiters writers often use: \( inline \), \[ display \], and $$ display $$ in a line.
  { kind: "math", re: /\\\(([\s\S]+?)\\\)/y },
  { kind: "display", re: /\\\[([\s\S]+?)\\\]/y },
  { kind: "display", re: /\$\$([\s\S]+?)\$\$/y },
  { kind: "escape", re: /\\([\\`*_{}[\]()#+\-.!$|~^])/y },
  { kind: "code", re: /`([^`\n]+)`/y },
  { kind: "math", re: /\$(?![\s\d])((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/y },
  // "$38\,\mathrm{J/K}$": a leading number is still math when LaTeX syntax follows.
  { kind: "math", re: /\$(\d[^$\n]*?[\\^_{}][^$\n]*?)(?<!\s)\$(?!\d)/y },
  { kind: "link", re: /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/y },
  { kind: "url", re: /(https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?'"])/y },
  { kind: "bold", re: /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*(?!\*)/y },
  { kind: "bold", re: /__(?=[^\s_])([\s\S]+?)(?<=[^\s_])__(?![\w_])/y },
  { kind: "strike", re: /~~(?=\S)([\s\S]+?)(?<=\S)~~/y },
  { kind: "italic", re: /\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?!\*)/y },
  { kind: "italic", re: /(?<![\w_])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w_])/y },
  { kind: "sup", re: /\^([^\s^]{1,30})\^/y },
  { kind: "sub", re: /(?<!~)~([^\s~]{1,30})~(?!~)/y }
];

const TRIGGERS = new Set(["\\", "`", "$", "[", "h", "*", "_", "~", "^"]);

export function parseInline(text, style = {}) {
  const source = String(text ?? "");
  const runs = [];
  let buffer = "";
  const push = (value, extra = {}) => {
    if (!value) return;
    runs.push({ text: value, ...style, ...extra });
  };
  const flush = () => {
    push(buffer);
    buffer = "";
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (!TRIGGERS.has(char)) {
      buffer += char;
      index += 1;
      continue;
    }
    // "h" only matters at the start of a bare URL.
    if (char === "h" && (!source.startsWith("http", index) || /\w/.test(source[index - 1] || ""))) {
      buffer += char;
      index += 1;
      continue;
    }
    let matched = false;
    for (const pattern of PATTERNS) {
      pattern.re.lastIndex = index;
      const match = pattern.re.exec(source);
      if (!match) continue;
      matched = true;
      flush();
      const inner = match[1];
      switch (pattern.kind) {
        case "escape": buffer += inner; break;
        case "code": push(inner, { code: true }); break;
        case "math": push(inner.replace(/\\\$/g, "$").trim(), { math: true }); break;
        case "display": push(inner.trim(), { math: true, display: true }); break;
        case "link": runs.push(...parseInline(inner, { ...style, href: match[2] })); break;
        case "url": push(inner, { href: inner }); break;
        case "bold": runs.push(...parseInline(inner, { ...style, bold: true })); break;
        case "italic": runs.push(...parseInline(inner, { ...style, italic: true })); break;
        case "strike": runs.push(...parseInline(inner, { ...style, strike: true })); break;
        case "sup": push(inner, { sup: true }); break;
        case "sub": push(inner, { sub: true }); break;
        default: break;
      }
      index = match.index + match[0].length;
      break;
    }
    if (!matched) {
      buffer += char;
      index += 1;
    }
  }
  flush();
  // Merge neighbours with identical formatting.
  const merged = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    const same = prev && !prev.math && !run.math && !prev.code && !run.code
      && ["bold", "italic", "strike", "sup", "sub", "href"].every((key) => (prev[key] || false) === (run[key] || false));
    if (same) prev.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

// Splits a multi-line markdown text (callout bodies, problem prompts) into paragraphs and lists.
export function textBlocks(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of lines) {
    const trimmed = raw.trim();
    const item = trimmed.match(/^([-*•]|\d+[.)])\s+(\[( |x|X)\]\s+)?(.*)$/);
    const display = trimmed.match(/^\$\$(.+)\$\$$/) || trimmed.match(/^\\\[(.+)\\\]$/);
    if (!trimmed) {
      flushParagraph();
      flushList();
    } else if (display) {
      flushParagraph();
      flushList();
      blocks.push({ type: "equation", latex: display[1].trim() });
    } else if (item) {
      flushParagraph();
      const style = item[2] ? "check" : /\d/.test(item[1]) ? "number" : "bullet";
      if (!list || list.style !== style) {
        flushList();
        list = { type: "list", style, items: [] };
      }
      list.items.push(item[2] ? { text: item[4], ...(item[3].toLowerCase() === "x" ? { checked: true } : {}) } : item[4]);
    } else if (list && /^\s{2,}/.test(raw)) {
      const last = list.items.length - 1;
      if (typeof list.items[last] === "string") list.items[last] += ` ${trimmed}`;
      else list.items[last].text += ` ${trimmed}`;
    } else {
      flushList();
      paragraph.push(trimmed);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

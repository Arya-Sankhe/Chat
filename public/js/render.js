export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* Fallback renderer (when CDN libs haven't loaded) */

function renderFallback(text) {
  const parts = String(text || "").split("```");
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return `<pre><code>${escapeHtml(part.trim())}</code></pre>`;
      return escapeHtml(part)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
    })
    .join("");
}

/* Math extraction (protect LaTeX from the markdown parser) */

function protectCodeSpans(text) {
  const slots = [];
  let id = 0;
  let s = String(text ?? "").replace(/```[\s\S]*?```/g, (raw) => {
    const token = `KLUICODEHOLD${id}END`;
    slots.push({ token, raw });
    id++;
    return token;
  });
  s = s.replace(/`[^`\n]+`/g, (raw) => {
    const token = `KLUICODEHOLD${id}END`;
    slots.push({ token, raw });
    id++;
    return token;
  });
  return { text: s, slots };
}

function restoreCodeSpans(text, slots) {
  let s = text;
  for (const { token, raw } of slots) s = s.replaceAll(token, raw);
  return s;
}

function isLikelySingleDollarMath(tex) {
  const t = String(tex ?? "").trim();
  if (!t || t.length > 240) return false;

  // A captured pipe means we swallowed a markdown table separator
  // (e.g. "$/M | Output $") — never math.
  if (t.includes("|")) return false;

  // Unambiguous LaTeX: backslash commands, sub/superscripts, braces, or
  // math unicode symbols. These are real math regardless of any digits,
  // so "$1386 \text{ N}$" and "$x_1 + y$" still render.
  if (/\\[a-zA-Z]+|[_^{}]|[∑∫√∞≈≠≤≥±×÷]/.test(t)) return true;

  // Function calls and parenthesized numeric values: f(1), g(x, y),
  // sin(x), (1.2), (0.8).
  if (/^[a-zA-Z]+(?:\([^)]*\))+$/.test(t)) return true;
  if (/^\([^)]+\)$/.test(t) && /[\d.]/.test(t)) return true;

  // Currency / numeric prose: any remaining span that contains a digit but
  // no strong math signal is treated as plain text. This is what keeps
  // prices like $0.140, $1,600, $5, and "$0.140 = **$0.084**" from being
  // hijacked into math and eating the surrounding bold/table markup.
  if (/\d/.test(t)) return false;

  // Digit-free spans: short variables (x, n, ab) and simple algebraic
  // expressions (a = b, x + y) with no currency risk.
  if (/^[a-zA-Z]{1,3}$/.test(t)) return true;
  if (/^[a-zA-Z](?:\s*[=<>+\-*/^]\s*[a-zA-Z]+)+$/.test(t)) return true;

  return false;
}

function extractMath(text) {
  const slots = [];
  let id = 0;

  function hold(latex, display) {
    const token = `KLUIMATHHOLD${id}END`;
    slots.push({ token, latex, display });
    id++;
    return token;
  }

  const code = protectCodeSpans(text);
  let s = code.text;

  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => hold(tex.trim(), true));
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex) => hold(tex.trim(), true));
  s = s.replace(/\\\((.*?)\\\)/g, (_, tex) => hold(tex.trim(), false));
  s = s.replace(/(^|[^\\\w$])\$(?!\$)([^\n$]+?)\$(?!\$)/g, (raw, before, tex) => {
    if (!isLikelySingleDollarMath(tex)) return raw;
    return `${before}${hold(tex.trim(), false)}`;
  });

  s = restoreCodeSpans(s, code.slots);

  return { text: s, slots };
}

function restoreMath(html, slots) {
  const k = globalThis.katex;
  for (const { token, latex, display } of slots) {
    let rendered;
    if (k) {
      try {
        rendered = k.renderToString(latex, { displayMode: display, throwOnError: false });
      } catch {
        rendered = `<code>${escapeHtml(latex)}</code>`;
      }
    } else {
      rendered = `<code>${escapeHtml(latex)}</code>`;
    }
    html = html.replaceAll(token, rendered);
  }
  return html;
}

/* Syntax highlighting for code blocks */

function normalizeCodeLanguage(value) {
  const lang = String(value || "").trim().toLowerCase();
  if (!lang || lang.length > 24) return "";
  if (!/^[a-z0-9_+#.-]+$/.test(lang)) return "";
  return lang;
}

const codeSourceStore = new Map();
let codeSourceCounter = 0;

export function getCodeSource(id) {
  return codeSourceStore.get(String(id || ""));
}

export function resetCodeSourceStore() {
  codeSourceStore.clear();
  codeSourceCounter = 0;
}

function highlightCodeBlocks(html) {
  const hljs = globalThis.hljs;

  return html.replace(
    /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
    (match, lang, code) => {
      const requestedLang = normalizeCodeLanguage(lang);
      const decoded = code
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
        .replaceAll("&#039;", "'");

      let highlighted = code;
      let detectedLang = requestedLang;
      if (hljs) {
        try {
          const result = requestedLang && hljs.getLanguage(requestedLang)
            ? hljs.highlight(decoded, { language: requestedLang })
            : hljs.highlightAuto(decoded);
          highlighted = result.value;
          if (!requestedLang && result.language) detectedLang = normalizeCodeLanguage(result.language);
        } catch { /* keep original */ }
      }

      const cls = detectedLang ? ` language-${escapeHtml(detectedLang)}` : "";
      const label = detectedLang ? escapeHtml(detectedLang) : "";
      const codeId = `c${++codeSourceCounter}`;
      codeSourceStore.set(codeId, decoded);
      return `<div class="code-block-wrap"><div class="code-block-header"><span class="code-block-lang">${label}</span><button class="code-copy-btn" type="button" data-code-id="${codeId}" aria-label="Copy code" title="Copy code"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg><span>Copy</span></button></div><pre><code class="hljs${cls}">${highlighted}</code></pre></div>`;
    }
  );
}

/* Sanitization */

function sanitizeUrl(url) {
  const s = String(url ?? "").trim();
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(s)) return s;
  return "";
}

function sanitizeRenderedHtml(html) {
  const purifier = globalThis.DOMPurify;
  if (purifier && typeof purifier.sanitize === "function") {
    return purifier.sanitize(html, {
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
      ADD_ATTR: ["target", "rel"]
    });
  }

  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, "");
}

function renderSafeHtmlToken(token) {
  const raw = typeof token === "string" ? token : token?.raw ?? token?.text ?? "";
  if (/^<br\s*\/?>$/i.test(String(raw).trim())) return "<br>";
  return escapeHtml(raw);
}

/* Rich text rendering (marked + KaTeX + hljs) */

let markedReady = false;

function ensureMarkedConfig() {
  if (markedReady) return;
  markedReady = true;
  const m = globalThis.marked;
  if (!m) return;
  try {
    const renderer = {
      html(token) {
        return renderSafeHtmlToken(token);
      },
      link(token) {
        if (typeof token === "string") return false;
        const href = sanitizeUrl(token?.href);
        const title = token?.title ? ` title="${escapeHtml(token.title)}"` : "";
        const text = token?.text ?? "";
        if (!href) return text;
        return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
    };
    m.use({ breaks: true, gfm: true, renderer });
  } catch {
    try { m.setOptions({ breaks: true, gfm: true }); } catch { /* ignore */ }
  }
}

function renderRichText(raw) {
  const text = String(raw ?? "");
  if (!text) return "";

  const m = globalThis.marked;
  if (!m || typeof m.parse !== "function") return renderFallback(text);

  ensureMarkedConfig();

  const { text: processed, slots } = extractMath(text);
  let html = m.parse(processed);
  html = restoreMath(html, slots);
  html = highlightCodeBlocks(html);
  html = sanitizeRenderedHtml(html);

  return html;
}

/* Image URL validation */

function safeImageUrl(url) {
  const value = String(url || "");
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) return url;
  if (value.startsWith("blob:")) return value;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

/* Public content renderer */

export function renderContent(content) {
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === "text") return renderRichText(part.text);
        if (part.type === "image_url") {
          const url = safeImageUrl(part.image_url?.url);
          return url ? `<img class="message-image" src="${escapeHtml(url)}" alt="User supplied image">` : "";
        }
        if (part.type === "file") {
          const file = part.file || {};
          const href = sanitizeUrl(file.url || "");
          const name = file.file_name || "Document";
          const label = `
            <span class="message-file-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>
            </span>
            <span class="message-file-text">
              <span class="message-file-name">${escapeHtml(name)}</span>
            </span>
          `;
          return href
            ? `<a class="message-file" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
            : `<div class="message-file">${label}</div>`;
        }
        return "";
      })
      .join("");
  }
  return renderRichText(content);
}

/**
 * UI label: drop everything before the first ":" and show the rest as-is (trimmed).
 * If there is no ":", return the full string.
 */
export function compactModelDisplayName(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";

  const colon = s.indexOf(":");
  if (colon === -1) return s;

  const rest = s.slice(colon + 1).trim();
  return rest || s;
}

/** Filenames under `/img/model-brands/` (spaces encoded in URLs). */
const MODEL_BRAND_LOGO_RULES = [
  [/deepseek/i, "deepseek logo.svg"],
  [/qwen|alibaba/i, "qwen logo.svg"],
  [/kimi|moonshot/i, "kimi logo.svg"],
  [/zhipu|z-ai|glm|thudm/i, "zai logo.svg"],
  [/minimax|abab/i, "minimax logo.svg"],
  [/xiaomi|mimo/i, "xiaomimimo logo.svg"]
];

/**
 * Public URL for a brand logo SVG, or "" when none matches.
 */
export function modelBrandLogoUrl(model) {
  const haystack = `${model?.id || ""} ${model?.rawName || ""} ${model?.name || ""}`;
  for (const [re, file] of MODEL_BRAND_LOGO_RULES) {
    if (re.test(haystack)) {
      return `/img/model-brands/${encodeURIComponent(file)}`;
    }
  }
  return "";
}

function isSelectorExcludedModel(model) {
  const t = `${model.id} ${model.rawName}`.toLowerCase();
  return t.includes("gemma");
}

function modelHaystack(model) {
  return `${model?.id || ""} ${model?.rawName || ""} ${model?.name || ""}`.trim().toLowerCase();
}

const DEFAULT_COMPARE_TARGETS = [
  (m) => /kimi|moonshot/.test(modelHaystack(m)) && /k2\.6|k2-6/.test(modelHaystack(m)),
  (m) => /deepseek/.test(modelHaystack(m)) && /v4[\s._-]*pro/.test(modelHaystack(m)),
  (m) => /glm|zhipu|z-ai|thudm/.test(modelHaystack(m)) && /5\.1|5-1/.test(modelHaystack(m)),
  (m) => /mimo|xiaomi/.test(modelHaystack(m)) && /v2[\s._-]*5[\s._-]*pro/.test(modelHaystack(m))
];

export function resolveDefaultCompareModels(models) {
  if (!Array.isArray(models) || !models.length) return [];

  const picked = [];
  for (const matches of DEFAULT_COMPARE_TARGETS) {
    const model = models.find((item) => matches(item) && !picked.includes(item.id));
    if (model) picked.push(model.id);
  }

  return picked.slice(0, 4);
}

export function normalizeModelList(payload) {
  const list = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(list)) return [];

  return list
    .filter((model) => model && typeof model.id === "string")
    .map((model) => {
      const id = model.id.trim();
      const rawName = typeof model.name === "string" && model.name.trim() ? model.name.trim() : id;

      return {
        ...model,
        id,
        rawName,
        name: compactModelDisplayName(rawName)
      };
    })
    .filter((model) => !isSelectorExcludedModel(model))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

function perMillionPrice(value) {
  if (value === undefined || value === null || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `$${(number * 1000000).toFixed(number * 1000000 < 1 ? 2 : 2)}/M`;
}

export function formatModelMeta(model) {
  const meta = [];
  if (model?.context_length) meta.push(`${Number(model.context_length).toLocaleString()} ctx`);
  if (model?.max_completion_tokens) meta.push(`${Number(model.max_completion_tokens).toLocaleString()} out`);
  if (model?.quantization) meta.push(model.quantization);
  if (model?.speed) meta.push(`~${model.speed} tok/s`);
  return meta;
}

const VISION_HINT = /\bvision\b|\bvisual\b|\bvlm\b|multimodal|omni|gpt-4o|gpt-4\.1|gpt-5|o3|o4|gemini|gemma-?3|claude-(3|4)|sonnet|opus|haiku|qwen[\w.-]*vl|qwen2-vl|qwen3-vl|llama-?4|llama-3\.2[\w.-]*vision|internvl|molmo|minicpm|llava|pixtral|kimi|moonshot|grok|x-ai|glm-4[\w.-]*v|\bgreg\b/i;

function inputModalityTokens(model) {
  if (!model || typeof model !== "object") return [];
  const sources = [
    model.input_modalities,
    model.modalities,
    model.architecture?.input_modalities,
    model.architecture?.modality,
    model.raw?.architecture?.input_modalities,
    model.raw?.architecture?.modality
  ];
  const tokens = [];
  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const item of source) tokens.push(String(item || ""));
    } else if (typeof source === "string") {
      tokens.push(source);
    }
  }
  return tokens.map((token) => token.toLowerCase());
}

export function modelSupportsVision(model) {
  if (inputModalityTokens(model).some((token) => /image|vision|visual|photo|picture/.test(token))) return true;
  const haystack = `${model?.id || ""} ${model?.rawName || ""} ${model?.name || ""}`.trim().toLowerCase();
  return VISION_HINT.test(haystack);
}

export function inferModelBadges(model) {
  const text = `${model?.id || ""} ${model?.name || ""}`.toLowerCase();
  const badges = [];

  if (modelSupportsVision(model) || text.includes("vision")) badges.push("vision");
  if (text.includes("thinking") || text.includes("reasoning") || text.includes("deepseek") || /\bgreg\b/.test(text)) {
    badges.push("reasoning");
  }
  if (text.includes("turbo")) badges.push("turbo");
  if (text.includes("free") || Number(model?.pricing?.prompt) === 0 || Number(model?.pricing?.completion) === 0) badges.push("free");

  return badges;
}

export function renderModelOption(model, isActive = false) {
  const label = escapeHtml(model.name || model.id);
  const logo = modelBrandLogoUrl(model);
  const logoHtml = logo
    ? `<img class="model-option-logo" src="${escapeHtml(logo)}" alt="" width="24" height="24" decoding="async">`
    : `<span class="model-option-logo-placeholder" aria-hidden="true"></span>`;
  return `
    <button class="model-option ${isActive ? "active" : ""}" type="button" data-model-id="${escapeHtml(model.id)}" role="option" aria-selected="${isActive ? "true" : "false"}">
      <span class="model-option-main">
        ${logoHtml}
        <span class="model-option-name">${label}</span>
      </span>
      <span class="model-option-check" aria-hidden="true">${isActive ? "✓" : ""}</span>
    </button>
  `;
}

export function renderModelDetails(model) {
  if (!model) return "<span>No model metadata loaded.</span>";

  const rows = [
    ["Name", model.name || model.id],
    ["Context", model.context_length],
    ["Max output", model.max_completion_tokens],
    ["Quantization", model.quantization],
    ["Speed", model.speed ? `${model.speed} tok/s` : ""],
    ["Input", perMillionPrice(model.pricing?.prompt)],
    ["Output", perMillionPrice(model.pricing?.completion)]
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  return rows
    .map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

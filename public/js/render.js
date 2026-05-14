export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ─── Fallback renderer (when CDN libs haven't loaded) ─── */

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

/* ─── Math extraction (protect LaTeX from the markdown parser) ─── */

function extractMath(text) {
  const slots = [];
  let id = 0;

  function hold(latex, display) {
    const token = `MATHHOLD${id}ENDMATH`;
    slots.push({ token, latex, display });
    id++;
    return token;
  }

  const codeHolds = [];
  let cid = 0;
  let s = text.replace(/```[\s\S]*?```/g, (m) => {
    const t = `CODEHOLD${cid}ENDCODE`;
    codeHolds.push({ t, m });
    cid++;
    return t;
  });
  s = s.replace(/`[^`\n]+`/g, (m) => {
    const t = `CODEHOLD${cid}ENDCODE`;
    codeHolds.push({ t, m });
    cid++;
    return t;
  });

  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => hold(tex.trim(), true));
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex) => hold(tex.trim(), true));
  s = s.replace(/(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g, (_, tex) => hold(tex.trim(), false));
  s = s.replace(/\\\((.*?)\\\)/g, (_, tex) => hold(tex.trim(), false));

  for (const { t, m } of codeHolds) s = s.replaceAll(t, m);

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

/* ─── Syntax highlighting for code blocks ─── */

function highlightCodeBlocks(html) {
  const hljs = globalThis.hljs;
  if (!hljs) return html;

  return html.replace(
    /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
    (match, lang, code) => {
      const decoded = code
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'");
      try {
        const result = lang && hljs.getLanguage(lang)
          ? hljs.highlight(decoded, { language: lang })
          : hljs.highlightAuto(decoded);
        const cls = lang ? ` language-${escapeHtml(lang)}` : "";
        return `<pre><code class="hljs${cls}">${result.value}</code></pre>`;
      } catch {
        return match;
      }
    }
  );
}

/* ─── Rich text rendering (marked + KaTeX + hljs) ─── */

let markedReady = false;

function ensureMarkedConfig() {
  if (markedReady) return;
  markedReady = true;
  const m = globalThis.marked;
  if (!m) return;
  try {
    m.use({ breaks: true, gfm: true });
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

  return html;
}

/* ─── Image URL validation ─── */

function safeImageUrl(url) {
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(String(url || ""))) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

/* ─── Public content renderer ─── */

export function renderContent(content) {
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === "text") return renderRichText(part.text);
        if (part.type === "image_url") {
          const url = safeImageUrl(part.image_url?.url);
          return url ? `<img class="message-image" src="${escapeHtml(url)}" alt="User supplied image">` : "";
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
  if (t.includes("gemma")) return true;
  if (t.includes("greg")) return true;
  return false;
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

export function inferModelBadges(model) {
  const text = `${model?.id || ""} ${model?.name || ""}`.toLowerCase();
  const badges = [];

  if (text.includes("vision")) badges.push("vision");
  if (text.includes("thinking") || text.includes("reasoning") || text.includes("deepseek")) badges.push("reasoning");
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

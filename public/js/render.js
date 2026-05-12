export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderCodeAwareText(text) {
  const parts = String(text || "").split("```");

  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        return `<pre><code>${escapeHtml(part.trim())}</code></pre>`;
      }

      return escapeHtml(part)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
    })
    .join("");
}

function safeImageUrl(url) {
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(String(url || ""))) {
    return url;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

export function renderContent(content) {
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === "text") return renderCodeAwareText(part.text);
        if (part.type === "image_url") {
          const url = safeImageUrl(part.image_url?.url);
          return url ? `<img class="message-image" src="${escapeHtml(url)}" alt="User supplied image">` : "";
        }
        return "";
      })
      .join("");
  }

  return renderCodeAwareText(content);
}

export function normalizeModelList(payload) {
  const list = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(list)) return [];

  return list
    .filter((model) => model && typeof model.id === "string")
    .map((model) => ({
      ...model,
      id: model.id.trim(),
      name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : model.id.trim()
    }))
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
  const meta = formatModelMeta(model);
  const badges = inferModelBadges(model);
  const input = perMillionPrice(model?.pricing?.prompt);
  const output = perMillionPrice(model?.pricing?.completion);

  return `
    <button class="model-option ${isActive ? "active" : ""}" type="button" data-model-id="${escapeHtml(model.id)}">
      <span class="model-option-main">
        <strong>${escapeHtml(model.name || model.id)}</strong>
        <small>${escapeHtml(model.id)}</small>
      </span>
      ${badges.length ? `<span class="model-badges">${badges.map((badge) => `<em>${escapeHtml(badge)}</em>`).join("")}</span>` : ""}
      ${meta.length ? `<span class="model-option-meta">${meta.map(escapeHtml).join(" · ")}</span>` : ""}
      ${input || output ? `<span class="model-option-price">${input ? `In ${escapeHtml(input)}` : ""}${input && output ? " · " : ""}${output ? `Out ${escapeHtml(output)}` : ""}</span>` : ""}
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

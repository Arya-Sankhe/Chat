function clean(value) {
  return String(value || "").trim();
}

export function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text")
    .map((part) => part.text || "")
    .join("\n\n");
}

export function createIntentMentionsPriorContent(text) {
  const value = String(text || "");
  return /\b(above|previous|earlier|last|same|that|this|provided)\b/i.test(value)
    || /\b(the|this|that)\s+(concise\s+)?summary\b/i.test(value);
}

export function createIntentLooksLikeOnlyInstructions(text) {
  const cleanText = clean(text);
  if (!cleanText) return true;
  const words = cleanText.split(/\s+/).filter(Boolean).length;
  return words <= 80
    && /\b(create|make|generate|draft|write|build|put|turn|convert)\b/i.test(cleanText)
    && /\b(pdf|docx|word|document|file|summary|pptx|powerpoint|slides?|deck|presentation)\b/i.test(cleanText);
}

export function assistantTextLooksLikeArtifactHandoff(text) {
  const value = clean(text);
  if (!value) return false;
  const words = value.split(/\s+/).filter(Boolean).length;
  return words <= 140
    && /\b(download|created|generated|attached|document|pdf|docx|xlsx|pptx|slides?|deck|presentation)\b/i.test(value)
    && /(\]\(|\/api\/attachments\/|download\s+)/i.test(value);
}

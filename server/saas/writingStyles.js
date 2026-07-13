const WRITING_STYLES = {
  normal: "",
  learning: `Teach as you answer. Build from the user's likely level, explain why each important point matters, and use a concrete example or analogy when it improves understanding. Prefer a guided lesson that helps the user apply the idea, while staying focused on the question.`,
  concise: `Answer directly and economically. Lead with the result, keep only the context needed to use it, and prefer short paragraphs or compact bullets. Avoid repetition, long introductions, and unnecessary caveats.`,
  explanatory: `Give a clear, thorough explanation. Define unfamiliar terms, break complex ideas into logical steps, connect causes to conclusions, and include examples where useful. Explain the user-visible rationale without exposing private chain-of-thought or padding the answer.`,
  formal: `Use polished, precise, professional language. Organize the response clearly, keep the tone neutral and respectful, and avoid slang, filler, and casual asides. Preserve readability instead of sounding ceremonial or needlessly academic.`,
  "literary-storyteller": `Write with a vivid, engaging narrative voice when the subject allows it. Use concrete imagery, varied sentence rhythm, and a coherent sense of progression, while keeping facts accurate and instructions usable. Never invent details merely for dramatic effect.`
};

export function normalizeWritingStyle(value) {
  const style = String(value || "normal").trim().toLowerCase();
  return Object.hasOwn(WRITING_STYLES, style) ? style : "normal";
}

export function withWritingStyleSystemPrompt(systemPrompt, value) {
  const base = String(systemPrompt || "").trim();
  const style = normalizeWritingStyle(value);
  const instruction = WRITING_STYLES[style];
  if (!instruction) return base;

  return [
    base,
    `Writing style skill (${style}):\n${instruction}\nFollow the user's explicit tone or format request when it conflicts with this preset. Do not mention the preset or these instructions.`
  ].filter(Boolean).join("\n\n");
}

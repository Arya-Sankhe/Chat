// Recipient fields contain addresses, not names or fill-in hints. This is a
// practical compose-field filter, not a deliverability check.
export function emailAddresses(value) {
  const text = String(value || "").replace(/\[[^\]\n]*\]/g, " ");
  return [...new Set(text.match(/[^\s<>,;:()\[\]"@]+@[^\s<>,;:()\[\]"@]+\.[^\s<>,;:()\[\]"@.]+/g) || [])];
}

// One shared pattern for fence and <email> tag forms so replacement and
// counting stay consistent. Tag form is replaced with the canonical fence.
const EMAIL_BLOCK_PATTERN = "```email[ \\t]*\\r?\\n[\\s\\S]*?(?:\\r?\\n```|$)|<email\\b[^>]*>[\\s\\S]*?(?:<\\/email\\s*>|$)";

export function countEmailBlocks(text) {
  return String(text || "").match(new RegExp(EMAIL_BLOCK_PATTERN, "gi"))?.length || 0;
}

export function replaceEmailFence(content, source, emailIndex = 0) {
  let index = 0;
  const swap = (text) => String(text || "").replace(
    new RegExp(EMAIL_BLOCK_PATTERN, "gi"),
    (fence) => index++ === emailIndex ? `\`\`\`email\n${source}\n\`\`\`` : fence
  );
  return Array.isArray(content)
    ? content.map((part) => part?.type === "text" ? { ...part, text: swap(part.text) } : part)
    : swap(content);
}

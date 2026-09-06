// Recipient fields contain addresses, not names or fill-in hints. This is a
// practical compose-field filter, not a deliverability check.
export function emailAddresses(value) {
  const text = String(value || "").replace(/\[[^\]\n]*\]/g, " ");
  return [...new Set(text.match(/[^\s<>,;:()\[\]"@]+@[^\s<>,;:()\[\]"@]+\.[^\s<>,;:()\[\]"@.]+/g) || [])];
}

export function replaceEmailFence(content, source, emailIndex = 0) {
  let index = 0;
  const swap = (text) => String(text || "").replace(
    /```email[ \t]*\r?\n[\s\S]*?(?:\r?\n```|$)/gi,
    (fence) => index++ === emailIndex ? `\`\`\`email\n${source}\n\`\`\`` : fence
  );
  return Array.isArray(content)
    ? content.map((part) => part?.type === "text" ? { ...part, text: swap(part.text) } : part)
    : swap(content);
}

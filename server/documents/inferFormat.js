function clean(value) {
  return String(value || "").trim();
}

export function inferCreateFormat(format, ...hints) {
  const normalized = clean(format).toLowerCase();
  const text = hints.map((hint) => String(hint || "")).join(" ").toLowerCase();
  const asksWord = /\b(word\s+(doc|document|file)|docx\s+(file|document)|as\s+a\s+docx|\.docx\b)/.test(text);
  const asksPdf = /\b(pdf\s+(file|document)|as\s+a\s+pdf|create\s+a\s+pdf|make\s+a\s+pdf|generate\s+a\s+pdf|\.pdf\b)/.test(text);
  const asksSheet = /\b(xlsx\s+(file|document)|excel\s+(file|sheet|workbook)|spreadsheet|workbook|\.xlsx\b)/.test(text);
  const asksSlides = /\b(pptx\s+(file|deck|presentation)|powerpoint|slides?|deck|presentation|\.pptx\b)/.test(text);
  if (asksWord) return "docx";
  if (asksSheet) return "xlsx";
  if (asksSlides) return "pptx";
  if (asksPdf) return "pdf";
  return normalized;
}

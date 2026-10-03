// The text the document viewer sends for a selection (and the context around it): whitespace,
// including the line breaks a PDF text layer may or may not report, collapsed to single spaces.
// The server matches this exact form (server/documents/fileEditor.js resolveSelection).
export function selectionPlainText(value) {
  return String(value || "").replace(/\s+/g, " ");
}

// A range's text with a space wherever the text layer breaks a line. PDF.js ends each line with a
// <br>, which Range.toString() skips, so "1. Call Alice." and "2. Email Bob." would run together.
export function rangePlainText(range) {
  const fragment = range.cloneContents();
  fragment.querySelectorAll?.("br").forEach((br) => br.replaceWith(" "));
  return selectionPlainText(fragment.textContent);
}

// The text the document viewer sends for a selection (and the context around it): whitespace,
// including the line breaks a PDF text layer may or may not report, collapsed to single spaces.
// The server matches this exact form (server/documents/fileEditor.js resolveSelection).
export function selectionPlainText(value) {
  return String(value || "").replace(/\s+/g, " ");
}

function clean(value) {
  return String(value || "").trim();
}

const FORMATS = new Set(["md", "docx", "xlsx", "pptx", "pdf"]);

// Formats the user's own message names. "Slides", "deck" and "presentation" are often the subject
// ("a PDF of the slides"), so they only count when no other format is named.
function namedFormats(text) {
  const named = new Set();
  if (/\bpdf\b/.test(text)) named.add("pdf");
  if (/\b(docx|word\s+(doc|document|file|version)|ms\s+word|microsoft\s+word)\b/.test(text)) named.add("docx");
  if (/\b(xlsx|excel|spreadsheet|workbook)\b/.test(text)) named.add("xlsx");
  if (/\b(markdown|\.md)\b/.test(text)) named.add("md");
  if (/\b(pptx|powerpoint)\b/.test(text) || (!named.size && /\b(slides?|deck|presentation)\b/.test(text))) named.add("pptx");
  return named;
}

const FORMAT_WORD = String.raw`(?:pdfs?|docx|word\s+(?:docs?|documents?|files?)|xlsx|excel(?:\s+(?:files?|sheets?|workbooks?))?|spreadsheets?|workbooks?|pptx|powerpoints?|slides?|decks?|presentations?)`;
const SOURCE_ADJ = String.raw`(?:attached|uploaded|above|original|existing|source|shared|same|previous)`;
const SOURCE_REFERENCE = new RegExp([
  // "the attached PDF", "this word file", "my spreadsheet"
  String.raw`\b(?:(?:the|this|that|these|those|my|your|our)\s+)?${SOURCE_ADJ}\s+${FORMAT_WORD}`,
  String.raw`\b(?:this|that|these|those|my|your|our)\s+${FORMAT_WORD}`,
  // "from the PDF", "of my deck", "based on the spreadsheet"
  String.raw`\b(?:from|of|in|on|about|using|based\s+on|summari[sz]ing|summari[sz]e|read)\s+(?:the|this|that|these|those|my|your|our)\s+(?:${SOURCE_ADJ}\s+)?${FORMAT_WORD}`,
  // "from a PDF", "from spreadsheet data", "summarizing a PDF" ("in a PDF" / "as a PDF" stay: those name the output)
  String.raw`\b(?:from|out\s+of|about|using|based\s+on|summari[sz]ing|summari[sz]e|read(?:ing)?|analy[sz]ing|analy[sz]e)\s+(?:(?:a|an|some|any)\s+)?(?:${SOURCE_ADJ}\s+)?${FORMAT_WORD}`,
  // "turn a PDF into slides", "convert the spreadsheet to a report": the thing being turned is the source
  String.raw`\b(?:turn|convert|transform)\s+(?:(?:a|an|the|this|that|my|your|our)\s+)?(?:${SOURCE_ADJ}\s+)?${FORMAT_WORD}(?=\s+(?:in)?to\b)`
].join("|"), "g");

// The user's message with mentions of source files taken out ("slides summarizing the attached PDF"
// asks for slides, not a PDF).
function withoutSourceReferences(text) {
  return text.replace(SOURCE_REFERENCE, " ");
}

// Explicit file types in the model's own title and instructions ("Create a Word document …").
// PDF and the slide words are left out: they usually name the source ("… of the PDF", "the deck above").
function explicitFileTypes(text) {
  const named = new Set();
  if (/\b(docx|word\s+(doc|document|file|version))\b/.test(text)) named.add("docx");
  if (/\b(pptx|powerpoint)\b/.test(text)) named.add("pptx");
  if (/\b(xlsx|excel\s+(file|sheet|workbook)|spreadsheet|workbook)\b/.test(text)) named.add("xlsx");
  return named;
}

// The format to create. The user's own words decide first; then an explicit file type in the
// model's title or instructions (it sometimes passes the wrong format); then the format it passed;
// only when that is missing is it guessed from the slide words too.
export function inferCreateFormat(format, { userRequest = "", hints = [] } = {}) {
  const normalized = clean(format).toLowerCase();
  const named = namedFormats(withoutSourceReferences(clean(userRequest).toLowerCase()));
  if (named.size === 1) return [...named][0];
  if (named.size > 1) return named.has(normalized) ? normalized : [...named][0];
  const hintText = withoutSourceReferences(hints.map((hint) => String(hint || "")).join(" ").toLowerCase());
  const explicit = explicitFileTypes(hintText);
  if (explicit.size === 1) return [...explicit][0];
  if (FORMATS.has(normalized)) return normalized;
  const guessed = namedFormats(hintText);
  return guessed.size ? [...guessed][0] : normalized;
}

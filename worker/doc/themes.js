// Document styles. A style is a complete design system for a page: type, colour, spacing and how
// each block (headings, tables, callouts, charts) is drawn. The PDF renders with the bundled
// open fonts (worker/fonts/doc); the DOCX uses the closest font every copy of Word ships with,
// so a downloaded file opens with the intended look.
//
// Tokens
//   colors     ink (titles, headings), text, muted, faint, rule, accent, accent2, surface (callout
//              and card fill), surfaceStrong, tableHead / tableHeadText, stripe, positive, negative,
//              warn, palette (chart series)
//   fonts      pdf / docx faces for heading, body, label (small caps, kickers, table heads), mono
//   type       base size (pt), line height, title / h1 / h2 / h3 sizes, heading weight and case
//   layout     page size, margins (mm), title block ("left" | "center" | "cv" | "mla" | "apa"),
//              heading rule, table style, callout style, numbering of headings and equations

const SERIF_DOCX = "Cambria";

export const STYLES = {
  // Clean modern report: the safe default for reports, proposals, plans and handouts.
  report: {
    name: "report",
    label: "Report",
    use: "reports, proposals, plans, project write-ups, handouts; the safe default",
    colors: {
      ink: "0F172A", text: "1E293B", muted: "64748B", faint: "94A3B8", rule: "E2E8F0",
      accent: "1D4ED8", accent2: "0F766E", surface: "F1F5F9", surfaceStrong: "E2E8F0",
      tableHead: "1E293B", tableHeadText: "FFFFFF", stripe: "F8FAFC",
      positive: "15803D", negative: "B91C1C", warn: "B45309",
      palette: ["1D4ED8", "0F766E", "F59E0B", "64748B", "7C3AED", "DC2626"]
    },
    fonts: {
      pdf: { heading: "Inter", body: "Inter", label: "Inter", mono: "JetBrains Mono" },
      docx: { heading: "Calibri", body: "Calibri", label: "Calibri", mono: "Consolas" }
    },
    type: { base: 10, line: 1.5, title: 24, subtitle: 12, h1: 15, h2: 12, h3: 10.5, headingWeight: 700, headingCase: "none", tracking: 0 },
    layout: { page: "A4", margins: [20, 19, 20, 19], titleBlock: "left", titleRule: true, headingRule: "none", tableStyle: "dark", calloutStyle: "bar", numberHeadings: false, footer: "title-page" }
  },

  // Analyst briefing: numbered section heads over a rule with a right-hand tag, light tables, KPI cards.
  briefing: {
    name: "briefing",
    label: "Briefing",
    use: "case studies, market and business analysis, policy briefs, executive summaries, history of an industry",
    colors: {
      ink: "0B1220", text: "1F2937", muted: "5B6472", faint: "9AA3AF", rule: "D9DEE5",
      accent: "0B5FA5", accent2: "B42318", surface: "F4F6F9", surfaceStrong: "E6EAF0",
      tableHead: "EEF1F5", tableHeadText: "0B1220", stripe: "F9FAFB",
      positive: "157F3D", negative: "B42318", warn: "C2610C",
      palette: ["0B5FA5", "B42318", "D97706", "475569", "0E7490", "7C3AED"]
    },
    fonts: {
      pdf: { heading: "Inter", body: "Inter", label: "Inter", mono: "JetBrains Mono" },
      docx: { heading: "Arial", body: "Arial", label: "Arial", mono: "Consolas" }
    },
    type: { base: 9.5, line: 1.55, title: 26, subtitle: 11.5, h1: 14, h2: 11, h3: 10, headingWeight: 700, headingCase: "none", tracking: 0 },
    layout: { page: "A4", margins: [18, 18, 20, 18], titleBlock: "left", titleRule: true, headingRule: "below", tableStyle: "light", calloutStyle: "bar", numberHeadings: true, footer: "title-section-page" }
  },

  // Academic paper: serif text, centred title block, booktabs tables, restrained colour.
  academic: {
    name: "academic",
    label: "Academic",
    use: "research papers, literature reviews, term papers, theses chapters, academic reports",
    colors: {
      ink: "111827", text: "1F2328", muted: "5F6670", faint: "9AA0A6", rule: "C9CDD2",
      accent: "1F3A5F", accent2: "7A2E2E", surface: "F4F5F7", surfaceStrong: "E5E7EB",
      tableHead: "FFFFFF", tableHeadText: "111827", stripe: "FFFFFF",
      positive: "2F6B3B", negative: "8B2C2C", warn: "8A5A12",
      palette: ["1F3A5F", "7A2E2E", "5F7A99", "B08D57", "4B5563", "2F6B3B"]
    },
    fonts: {
      pdf: { heading: "Source Serif 4", body: "Source Serif 4", label: "Source Serif 4", mono: "JetBrains Mono" },
      docx: { heading: SERIF_DOCX, body: SERIF_DOCX, label: SERIF_DOCX, mono: "Consolas" }
    },
    type: { base: 10.5, line: 1.5, title: 21, subtitle: 12, h1: 13.5, h2: 11.5, h3: 10.5, headingWeight: 700, headingCase: "none", tracking: 0 },
    layout: { page: "A4", margins: [24, 24, 24, 24], titleBlock: "center", titleRule: false, headingRule: "none", tableStyle: "rules", calloutStyle: "box", numberHeadings: false, footer: "page-center" }
  },

  // Lab / scientific report: serif headings, sans data, metadata grid, numbered equations.
  lab: {
    name: "lab",
    label: "Lab report",
    use: "lab reports, experiments, scientific and engineering write-ups with data, equations and uncertainty",
    colors: {
      ink: "0D1B2A", text: "1B2631", muted: "5A6B7B", faint: "93A1AE", rule: "D5DDE5",
      accent: "0E5A8A", accent2: "1F7A5C", surface: "F2F6F9", surfaceStrong: "E1EAF1",
      tableHead: "E8EFF5", tableHeadText: "0D1B2A", stripe: "F7FAFC",
      positive: "1F7A5C", negative: "A3312C", warn: "A86412",
      palette: ["0E5A8A", "D9822B", "1F7A5C", "6B7C8F", "A3312C", "6D4C9F"]
    },
    fonts: {
      pdf: { heading: "Source Serif 4", body: "Source Serif 4", label: "IBM Plex Sans", mono: "JetBrains Mono" },
      docx: { heading: SERIF_DOCX, body: SERIF_DOCX, label: "Calibri", mono: "Consolas" }
    },
    type: { base: 10, line: 1.5, title: 19, subtitle: 11.5, h1: 12.5, h2: 11, h3: 10, headingWeight: 700, headingCase: "none", tracking: 0 },
    layout: { page: "A4", margins: [20, 20, 20, 20], titleBlock: "left", titleRule: true, headingRule: "below", tableStyle: "light", calloutStyle: "box", numberHeadings: true, numberEquations: true, footer: "title-page" }
  },

  // Problem sets and worked solutions: problem headers, labelled steps, boxed answers, math.
  homework: {
    name: "homework",
    label: "Problem set",
    use: "homework, problem sets, worked solutions, exam prep with math, physics or chemistry",
    colors: {
      ink: "111827", text: "1F2937", muted: "6B7280", faint: "9CA3AF", rule: "E5E7EB",
      accent: "2B50AA", accent2: "157F55", surface: "F3F6FC", surfaceStrong: "E3EAF7",
      tableHead: "1F2A44", tableHeadText: "FFFFFF", stripe: "F8FAFC",
      positive: "157F55", negative: "B42318", warn: "B45309",
      palette: ["2B50AA", "157F55", "D97706", "6B7280", "9333EA", "DC2626"]
    },
    fonts: {
      pdf: { heading: "Inter", body: "Source Serif 4", label: "Inter", mono: "JetBrains Mono" },
      docx: { heading: "Calibri", body: SERIF_DOCX, label: "Calibri", mono: "Consolas" }
    },
    type: { base: 10.5, line: 1.5, title: 20, subtitle: 11.5, h1: 13, h2: 11, h3: 10.5, headingWeight: 700, headingCase: "none", tracking: 0 },
    layout: { page: "A4", margins: [20, 20, 20, 20], titleBlock: "left", titleRule: true, headingRule: "none", tableStyle: "light", calloutStyle: "bar", numberHeadings: false, footer: "title-page" }
  },

  // MLA essay: Times, 12 pt, double spaced, 1 inch margins, surname and page number top right.
  mla: {
    name: "mla",
    label: "MLA essay",
    use: "essays and papers in MLA format (English, literature, humanities); plain, double spaced",
    colors: {
      ink: "000000", text: "000000", muted: "000000", faint: "555555", rule: "000000",
      accent: "000000", accent2: "000000", surface: "FFFFFF", surfaceStrong: "FFFFFF",
      tableHead: "FFFFFF", tableHeadText: "000000", stripe: "FFFFFF",
      positive: "000000", negative: "000000", warn: "000000",
      palette: ["333333", "777777", "AAAAAA", "555555", "999999", "222222"]
    },
    fonts: {
      pdf: { heading: "Liberation Serif", body: "Liberation Serif", label: "Liberation Serif", mono: "Liberation Mono" },
      docx: { heading: "Times New Roman", body: "Times New Roman", label: "Times New Roman", mono: "Courier New" }
    },
    type: { base: 12, line: 2, title: 12, subtitle: 12, h1: 12, h2: 12, h3: 12, headingWeight: 700, headingCase: "none", tracking: 0, indent: true, paragraphGap: 0 },
    layout: { page: "Letter", margins: [25.4, 25.4, 25.4, 25.4], titleBlock: "mla", titleRule: false, headingRule: "none", tableStyle: "rules", calloutStyle: "plain", numberHeadings: false, footer: "none", header: "surname-page", plain: true }
  },

  // APA 7 student paper: title page, page numbers top right, centred bold level-1 headings.
  apa: {
    name: "apa",
    label: "APA paper",
    use: "papers in APA 7 format (psychology, education, social sciences, nursing); title page, double spaced",
    colors: {
      ink: "000000", text: "000000", muted: "000000", faint: "555555", rule: "000000",
      accent: "000000", accent2: "000000", surface: "FFFFFF", surfaceStrong: "FFFFFF",
      tableHead: "FFFFFF", tableHeadText: "000000", stripe: "FFFFFF",
      positive: "000000", negative: "000000", warn: "000000",
      palette: ["333333", "777777", "AAAAAA", "555555", "999999", "222222"]
    },
    fonts: {
      pdf: { heading: "Liberation Serif", body: "Liberation Serif", label: "Liberation Serif", mono: "Liberation Mono" },
      docx: { heading: "Times New Roman", body: "Times New Roman", label: "Times New Roman", mono: "Courier New" }
    },
    type: { base: 12, line: 2, title: 12, subtitle: 12, h1: 12, h2: 12, h3: 12, headingWeight: 700, headingCase: "none", tracking: 0, indent: true, paragraphGap: 0 },
    layout: { page: "Letter", margins: [25.4, 25.4, 25.4, 25.4], titleBlock: "apa", titleRule: false, headingRule: "none", tableStyle: "rules", calloutStyle: "plain", numberHeadings: false, footer: "none", header: "page-right", plain: true }
  },

  // Field guide / how-to / recipes: warm serif headings, step cards, checklists, tips.
  guide: {
    name: "guide",
    label: "Guide",
    use: "how-to guides, manuals, recipes and cookbooks, travel and hobby guides, checklists, onboarding",
    colors: {
      ink: "1F2A1F", text: "2B2B28", muted: "6B6A63", faint: "A3A199", rule: "E3DED3",
      accent: "2F6B3F", accent2: "B5562B", surface: "F6F3EC", surfaceStrong: "ECE6D9",
      tableHead: "2F4A36", tableHeadText: "FFFFFF", stripe: "FAF8F3",
      positive: "2F6B3F", negative: "A33A2A", warn: "B5562B",
      palette: ["2F6B3F", "B5562B", "C9A227", "6B7F8E", "8A5A44", "4E6E58"]
    },
    fonts: {
      pdf: { heading: "Lora", body: "Inter", label: "Inter", mono: "JetBrains Mono" },
      docx: { heading: "Georgia", body: "Calibri", label: "Calibri", mono: "Consolas" }
    },
    type: { base: 10, line: 1.55, title: 26, subtitle: 12, h1: 16, h2: 12.5, h3: 10.5, headingWeight: 700, headingCase: "none", tracking: 0 },
    layout: { page: "A4", margins: [19, 19, 20, 19], titleBlock: "left", titleRule: true, headingRule: "none", tableStyle: "dark", calloutStyle: "bar", numberHeadings: false, footer: "title-page" }
  },

  // Study notes and revision sheets: compact, friendly, definition and key-idea boxes.
  notes: {
    name: "notes",
    label: "Study notes",
    use: "study notes, revision sheets, cheat sheets, lecture summaries, explainers for students",
    colors: {
      ink: "1E1B4B", text: "27272A", muted: "6B6B76", faint: "A1A1AA", rule: "E4E4E7",
      accent: "5B3FD1", accent2: "0E7C86", surface: "F5F3FF", surfaceStrong: "EDE9FE",
      tableHead: "EDE9FE", tableHeadText: "1E1B4B", stripe: "FAFAFB",
      positive: "15803D", negative: "BE123C", warn: "B45309",
      palette: ["5B3FD1", "0E7C86", "E08E0B", "71717A", "DB2777", "2563EB"]
    },
    fonts: {
      pdf: { heading: "Inter", body: "Inter", label: "Inter", mono: "JetBrains Mono" },
      docx: { heading: "Calibri", body: "Calibri", label: "Calibri", mono: "Consolas" }
    },
    type: { base: 9.75, line: 1.5, title: 22, subtitle: 11.5, h1: 14, h2: 11.5, h3: 10, headingWeight: 700, headingCase: "none", tracking: 0 },
    layout: { page: "A4", margins: [17, 17, 18, 17], titleBlock: "left", titleRule: true, headingRule: "none", tableStyle: "light", calloutStyle: "bar", numberHeadings: false, footer: "title-page" }
  },

  // Business letter / cover letter: letterhead with name and contact line, generous margins.
  letter: {
    name: "letter",
    label: "Letter",
    use: "cover letters, formal and business letters, statements of purpose, recommendation letters, memos",
    colors: {
      ink: "111827", text: "1F2937", muted: "4B5563", faint: "9CA3AF", rule: "D1D5DB",
      accent: "1F3A5F", accent2: "1F3A5F", surface: "F3F4F6", surfaceStrong: "E5E7EB",
      tableHead: "F3F4F6", tableHeadText: "111827", stripe: "FFFFFF",
      positive: "15803D", negative: "B91C1C", warn: "B45309",
      palette: ["1F3A5F", "6B7280", "9CA3AF", "374151", "4B5563", "111827"]
    },
    fonts: {
      pdf: { heading: "Source Serif 4", body: "Source Serif 4", label: "Inter", mono: "JetBrains Mono" },
      docx: { heading: SERIF_DOCX, body: SERIF_DOCX, label: "Calibri", mono: "Consolas" }
    },
    type: { base: 11, line: 1.45, title: 20, subtitle: 10, h1: 12, h2: 11, h3: 11, headingWeight: 700, headingCase: "none", tracking: 0 },
    layout: { page: "Letter", margins: [24, 25, 22, 25], titleBlock: "letterhead", titleRule: true, headingRule: "none", tableStyle: "light", calloutStyle: "box", numberHeadings: false, footer: "none" }
  },

  // CV / resume, classic: the format recruiters and ATS parsers read best. One column, serif,
  // centred name, small-caps section rules, dates right-aligned on the entry line.
  cv: {
    name: "cv",
    label: "CV · Classic (ATS)",
    use: "resumes and CVs (students, graduates, professionals); ATS-safe single column, classic serif",
    colors: {
      ink: "000000", text: "111111", muted: "444444", faint: "777777", rule: "222222",
      accent: "000000", accent2: "000000", surface: "FFFFFF", surfaceStrong: "FFFFFF",
      tableHead: "FFFFFF", tableHeadText: "000000", stripe: "FFFFFF",
      positive: "000000", negative: "000000", warn: "000000",
      palette: ["333333", "777777", "AAAAAA", "555555", "999999", "222222"]
    },
    fonts: {
      pdf: { heading: "EB Garamond", body: "EB Garamond", label: "EB Garamond", mono: "JetBrains Mono" },
      docx: { heading: "Garamond", body: "Garamond", label: "Garamond", mono: "Consolas" }
    },
    type: { base: 11, line: 1.22, title: 22, subtitle: 10.5, h1: 11.5, h2: 11, h3: 11, headingWeight: 700, headingCase: "smallcaps", tracking: 0.04 },
    layout: { page: "Letter", margins: [14, 16, 14, 16], titleBlock: "cv", titleRule: false, headingRule: "below", tableStyle: "rules", calloutStyle: "plain", numberHeadings: false, footer: "none", plain: true, cv: true }
  },

  // CV / resume, modern: sans, the name in the accent colour, compact. Still one column, real
  // text, no tables or icons, so it parses as cleanly as the classic one.
  cv_modern: {
    name: "cv_modern",
    label: "CV · Modern (ATS)",
    use: "resumes for tech, business, design-adjacent roles; ATS-safe single column, modern sans",
    colors: {
      ink: "0F172A", text: "1E293B", muted: "475569", faint: "94A3B8", rule: "CBD5E1",
      accent: "1E40AF", accent2: "1E40AF", surface: "FFFFFF", surfaceStrong: "FFFFFF",
      tableHead: "FFFFFF", tableHeadText: "0F172A", stripe: "FFFFFF",
      positive: "15803D", negative: "B91C1C", warn: "B45309",
      palette: ["1E40AF", "64748B", "94A3B8", "334155", "475569", "0F172A"]
    },
    fonts: {
      pdf: { heading: "Inter", body: "Inter", label: "Inter", mono: "JetBrains Mono" },
      docx: { heading: "Calibri", body: "Calibri", label: "Calibri", mono: "Consolas" }
    },
    type: { base: 9.75, line: 1.32, title: 22, subtitle: 9.75, h1: 10.5, h2: 10, h3: 9.75, headingWeight: 700, headingCase: "upper", tracking: 0.08 },
    layout: { page: "Letter", margins: [13, 15, 13, 15], titleBlock: "cv", titleRule: false, headingRule: "below", tableStyle: "rules", calloutStyle: "plain", numberHeadings: false, footer: "none", plain: true, cv: true, cvAlign: "left" }
  }
};

export const STYLE_NAMES = Object.keys(STYLES);

export const STYLE_ALIASES = {
  default: "report", modern: "report", clean: "report", business: "briefing", professional: "report",
  proposal: "report", case_study: "briefing", brief: "briefing", analysis: "briefing", whitepaper: "briefing",
  paper: "academic", research: "academic", literature_review: "academic", thesis: "academic", scholarly: "academic",
  lab_report: "lab", science: "lab", scientific: "lab", experiment: "lab",
  problem_set: "homework", worksheet: "homework", solutions: "homework", math: "homework",
  essay: "mla", mla_essay: "mla", apa_paper: "apa", apa7: "apa",
  manual: "guide", howto: "guide", "how-to": "guide", recipe: "guide", cookbook: "guide", handbook: "guide",
  study: "notes", study_guide: "notes", revision: "notes", cheatsheet: "notes", cheat_sheet: "notes", summary: "notes",
  cover_letter: "letter", memo: "letter",
  resume: "cv", resume_classic: "cv", cv_classic: "cv", ats: "cv", harvard: "cv",
  resume_modern: "cv_modern", modern_cv: "cv_modern", modern_resume: "cv_modern"
};

export function styleName(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (STYLES[key]) return key;
  if (STYLE_ALIASES[key]) return STYLE_ALIASES[key];
  return "";
}

// A style from the words of a request when the writer gave none.
export function chooseStyle(text = "") {
  const t = String(text).toLowerCase();
  if (/\b(resume|résumé|curriculum vitae|\bcv\b)/.test(t)) return /\b(modern|tech|software|design)\b/.test(t) ? "cv_modern" : "cv";
  if (/\bcover letter|letter of (recommendation|intent)|\bdear\b/.test(t)) return "letter";
  if (/\bapa\b/.test(t)) return "apa";
  if (/\bmla\b|\bessay\b/.test(t)) return "mla";
  if (/\blab report|experiment|titration|pendulum|measurement of\b/.test(t)) return "lab";
  if (/\b(homework|problem set|worked solutions?|worksheet|exercises)\b/.test(t)) return "homework";
  if (/\b(literature review|research paper|thesis|dissertation|term paper)\b/.test(t)) return "academic";
  if (/\b(study notes|revision|cheat ?sheet|study guide|lecture notes|summary notes)\b/.test(t)) return "notes";
  if (/\b(guide|how to|how-to|recipe|cookbook|manual|handbook|checklist)\b/.test(t)) return "guide";
  if (/\b(case study|market|industry|strategy|briefing|policy brief|swot)\b/.test(t)) return "briefing";
  return "report";
}

// Fonts a style override may name. PDF faces are bundled; Word gets its closest twin.
export const FONT_CHOICES = {
  "Inter": { docx: "Calibri", kind: "sans" },
  "IBM Plex Sans": { docx: "Arial", kind: "sans" },
  "Source Serif 4": { docx: "Cambria", kind: "serif" },
  "Lora": { docx: "Georgia", kind: "serif" },
  "EB Garamond": { docx: "Garamond", kind: "serif" },
  "Liberation Serif": { docx: "Times New Roman", kind: "serif" },
  "Liberation Sans": { docx: "Arial", kind: "sans" },
  "Carlito": { docx: "Calibri", kind: "sans" },
  "Caladea": { docx: "Cambria", kind: "serif" },
  "Gelasio": { docx: "Georgia", kind: "serif" },
  "JetBrains Mono": { docx: "Consolas", kind: "mono" }
};

// Requested font names (often Office or web names seen in a screenshot) to a bundled face.
const FONT_ALIASES = {
  "times new roman": "Liberation Serif", times: "Liberation Serif", "times roman": "Liberation Serif", tinos: "Liberation Serif",
  arial: "Liberation Sans", helvetica: "Liberation Sans", "helvetica neue": "Inter", "sf pro": "Inter", "segoe ui": "Inter",
  calibri: "Carlito", aptos: "Inter", roboto: "Inter", "open sans": "Inter", lato: "Inter", montserrat: "Inter", "source sans": "Inter",
  cambria: "Caladea", georgia: "Gelasio", garamond: "EB Garamond", "eb garamond": "EB Garamond", baskerville: "EB Garamond",
  "libre baskerville": "EB Garamond", "palatino": "EB Garamond", "book antiqua": "EB Garamond", merriweather: "Source Serif 4",
  "source serif": "Source Serif 4", "source serif pro": "Source Serif 4", "pt serif": "Source Serif 4", lora: "Lora",
  "playfair display": "Lora", "plex sans": "IBM Plex Sans", "ibm plex": "IBM Plex Sans", consolas: "JetBrains Mono",
  courier: "JetBrains Mono", "courier new": "JetBrains Mono", serif: "Source Serif 4", "sans-serif": "Inter", sans: "Inter", mono: "JetBrains Mono"
};

export function fontChoice(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (FONT_CHOICES[raw]) return raw;
  const key = raw.toLowerCase();
  const exact = Object.keys(FONT_CHOICES).find((name) => name.toLowerCase() === key);
  return exact || FONT_ALIASES[key] || "";
}

// Word face for a PDF face, keeping the docx name a user asked for when it is an Office font.
export function docxFont(pdfFace, requested = "") {
  const asked = String(requested || "").trim();
  if (/^(times new roman|arial|calibri|cambria|georgia|garamond|consolas|courier new|aptos|helvetica|verdana|tahoma)$/i.test(asked)) return asked;
  return FONT_CHOICES[pdfFace]?.docx || "Calibri";
}

const MARGINS = { narrow: [14, 14, 14, 14], normal: null, wide: [28, 30, 28, 30] };

// The design a document renders with: its style plus the document's own overrides.
export function resolveStyle(doc = {}) {
  const base = STYLES[styleName(doc.style)] || STYLES.report;
  const o = doc.overrides || {};
  const colors = { ...base.colors, ...(o.colors || {}) };
  if (o.colors?.accent && !o.colors?.palette) colors.palette = [o.colors.accent, ...base.colors.palette.filter((c) => c !== base.colors.accent)];
  if (o.colors?.accent && !o.colors?.tableHead && base.layout.tableStyle === "light") colors.tableHead = base.colors.tableHead;
  const pdf = { ...base.fonts.pdf };
  const docx = { ...base.fonts.docx };
  if (o.fonts?.heading) {
    pdf.heading = o.fonts.heading;
    docx.heading = docxFont(o.fonts.heading, o.fonts.heading_requested);
  }
  if (o.fonts?.body) {
    pdf.body = o.fonts.body;
    pdf.label = FONT_CHOICES[o.fonts.body]?.kind === "serif" && FONT_CHOICES[base.fonts.pdf.label]?.kind !== "serif" ? base.fonts.pdf.label : o.fonts.body;
    docx.body = docxFont(o.fonts.body, o.fonts.body_requested);
    docx.label = FONT_CHOICES[pdf.label] ? docxFont(pdf.label) : docx.body;
  }
  const type = { ...base.type };
  if (o.base_size) {
    const ratio = o.base_size / base.type.base;
    for (const key of ["base", "title", "subtitle", "h1", "h2", "h3"]) type[key] = Math.round(base.type[key] * ratio * 4) / 4;
  }
  if (o.line_height) type.line = o.line_height;
  if (o.heading_case) type.headingCase = o.heading_case;
  const layout = { ...base.layout };
  if (o.title_align) layout.titleBlock = layout.titleBlock === "left" || layout.titleBlock === "center" ? o.title_align : layout.titleBlock;
  if (o.title_align && layout.cv) layout.cvAlign = o.title_align;
  if (o.table_style) layout.tableStyle = o.table_style;
  if (o.callout_style) layout.calloutStyle = o.callout_style;
  if (o.heading_rule) layout.headingRule = o.heading_rule;
  if (o.margins && MARGINS[o.margins]) layout.margins = MARGINS[o.margins];
  if (typeof o.number_headings === "boolean") layout.numberHeadings = o.number_headings;
  if (typeof doc.numbered_headings === "boolean") layout.numberHeadings = doc.numbered_headings;
  if (typeof o.justify === "boolean") layout.justify = o.justify;
  return { name: base.name, label: base.label, colors, fonts: { pdf, docx }, type, layout };
}

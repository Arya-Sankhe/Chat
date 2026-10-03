import { documentSkillText, isKnownDocumentSkill } from "./skillRegistry.js";

const ALL_DOCUMENT_TOOLS = [
  "search_document",
  "read_document",
  "query_spreadsheet",
  "create_document",
  "edit_document",
  "export_document"
];

const READ_TOOLS = ["search_document", "read_document"];
const SHEET_KINDS = new Set(["xlsx", "csv", "tsv"]);

function clean(value) {
  return String(value || "").trim();
}

function addAll(target, values) {
  for (const value of values) target.add(value);
}

function readyDocumentList(readyDocuments) {
  return (readyDocuments || [])
    .slice(0, 10)
    .map((doc) => {
      const pageCount = Number(doc.page_count || doc.metadata?.page_count || 0);
      const pageText = pageCount && !SHEET_KINDS.has(doc.kind) ? `, ${pageCount} ${doc.kind === "pptx" ? "slides" : "pages"}` : "";
      return `- ${doc.attachments?.file_name || "Document"} (${doc.kind}${pageText}, attachment_id: ${doc.attachment_id}, version: ${doc.version_no || 1})`;
    })
    .join("\n");
}

const OFFICE_KINDS = new Set(["docx", "pptx", "xlsx"]);

function convertsExistingToPdf(prompt, readyDocuments) {
  if (!(readyDocuments || []).some((doc) => OFFICE_KINDS.has(doc?.kind))) return false;
  const toPdf = /\b(?:to|into|as)\s+(?:an?\s+)?pdf\b/i.test(prompt)
    || /\b(?:word|docx?|pptx?|powerpoint|slides?|deck|excel|xlsx|spreadsheet)\s*(?:->|→|2)\s*pdf\b/i.test(prompt)
    || /\bpdf\s+(?:version|copy)\b/i.test(prompt)
    || /\b(?:make|save|get|have)\s+(?:it|this|that|the\s+\w+)\s+(?:as\s+)?(?:an?\s+)?pdf\b/i.test(prompt);
  const action = /\b(convert|turn|change|export|save|make|download|get|want|need|give|send)\b/i.test(prompt)
    || /(?:->|→)/.test(prompt);
  // Asking for new content ("a summary as a pdf") is a create task, not a conversion.
  const newContent = /\b(summar\w*|notes|outline|report\s+on|study\s+guide|essay|translat\w*|rewrite|redesign|restyle|shorter|longer|cheat\s*sheet|flash\s*cards?|quiz)\b/i.test(prompt);
  return toPdf && action && !newContent;
}

// createFormat: "pptx" or "docx" when the user chose the Slides or Docs composer mode, so the
// create tool is offered even when the prompt is only a topic ("photosynthesis for grade 10").
export function selectDocumentSkills({ text = "", readyDocuments = [], messageHasDocuments = false, createFormat = "" } = {}) {
  const prompt = clean(text);
  const readyCount = Array.isArray(readyDocuments) ? readyDocuments.length : 0;

  const mentionsDocument = /\b(document|documents|file|files|attachment|attachments|upload|uploaded|attached|pdf|docx|word|xlsx|excel|spreadsheet|workbook|worksheet|csv|tsv|table|tables|slides?|pptx?|presentation)\b/i.test(prompt);
  const mentionsExisting = /\b(this|that|it|them|above|previous|attached|uploaded|source|original)\b/i.test(prompt);
  const readAction = /\b(summarize|summarise|summary|explain|analyze|analyse|review|read|search|find|extract|pull|compare|answer|solve|homework|questions?|what|where|which|how)\b/i.test(prompt);
  // Asking for a file again ("try again", "where is the pdf?"). Reading follow-ups ("read it",
  // "use the tools") are not here: they ask about a document, not for a new one.
  const followUpOnDocs = /\b(try again|retry|do (it|that) again|regenerate|recreate|redo|where is (it|the (document|file|pdf|docx)))\b/i.test(prompt);
  // "Read it, don't create or edit anything": the user rules a new file out.
  const refusesNewFile = /\b(?:don['’]?t|do not|without|no need to|never|not)\s+(?:\w+\s+){0,3}?(?:create|generate|make|produce|write|edit|export|save)\b/i.test(prompt)
    || /\bno (?:new )?(?:files?|documents?|edits?)\b/i.test(prompt);
  const createAction = /\b(create|make|generate|regenerate|recreate|redo|draft|write|build|produce|turn|convert|put)\b/i.test(prompt);
  const fileDeliveryAction = /\b(give|send|provide|prepare|share|attach|deliver|download|export|add)\b/i.test(prompt)
    || /\b(can|could|may)\s+(i|we)\s+get\b/i.test(prompt)
    || /\bi(?:'d| would)?\s+(like|need|want)\b/i.test(prompt);
  const editAction = /\b(edit|revise|redline|update|rewrite|change|modify|polish|fix|remove|delete|replace|recolou?r|swap|reorder|rename|hide|shorten|reword)\b/i.test(prompt);
  // Parts of a slide or page a follow-up edit can point at without naming the file.
  const mentionsDocumentPart = /\b(footer|header|title|subtitle|heading|page|pages|paragraph|bullet|card|chart|colou?rs?|font|theme|takeaway|slide)\b/i.test(prompt);
  const exportAction = /\b(export|convert|download\s+as|save\s+as)\b/i.test(prompt);

  const asksPdf = /\b(pdf|\.pdf)\b/i.test(prompt);
  const asksWord = /\b(word\s+(doc|document|file)|docx|\.docx)\b/i.test(prompt);
  const asksExcel = /\b(excel|xlsx|spreadsheet|workbook|worksheet|csv|tsv|\.xlsx|\.csv|\.tsv)\b/i.test(prompt);
  const asksPpt = /\b(powerpoint|ppt|pptx|slides?|deck|presentation)\b/i.test(prompt);
  const asksMarkdown = /\b(markdown|\.md)\b/i.test(prompt);
  const asksGenericDocument = /\b(doc|document|file|report|contract|proposal|memo|letter|invoice|brief)\b/i.test(prompt);
  const hasReadyVisualDocument = (readyDocuments || []).some((doc) => ["pdf", "docx", "pptx"].includes(doc?.kind));
  const hasReadySpreadsheet = (readyDocuments || []).some((doc) => SHEET_KINDS.has(doc?.kind));
  const wordOutput = /\b(create|make|generate|draft|write|build|produce|turn|convert|put|give|send|provide|prepare|share|attach|deliver|download|export|add)\s+(an?\s+)?(word|docx)\b/i.test(prompt)
    || (fileDeliveryAction && /\b(word\s+(doc|document|file)|docx\s+(file|document)|\.docx)\b/i.test(prompt));
  const pdfOutput = /\b(create|make|generate|draft|write|build|produce|turn|convert|put|give|send|provide|prepare|share|attach|deliver|download|export|add)\s+(an?\s+)?pdf\b/i.test(prompt)
    || /\b(as|to|into)\s+(an?\s+)?pdf\b/i.test(prompt)
    || (fileDeliveryAction && /\b(pdf\s+(file|document|handout)|\.pdf)\b/i.test(prompt));
  const excelOutput = /\b(create|make|generate|draft|write|build|produce|turn|convert|put|give|send|provide|prepare|share|attach|deliver|download|export|add)\s+(an?\s+)?(excel|xlsx|spreadsheet|workbook)\b/i.test(prompt)
    || (fileDeliveryAction && /\b(excel\s+(file|sheet|workbook)|xlsx\s+(file|document)|spreadsheet|workbook|\.xlsx|\.csv|\.tsv)\b/i.test(prompt));
  const pptOutput = /\b(create|make|generate|draft|write|build|produce|turn|convert|put|give|send|provide|prepare|share|attach|deliver|download|export|add)\s+(an?\s+)?(powerpoint|pptx?|slides?|deck|presentation)\b/i.test(prompt)
    || (fileDeliveryAction && /\b(powerpoint\s+(file|deck|presentation)|pptx?\s+(file|deck)|slide\s+deck|deck|presentation|\.pptx?)\b/i.test(prompt));
  const markdownOutput = /\b(create|make|generate|draft|write|build|produce|give|send|provide|prepare|share|attach|deliver|download|export)\s+(an?\s+)?markdown\b/i.test(prompt)
    || (fileDeliveryAction && /\b(markdown\s+(file|document)|\.md)\b/i.test(prompt));
  const explicitArtifactFormat = asksPdf || asksWord || asksExcel || asksPpt || asksMarkdown;
  // Naming a format only asks for a file alongside a create or delivery verb: "what does the
  // pdf say" reads the pdf, "send me a pdf" asks for one.
  const artifactTaskIntent = createAction || fileDeliveryAction;
  const wantsArtifactOutput = !refusesNewFile && (
    createAction || wordOutput || pdfOutput || excelOutput || pptOutput || markdownOutput
    || (explicitArtifactFormat && artifactTaskIntent)
    || (readyCount > 0 && followUpOnDocs)
  );

  const skills = new Set();
  const tools = new Set();

  const createFromExistingDocument = wantsArtifactOutput
    && /\b(from|based\s+on|using)\b[\s\S]{0,60}\b(this|that|it|attached|uploaded|document|file|pdf|docx|spreadsheet|attachment|upload)\b/i.test(prompt);

  // Any ready document can be read: the context says which ones are only partly included,
  // and the model decides whether it needs to read further.
  if (readyCount > 0) {
    skills.add("document-read");
    if (hasReadyVisualDocument) skills.add("pdf-read");
    if (hasReadySpreadsheet) {
      skills.add("xlsx-read");
      tools.add("query_spreadsheet");
    }
    addAll(tools, READ_TOOLS);
  }

  if (wantsArtifactOutput) {
    skills.add("artifact-planner");
    if (asksPdf && (!asksWord || pdfOutput && !wordOutput) && (!asksExcel || pdfOutput && !excelOutput) && (!asksPpt || pdfOutput && !pptOutput)) {
      skills.add("pdf-create");
      tools.add("create_document");
    }
    if (asksWord || asksMarkdown || (!explicitArtifactFormat && createAction && asksGenericDocument)) {
      skills.add("word-create");
      tools.add("create_document");
    }
    if (asksExcel && (!asksPdf || excelOutput && !pdfOutput) && (!asksWord || excelOutput && !wordOutput)) {
      skills.add("excel-create");
      tools.add("create_document");
    }
    if (asksPpt || pptOutput) {
      skills.add("presentation-create");
      tools.add("create_document");
    }
    if (readyCount > 0 && followUpOnDocs && !explicitArtifactFormat) {
      tools.add("create_document");
    }
  }

  if (createFormat === "pptx" || createFormat === "docx") {
    skills.add("artifact-planner");
    skills.add(createFormat === "pptx" ? "presentation-create" : "word-create");
    tools.add("create_document");
  }

  if (readyCount > 0 && editAction && !refusesNewFile && (mentionsDocument || mentionsExisting || mentionsDocumentPart)) {
    skills.add("document-edit");
    tools.add("edit_document");
    addAll(tools, READ_TOOLS);
    if (hasReadySpreadsheet) tools.add("query_spreadsheet");
  }

  if (readyCount > 0 && exportAction && !refusesNewFile && (mentionsDocument || mentionsExisting || asksPdf || asksWord || asksExcel)) {
    skills.add("document-export");
    tools.add("export_document");
  }

  // "Convert my Word file to PDF", "turn this deck into a pdf", "docx -> pdf": the existing file is
  // converted as is (LibreOffice keeps its exact layout), never re-written with create_document.
  if (convertsExistingToPdf(prompt, readyDocuments)) {
    for (const skill of ["artifact-planner", "pdf-create", "word-create", "excel-create", "presentation-create"]) skills.delete(skill);
    tools.delete("create_document");
    skills.add("document-export");
    tools.add("export_document");
  }

  const toolNames = ALL_DOCUMENT_TOOLS.filter((name) => tools.has(name));
  const skillNames = Array.from(skills);
  return {
    enabled: toolNames.length > 0,
    skills: skillNames,
    toolNames,
    // This turn asks for a file to be created, edited or exported. Only then does a reply that
    // talks about a document without making one count as a missed handoff.
    artifactRequested: ["create_document", "edit_document", "export_document"].some((name) => tools.has(name)),
    ready: readyCount,
    unsupported: []
  };
}

export function buildDocumentSystemHint({ readyDocuments = [], selection, deferredToolNames = [] } = {}) {
  if (!selection?.enabled) return "";
  const selectedSkillNames = selection.skills || [];
  const selectedSkills = selectedSkillNames.filter(isKnownDocumentSkill);
  const deferred = (deferredToolNames || []).filter((name) => ALL_DOCUMENT_TOOLS.includes(name));
  const sections = [
    deferred.length
      ? "Document tool routing for this turn. Prefer the selected document tools/skills; if the task needs a document capability that is not currently selected, call load_tools to enable it instead of refusing or claiming you are limited to reading files."
      : "Document tool routing for this turn. Use only the selected document tools/skills when they are needed; avoid unrelated tools and formats.",
    `Selected skills: ${selectedSkillNames.join(", ") || "none"}.`,
    `Available document tools this turn: ${(selection.toolNames || []).join(", ") || "none"}.`,
    deferred.length ? `Additional document tools available on demand via load_tools: ${deferred.join(", ")}.` : "",
    ...selectedSkills.map(documentSkillText)
  ];

  const needsReadyList = selectedSkills.some((skill) => ["document-read", "pdf-read", "document-edit", "document-export"].includes(skill));
  if (needsReadyList && readyDocuments?.length) {
    sections.push(`Ready uploaded/generated documents:\n${readyDocumentList(readyDocuments)}`);
  }

  if ((selection.toolNames || []).includes("create_document")) {
    sections.push("Capability check: create_document creates and writes downloadable DOCX, XLSX, PPTX, and PDF files plus editable Markdown documents. It is not read-only. Never say the available document tools can only read or inspect files when create_document is listed; call it for requested artifacts or explain the real tool error if it fails.");
  } else if (deferred.includes("create_document")) {
    sections.push("Capability check: you can create and write downloadable DOCX, XLSX, PPTX, and PDF files plus editable Markdown documents by calling load_tools with [\"documents.create\"] and then create_document. You are not read-only. Never say you cannot create, write, or attach files.");
  }

  sections.push("When a document tool returns output.download_url, mention the generated file briefly without including a URL or markdown link. The app will render an artifact card that opens the document viewer, where it can be downloaded.");
  return sections.filter(Boolean).join("\n\n");
}

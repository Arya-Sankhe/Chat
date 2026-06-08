import { documentSkillText, isKnownDocumentSkill } from "./skillRegistry.js";

const ALL_DOCUMENT_TOOLS = [
  "search_document",
  "read_document",
  "extract_tables",
  "create_document",
  "edit_document",
  "export_document"
];

const READ_TOOLS = ["search_document", "read_document", "extract_tables"];

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
      const pageText = doc.kind === "pdf" && pageCount ? `, ${pageCount} pages` : "";
      return `- ${doc.attachments?.file_name || "Document"} (${doc.kind}${pageText}, attachment_id: ${doc.attachment_id}, version: ${doc.version_no || 1})`;
    })
    .join("\n");
}

export function selectDocumentSkills({ text = "", readyDocuments = [], messageHasDocuments = false } = {}) {
  const prompt = clean(text);
  const readyCount = Array.isArray(readyDocuments) ? readyDocuments.length : 0;

  const mentionsDocument = /\b(document|documents|file|files|attachment|attachments|upload|uploaded|attached|pdf|docx|word|xlsx|excel|spreadsheet|workbook|worksheet|csv|tsv|table|tables|slides?|pptx?|presentation)\b/i.test(prompt);
  const mentionsExisting = /\b(this|that|it|them|above|previous|attached|uploaded|source|original)\b/i.test(prompt);
  const readAction = /\b(summarize|summarise|summary|explain|analyze|analyse|review|read|search|find|extract|pull|compare|answer|solve|homework|questions?|what|where|which|how)\b/i.test(prompt);
  const taskOnUploadedDocs = /\b(solve|homework|assignment|worksheet|problem\s?set|exercise|quiz|exam)\b/i.test(prompt);
  const followUpOnDocs = /\b(try again|retry|use (the )?(document )?tools?|read (it|them|the (document|file|pdf)))\b/i.test(prompt);
  const createAction = /\b(create|make|generate|draft|write|build|produce|turn|convert|put)\b/i.test(prompt);
  const editAction = /\b(edit|revise|redline|update|rewrite|change|modify|polish|fix)\b/i.test(prompt);
  const exportAction = /\b(export|convert|download\s+as|save\s+as)\b/i.test(prompt);

  const asksPdf = /\b(pdf|\.pdf)\b/i.test(prompt);
  const asksWord = /\b(word\s+(doc|document|file)|docx|\.docx)\b/i.test(prompt);
  const asksExcel = /\b(excel|xlsx|spreadsheet|workbook|worksheet|csv|tsv|\.xlsx|\.csv|\.tsv)\b/i.test(prompt);
  const asksPpt = /\b(powerpoint|ppt|pptx|slides?|deck|presentation)\b/i.test(prompt);
  const asksGenericDocument = /\b(document|file|report|contract|proposal|memo|letter|invoice|brief)\b/i.test(prompt);
  const hasReadyPdf = (readyDocuments || []).some((doc) => doc?.kind === "pdf");
  const wordOutput = /\b(create|make|generate|draft|write|build|produce|turn|convert|put)\s+(an?\s+)?(word|docx)\b/i.test(prompt)
    || /\b(word\s+(doc|document|file)|docx\s+(file|document))\b/i.test(prompt);
  const pdfOutput = /\b(create|make|generate|draft|write|build|produce|turn|convert|put)\s+(an?\s+)?pdf\b/i.test(prompt)
    || /\b(as|to|into)\s+(an?\s+)?pdf\b/i.test(prompt)
    || /\.pdf\b/i.test(prompt);
  const excelOutput = /\b(create|make|generate|draft|write|build|produce|turn|convert|put)\s+(an?\s+)?(excel|xlsx|spreadsheet|workbook)\b/i.test(prompt)
    || /\b(excel\s+(file|sheet|workbook)|xlsx\s+(file|document)|spreadsheet|workbook)\b/i.test(prompt);

  const skills = new Set();
  const tools = new Set();

  const createFromExistingDocument = createAction
    && /\b(from|based\s+on|using)\b[\s\S]{0,60}\b(this|that|it|attached|uploaded|document|file|pdf|docx|spreadsheet|attachment|upload)\b/i.test(prompt);

  /* Any ready PDF in this chat always gets visual read tools and the
     pdf-read skill so the model knows to call read_document and inspect
     page images instead of guessing from the placeholder text. */
  if (hasReadyPdf) {
    skills.add("document-read");
    skills.add("pdf-read");
    addAll(tools, READ_TOOLS);
  } else {
    const shouldRead = readyCount > 0 && (
      !prompt
      || messageHasDocuments
      || createFromExistingDocument
      || followUpOnDocs
      || (readAction && (mentionsDocument || mentionsExisting || taskOnUploadedDocs))
      || (createAction && mentionsExisting)
    );
    if (shouldRead) {
      skills.add("document-read");
      addAll(tools, READ_TOOLS);
    }
  }

  if (createAction) {
    skills.add("artifact-planner");
    if (asksPdf && (!asksWord || pdfOutput && !wordOutput) && (!asksExcel || pdfOutput && !excelOutput)) {
      skills.add("pdf-create");
      tools.add("create_document");
    }
    if (asksWord || (!asksPdf && !asksExcel && !asksPpt && asksGenericDocument)) {
      skills.add("word-create");
      tools.add("create_document");
    }
    if (asksExcel && (!asksPdf || excelOutput && !pdfOutput) && (!asksWord || excelOutput && !wordOutput)) {
      skills.add("excel-create");
      tools.add("create_document");
    }
    if (asksPpt) {
      skills.add("presentation-create");
      tools.add("create_document");
    }
  }

  if (readyCount > 0 && editAction && (mentionsDocument || mentionsExisting)) {
    skills.add("document-edit");
    tools.add("edit_document");
    addAll(tools, READ_TOOLS);
  }

  if (readyCount > 0 && exportAction && (mentionsDocument || mentionsExisting || asksPdf || asksWord || asksExcel)) {
    skills.add("document-export");
    tools.add("export_document");
  }

  const toolNames = ALL_DOCUMENT_TOOLS.filter((name) => tools.has(name));
  const skillNames = Array.from(skills);
  return {
    enabled: toolNames.length > 0,
    skills: skillNames,
    toolNames,
    ready: readyCount,
    unsupported: []
  };
}

export function buildDocumentSystemHint({ readyDocuments = [], selection } = {}) {
  if (!selection?.enabled) return "";
  const selectedSkillNames = selection.skills || [];
  const selectedSkills = selectedSkillNames.filter(isKnownDocumentSkill);
  const sections = [
    "Document tool routing for this turn. Use only the selected document tools/skills when they are needed; avoid unrelated tools and formats.",
    `Selected skills: ${selectedSkillNames.join(", ") || "none"}.`,
    `Available document tools this turn: ${(selection.toolNames || []).join(", ") || "none"}.`,
    ...selectedSkills.map(documentSkillText)
  ];

  const needsReadyList = selectedSkills.some((skill) => ["document-read", "pdf-read", "document-edit", "document-export"].includes(skill));
  if (needsReadyList && readyDocuments?.length) {
    sections.push(`Ready uploaded/generated documents:\n${readyDocumentList(readyDocuments)}`);
  }

  sections.push("When a document tool returns output.download_url, mention the generated file briefly. The app will render a download card from tool metadata.");
  return sections.filter(Boolean).join("\n\n");
}

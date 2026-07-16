import { configuredServices } from "../config.js";
import { HttpError, parseJsonBody, readRawBody, sendJson } from "../http/responses.js";
import { OPENROUTER_TEXT_MODEL, resolveProvider } from "../providers.js";
import { createCrofaiUsageMeter } from "../saas/usageMeter.js";
import { assertUpload, documentKindFromFileName } from "../storage/r2.js";
import { DocumentService } from "../documents/index.js";
import { requireChatContext } from "./context.js";

const REVISE_SELECTION_MAX = 24_000;
const REVISE_DOC_MAX = 120_000;
const REVISE_INSTRUCTION_MAX = 4_000;

export function documentKindFromUpload({ fileName, contentType }) {
  const fromName = documentKindFromFileName(fileName);
  if (fromName) return fromName;
  const type = String(contentType || "").toLowerCase().split(";")[0];
  if (type === "application/pdf") return "pdf";
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (type === "text/csv" || type === "application/csv") return "csv";
  if (type === "text/tab-separated-values") return "tsv";
  return "";
}

function documentExtractionLimits(config) {
  return {
    max_file_bytes: config.documents.maxFileBytes,
    max_pdf_pages: config.documents.maxPdfPages,
    max_docx_words: config.documents.maxDocxWords,
    max_xlsx_sheets: config.documents.maxXlsxSheets,
    max_xlsx_cells: config.documents.maxXlsxCells,
    max_csv_rows: config.documents.maxCsvRows,
    max_csv_columns: config.documents.maxCsvColumns,
    max_extracted_chars: config.documents.maxExtractedChars,
    visual_page_dpi: config.documents.visualPageDpi
  };
}

export async function handlePresignUpload(req, res, config) {
  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req);
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (projectId && !await context.db.getProject(context.user.id, projectId, { signal: req.signal })) {
    throw new HttpError(404, "Project not found.");
  }

  const category = assertUpload({
    category: body.category,
    contentType: body.contentType,
    fileName: body.fileName,
    sizeBytes: Number(body.sizeBytes)
  }, {
    maxImageBytes: config.r2.maxImageBytes,
    maxDocumentBytes: config.documents.maxFileBytes
  });
  if (projectId && category !== "document") {
    throw new HttpError(400, "Only documents can be added to project knowledge.");
  }
  if (category === "document" && !configuredServices(config).documents) {
    throw new HttpError(503, "Document uploads are not configured.");
  }

  const objectKey = context.r2.objectKey({ userId: context.user.id, fileName: body.fileName });
  const attachment = await context.db.createAttachment({
    user_id: context.user.id,
    category,
    object_key: objectKey,
    file_name: String(body.fileName || "upload"),
    content_type: body.contentType,
    size_bytes: Number(body.sizeBytes),
    status: "pending",
    project_id: projectId || null
  }, { signal: req.signal });

  sendJson(res, 200, {
    uploadId: attachment.id,
    objectKey,
    uploadUrl: context.r2.uploadUrl(
      objectKey,
      category === "document" ? config.documents.uploadExpiresSeconds : config.r2.uploadExpiresSeconds
    ),
    method: "PUT",
    headers: context.r2.uploadHeaders(body.contentType || "application/octet-stream"),
    category,
    maxImageBytes: config.r2.maxImageBytes,
    maxDocumentBytes: config.documents.maxFileBytes
  });
}

export async function handleUploadContent(req, res, config, uploadId) {
  const context = await requireChatContext(req, config);
  const attachment = await context.db.getAttachment(context.user.id, uploadId, { signal: req.signal });
  if (!attachment) throw new HttpError(404, "Upload not found.");
  if (attachment.status !== "pending") throw new HttpError(400, "Upload was already completed.");

  const category = attachment.category || "image";
  if (category === "document" && !configuredServices(config).documents) {
    throw new HttpError(503, "Document uploads are not configured.");
  }

  const maxBytes = category === "document" ? config.documents.maxFileBytes : config.r2.maxImageBytes;
  const raw = await readRawBody(req, maxBytes);
  const expectedSize = Number(attachment.size_bytes);
  if (Number.isInteger(expectedSize) && expectedSize > 0 && raw.length !== expectedSize) {
    throw new HttpError(400, "Uploaded file size did not match the presigned upload.");
  }

  assertUpload({
    category,
    contentType: attachment.content_type,
    fileName: attachment.file_name,
    sizeBytes: raw.length
  }, {
    maxImageBytes: config.r2.maxImageBytes,
    maxDocumentBytes: config.documents.maxFileBytes
  });

  const result = await context.r2.putObject(attachment.object_key, raw, {
    contentType: attachment.content_type || req.headers["content-type"] || "application/octet-stream",
    expiresSeconds: category === "document" ? config.documents.uploadExpiresSeconds : config.r2.uploadExpiresSeconds,
    signal: req.signal
  });

  sendJson(res, 200, {
    ok: true,
    uploadId: attachment.id,
    etag: result.etag || null
  });
}

export async function handleCompleteUpload(req, res, config) {
  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req);
  const attachment = await context.db.getAttachment(context.user.id, body.uploadId, { signal: req.signal });
  if (!attachment) throw new HttpError(404, "Upload not found.");
  if (!["pending", "uploaded"].includes(attachment.status)) throw new HttpError(400, "Upload cannot be completed.");

  const head = await context.r2.headObject(attachment.object_key, { signal: req.signal });
  const category = attachment.category || "image";
  assertUpload({
    category,
    contentType: attachment.content_type,
    fileName: attachment.file_name,
    sizeBytes: head.sizeBytes || attachment.size_bytes
  }, {
    maxImageBytes: config.r2.maxImageBytes,
    maxDocumentBytes: config.documents.maxFileBytes
  });

  let completed = attachment;
  let documentFile = null;
  if (category === "document") {
    const kind = documentKindFromUpload({
      fileName: attachment.file_name,
      contentType: attachment.content_type
    });
    if (!kind) throw new HttpError(400, "Unsupported document type.");
    const result = await context.db.completeDocumentUpload({
      userId: context.user.id,
      attachmentId: attachment.id,
      sizeBytes: head.sizeBytes || attachment.size_bytes,
      etag: head.etag || attachment.etag || null,
      kind,
      limits: documentExtractionLimits(config),
      projectId: attachment.project_id || null,
      projectMaxBytes: context.plan.maxProjectBytes
    }, { signal: req.signal });
    completed = result?.attachment;
    documentFile = result?.document_file;
    if (!completed || !documentFile) throw new HttpError(500, "Document upload could not be queued.");
  } else if (attachment.status === "pending") {
    completed = await context.db.completeAttachment(context.user.id, attachment.id, {
      size_bytes: head.sizeBytes || attachment.size_bytes,
      etag: head.etag || null
    }, { signal: req.signal });
  }

  sendJson(res, 200, {
    id: completed.id,
    fileName: completed.file_name,
    contentType: completed.content_type,
    sizeBytes: completed.size_bytes,
    category: completed.category || category,
    document: documentFile ? {
      id: documentFile.id,
      status: documentFile.processing_status,
      kind: documentFile.kind,
      textReadyAt: documentFile.text_ready_at || null,
      visualReadyAt: documentFile.visual_ready_at || null,
      enrichedAt: documentFile.enriched_at || null,
      usable: Boolean(documentFile.text_ready_at || documentFile.visual_ready_at)
    } : null
  });
}

export async function handleAttachmentDownload(req, res, config, attachmentId, url) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const attachment = await context.db.getAttachment(context.user.id, attachmentId, { signal: req.signal });
  if (!attachment || attachment.status !== "uploaded") throw new HttpError(404, "Attachment not found.");

  const signedUrl = context.r2.readUrl(attachment.object_key, { fileName: attachment.file_name });

  const wantsJson = url?.searchParams?.get("json") === "1"
    || String(req.headers["accept"] || "").toLowerCase().includes("application/json");

  if (wantsJson) {
    sendJson(res, 200, {
      url: signedUrl,
      fileName: attachment.file_name,
      contentType: attachment.content_type
    });
    return;
  }

  res.writeHead(302, {
    location: signedUrl,
    "cache-control": "no-store"
  });
  res.end();
}

function pdfPreviewFileName(fileName) {
  const safe = String(fileName || "document").split(/[\\/]/).pop() || "document";
  return safe.replace(/\.[a-z0-9]+$/i, "") + ".pdf";
}

function attachmentDocumentKind(attachment) {
  const extKind = documentKindFromFileName(attachment?.file_name);
  if (extKind) return extKind;
  const contentType = String(attachment?.content_type || "").toLowerCase().split(";")[0];
  if (contentType === "application/pdf") return "pdf";
  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (contentType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  return "";
}

function inlineViewPayload(context, attachment, { sourceKind = "", status = "ready" } = {}) {
  return {
    status,
    url: context.r2.readUrl(attachment.object_key, {
      fileName: attachment.file_name,
      disposition: "inline",
      contentType: "application/pdf"
    }),
    fileName: attachment.file_name,
    contentType: "application/pdf",
    kind: "pdf",
    sourceKind: sourceKind || attachmentDocumentKind(attachment) || "pdf",
    attachmentId: attachment.id
  };
}

function sheetViewPayload(attachment, chunks) {
  const usesRanges = chunks.some((chunk) => (
    chunk.source_type === "sheet_range"
    || Array.isArray(chunk.metadata?.row_numbers)
  ));
  let sheets;
  if (!usesRanges) {
    sheets = chunks.map((chunk, index) => ({
      name: chunk.source_label || `Sheet ${index + 1}`,
      rows: String(chunk.text || "").split("\n").map((row) => row.split("\t"))
    }));
  } else {
    const grouped = new Map();
    for (const chunk of chunks) {
      const metadata = chunk.metadata || {};
      const name = String(metadata.sheet || chunk.source_label || "Sheet").trim();
      if (!grouped.has(name)) grouped.set(name, new Map());
      const rows = grouped.get(name);
      const lines = String(chunk.text || "").split("\n");
      if (metadata.header_repeated) lines.shift();
      const rowNumbers = Array.isArray(metadata.row_numbers) ? metadata.row_numbers : [];
      const columnStart = Math.max(1, Number(metadata.column_start || 1));
      lines.forEach((line, index) => {
        const rowNumber = Number(rowNumbers[index] || metadata.row_start || index + 1);
        const row = rows.get(rowNumber) || [];
        line.split("\t").forEach((cell, offset) => {
          row[columnStart - 1 + offset] = cell;
        });
        rows.set(rowNumber, row);
      });
    }
    sheets = [...grouped.entries()].map(([name, rows]) => ({
      name,
      rows: [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => (
        Array.from({ length: row.length }, (_, index) => row[index] ?? "")
      ))
    }));
  }
  return {
    status: "ready",
    fileName: attachment.file_name,
    contentType: attachment.content_type,
    kind: "xlsx",
    sourceKind: "xlsx",
    attachmentId: attachment.id,
    sheets
  };
}

function editableViewPayload(attachment, doc) {
  return {
    status: "ready",
    fileName: attachment.file_name,
    contentType: attachment.content_type,
    kind: "editable",
    sourceKind: doc.kind,
    attachmentId: attachment.id,
    markdown: String(doc.metadata?.editor_markdown || ""),
    revision: Number(doc.metadata?.editor_revision || 1)
  };
}

function editableDocumentTitle(fileName) {
  return String(fileName || "Document").replace(/\.(md|docx|pdf)$/i, "").trim() || "Document";
}

async function requireEditableDocument(context, attachmentId, signal) {
  const doc = await context.db.getDocumentFileByAttachment(context.user.id, attachmentId, { signal });
  if (!doc || doc.metadata?.editable !== true || !String(doc.metadata?.editor_markdown || "").trim()) {
    throw new HttpError(404, "Editable document source was not found.");
  }
  return doc;
}

export async function handleAttachmentView(req, res, config, attachmentId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const attachment = await context.db.getAttachment(context.user.id, attachmentId, { signal: req.signal });
  if (!attachment || attachment.status !== "uploaded") throw new HttpError(404, "Attachment not found.");

  const kind = attachmentDocumentKind(attachment);
  const doc = ["pdf", "docx"].includes(kind) && configuredServices(config).documents
    ? await context.db.getDocumentFileByAttachment(context.user.id, attachment.id, { signal: req.signal })
    : null;

  if (doc?.metadata?.editable === true && String(doc.metadata?.editor_markdown || "").trim()) {
    sendJson(res, 200, editableViewPayload(attachment, doc));
    return;
  }

  if (kind === "pdf") {
    sendJson(res, 200, inlineViewPayload(context, attachment, { sourceKind: "pdf" }));
    return;
  }

  if (!["docx", "xlsx", "pptx"].includes(kind)) {
    throw new HttpError(400, "Only PDF, DOCX, XLSX, and PPTX previews are supported.");
  }
  if (!configuredServices(config).documents) {
    throw new HttpError(503, "Document previews are not configured.");
  }

  const documentFile = doc || await context.db.getDocumentFileByAttachment(context.user.id, attachment.id, { signal: req.signal });
  if (!documentFile) throw new HttpError(404, "Document metadata not found.");

  if (kind === "xlsx" && documentFile.text_ready_at) {
    let chunks = await context.db.listDocumentChunks(context.user.id, documentFile.id, {
      sourceType: "sheet_range",
      limit: 1000,
      signal: req.signal
    });
    if (!chunks.length) {
      chunks = await context.db.listDocumentChunks(context.user.id, documentFile.id, {
        sourceType: "sheet",
        limit: config.documents.maxXlsxSheets,
        signal: req.signal
      });
    }
    if (chunks.length) {
      sendJson(res, 200, sheetViewPayload(attachment, chunks));
      return;
    }
  }

  const cached = await context.db.getReadyPdfPreviewForDocument(context.user.id, documentFile.id, { signal: req.signal });
  if (cached?.attachments?.status === "uploaded" && cached.attachments.object_key) {
    sendJson(res, 200, inlineViewPayload(context, cached.attachments, { sourceKind: kind }));
    return;
  }

  const active = await context.db.getActivePdfPreviewJob(context.user.id, documentFile.id, { signal: req.signal });
  const job = active || await context.db.createDocumentJob({
    user_id: context.user.id,
    document_file_id: documentFile.id,
    conversation_id: documentFile.conversation_id,
    message_id: documentFile.message_id || null,
    job_type: `document.export.${kind}_to_pdf`,
    priority: -5,
    input: {
      target_format: "pdf",
      preview: true,
      attachment_id: attachment.id,
      document_file_id: documentFile.id,
      output_file_name: pdfPreviewFileName(attachment.file_name)
    }
  }, { signal: req.signal });

  sendJson(res, active ? 200 : 202, {
    status: "processing",
    jobId: job.id,
    fileName: pdfPreviewFileName(attachment.file_name),
    kind: "pdf",
    sourceKind: kind
  });
}

export async function handleDocumentEditor(req, res, config, attachmentId) {
  if (req.method !== "PATCH") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const doc = await requireEditableDocument(context, attachmentId, req.signal);
  const body = await parseJsonBody(req, 256 * 1024);
  const markdown = String(body.markdown || "").trim();
  if (!markdown) throw new HttpError(400, "Document content cannot be empty.");
  if (markdown.length > 200_000) throw new HttpError(413, "Document content is too large.");
  const currentRevision = Number(doc.metadata?.editor_revision || 1);
  if (body.revision !== undefined && Number(body.revision) !== currentRevision) {
    throw new HttpError(409, "This document was changed elsewhere. Reopen it before saving.");
  }
  const revision = currentRevision + 1;
  await context.db.updateDocumentFile(context.user.id, doc.id, {
    metadata: { ...doc.metadata, editor_markdown: markdown, editor_revision: revision }
  }, { signal: req.signal });
  sendJson(res, 200, { saved: true, revision });
}

export async function handleDocumentEditorExport(req, res, config, attachmentId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const attachment = await context.db.getAttachment(context.user.id, attachmentId, { signal: req.signal });
  if (!attachment || attachment.status !== "uploaded") throw new HttpError(404, "Attachment not found.");
  const doc = await requireEditableDocument(context, attachmentId, req.signal);
  const body = await parseJsonBody(req, 256 * 1024);
  const format = String(body.format || "").toLowerCase();
  if (!["docx", "pdf"].includes(format)) throw new HttpError(400, "Export format must be docx or pdf.");
  const markdown = String(body.markdown || doc.metadata.editor_markdown || "").trim();
  if (!markdown || markdown.length > 200_000) throw new HttpError(400, "Document content cannot be exported.");
  const documents = new DocumentService({
    config,
    db: context.db,
    r2: context.r2,
    userId: context.user.id,
    conversationId: doc.conversation_id,
    plan: context.plan,
    signal: req.signal
  });
  const title = editableDocumentTitle(attachment.file_name);
  const result = await documents.enqueueAndWait({
    jobType: `document.create.${format}`,
    generatedCount: 1,
    input: {
      format,
      title,
      instructions: "Export the edited document faithfully.",
      content: markdown,
      content_source: "editor",
      sections: [],
      tables: [],
      data: {},
      editor_markdown: markdown
    }
  });
  const output = result.output || {};
  if (result.pending) {
    sendJson(res, 202, { status: "processing", jobId: result.job?.id || output.job_id });
    return;
  }
  if (!result.ok || !output.attachment_id) {
    throw new HttpError(502, result.error?.message || "Document export failed.");
  }
  sendJson(res, 200, {
    status: "ready",
    artifact: {
      attachment_id: output.attachment_id,
      file_name: output.file_name,
      format: output.kind
    }
  });
}

function stripReviseFences(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

export async function handleDocumentEditorRevise(req, res, config, attachmentId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  if (!configuredServices(config).documents) {
    throw new HttpError(503, "Document editing is not configured.");
  }
  const context = await requireChatContext(req, config);
  await requireEditableDocument(context, attachmentId, req.signal);
  const body = await parseJsonBody(req, 256 * 1024);
  const markdown = String(body.markdown || "").trim();
  const selection = String(body.selection || "").trim();
  const instruction = String(body.instruction || "").trim();
  if (!markdown) throw new HttpError(400, "Document content cannot be empty.");
  if (!selection) throw new HttpError(400, "Select text to revise.");
  if (!instruction) throw new HttpError(400, "Describe the changes you want.");
  if (markdown.length > REVISE_DOC_MAX) throw new HttpError(413, "Document is too large to revise in place.");
  if (selection.length > REVISE_SELECTION_MAX) throw new HttpError(413, "Selection is too large to revise in place.");
  if (instruction.length > REVISE_INSTRUCTION_MAX) throw new HttpError(413, "Change request is too long.");

  const provider = resolveProvider("openrouter", config);
  const model = typeof body.model === "string" && body.model.trim()
    ? body.model.trim()
    : OPENROUTER_TEXT_MODEL;
  const meter = createCrofaiUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal: req.signal
  });

  const content = await meter.chatCompletion({
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    providerId: provider.id,
    signal: req.signal,
    body: {
      model,
      temperature: 0.2,
      max_tokens: 4000,
      messages: [
        {
          role: "system",
          content: [
            "You revise a selected portion of a markdown document.",
            "Return ONLY the replacement markdown for that selection.",
            "No preface, no explanation, no markdown fences.",
            "Keep the rest of the document unchanged by only rewriting the selection.",
            "Preserve structure (headings, lists, tables, emphasis) unless the instruction asks to change it.",
            "Match the document's tone and formatting."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            "Full document:",
            markdown,
            "",
            "Selected portion to revise:",
            selection,
            "",
            "Instruction:",
            instruction
          ].join("\n")
        }
      ]
    }
  });

  const replacement = stripReviseFences(content);
  if (!replacement) throw new HttpError(502, "The model returned an empty revision.");
  sendJson(res, 200, { replacement });
}

export async function handleAttachmentDelete(req, res, config, attachmentId) {
  if (req.method !== "DELETE") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const attachment = await context.db.getAttachment(context.user.id, attachmentId, { signal: req.signal });
  if (!attachment) throw new HttpError(404, "Attachment not found.");
  if (attachment.conversation_id || attachment.message_id) {
    throw new HttpError(409, "Attached chat files can only be removed by deleting the message or chat.");
  }

  const keys = await attachmentStorageKeys(context, attachment, config, req.signal);
  await context.r2.deleteObjects(keys, { signal: req.signal });
  await context.db.deleteAttachment(context.user.id, attachment.id, { signal: req.signal });
  sendJson(res, 200, { deleted: true });
}

export async function handleDocumentStatus(req, res, config, attachmentId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const doc = await context.db.getDocumentFileByAttachment(context.user.id, attachmentId, { signal: req.signal });
  if (!doc) throw new HttpError(404, "Document not found.");
  sendJson(res, 200, {
    document: {
      id: doc.id,
      attachmentId: doc.attachment_id,
      kind: doc.kind,
      status: doc.processing_status,
      usable: Boolean(doc.text_ready_at || doc.visual_ready_at),
      textReadyAt: doc.text_ready_at || null,
      visualReadyAt: doc.visual_ready_at || null,
      enrichedAt: doc.enriched_at || null,
      pageCount: doc.page_count,
      wordCount: doc.word_count,
      sheetCount: doc.sheet_count,
      usedCellCount: doc.used_cell_count,
      progress: Number(doc.metadata?.progress || (doc.processing_status === "ready" ? 100 : 0)) || 0,
      stage: doc.metadata?.stage || "",
      mode: doc.metadata?.mode || "",
      stageErrors: doc.stage_errors || {},
      error: doc.error || null,
      versionNo: doc.version_no,
      sourceEtag: doc.source_etag
    }
  });
}

function sourceToolFromJobType(jobType) {
  const value = String(jobType || "");
  if (value.startsWith("document.create")) return "create_document";
  if (value.startsWith("document.edit")) return "edit_document";
  if (value.startsWith("document.export")) return "export_document";
  return "";
}

export async function handleDocumentJobStatus(req, res, config, jobId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const job = await context.db.getDocumentJob(context.user.id, jobId, { signal: req.signal });
  if (!job) throw new HttpError(404, "Job not found.");
  const output = job.output || {};
  const ready = job.status === "succeeded" && output.attachment_id && output.download_url;
  const artifact = ready ? {
    id: output.attachment_id,
    attachment_id: output.attachment_id,
    document_file_id: output.document_file_id || "",
    file_name: output.file_name || "Generated document",
    format: output.kind || "",
    status: "ready",
    download_url: output.download_url,
    source_tool: sourceToolFromJobType(job.job_type)
  } : null;
  sendJson(res, 200, {
    job: {
      id: job.id,
      status: job.status,
      job_type: job.job_type,
      error: job.error || null
    },
    artifact
  });
}

export async function attachmentStorageKeys(context, attachment, config, signal) {
  const keys = [attachment.object_key];
  const doc = attachment.category === "document"
    ? await context.db.getDocumentFileByAttachment(context.user.id, attachment.id, { signal })
    : null;
  if (!doc) return keys;
  if (doc.extraction_key) keys.push(doc.extraction_key);
  if (doc.preview_key) keys.push(doc.preview_key);
  const pages = await context.db.listDocumentPages(context.user.id, doc.id, {
    limit: config.documents.maxPdfPages,
    signal
  });
  keys.push(...pages.map((page) => page.image_key));
  if (["pdf", "docx", "xlsx", "pptx"].includes(doc.kind)) {
    const maxPages = Number(doc.page_count || doc.metadata?.page_count || config.documents.maxPdfPages || 100);
    for (let page = 1; page <= Math.min(Math.max(maxPages, 0), config.documents.maxPdfPages); page += 1) {
      keys.push(`users/${context.user.id}/documents/${doc.id}/pages/page-${String(page).padStart(4, "0")}.jpg`);
    }
  }
  return keys;
}

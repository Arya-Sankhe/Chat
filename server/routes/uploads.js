import { configuredServices } from "../config.js";
import { HttpError, parseJsonBody, readRawBody, sendJson } from "../http/responses.js";
import { assertUpload, documentKindFromFileName } from "../storage/r2.js";
import { requireChatContext } from "./context.js";

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

  const category = assertUpload({
    category: body.category,
    contentType: body.contentType,
    fileName: body.fileName,
    sizeBytes: Number(body.sizeBytes)
  }, {
    maxImageBytes: config.r2.maxImageBytes,
    maxDocumentBytes: config.documents.maxFileBytes
  });
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
    status: "pending"
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
      limits: documentExtractionLimits(config)
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
      kind: documentFile.kind
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

export async function handleAttachmentView(req, res, config, attachmentId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const attachment = await context.db.getAttachment(context.user.id, attachmentId, { signal: req.signal });
  if (!attachment || attachment.status !== "uploaded") throw new HttpError(404, "Attachment not found.");

  const kind = attachmentDocumentKind(attachment);

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

  const doc = await context.db.getDocumentFileByAttachment(context.user.id, attachment.id, { signal: req.signal });
  if (!doc) throw new HttpError(404, "Document metadata not found.");

  const cached = await context.db.getReadyPdfPreviewForDocument(context.user.id, doc.id, { signal: req.signal });
  if (cached?.attachments?.status === "uploaded" && cached.attachments.object_key) {
    sendJson(res, 200, inlineViewPayload(context, cached.attachments, { sourceKind: kind }));
    return;
  }

  const active = await context.db.getActivePdfPreviewJob(context.user.id, doc.id, { signal: req.signal });
  const job = active || await context.db.createDocumentJob({
    user_id: context.user.id,
    document_file_id: doc.id,
    conversation_id: doc.conversation_id,
    message_id: doc.message_id || null,
    job_type: `document.export.${kind}_to_pdf`,
    priority: -5,
    input: {
      target_format: "pdf",
      preview: true,
      attachment_id: attachment.id,
      document_file_id: doc.id,
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
      pageCount: doc.page_count,
      wordCount: doc.word_count,
      sheetCount: doc.sheet_count,
      usedCellCount: doc.used_cell_count,
      progress: Number(doc.metadata?.progress || (doc.processing_status === "ready" ? 100 : 0)) || 0,
      stage: doc.metadata?.stage || "",
      mode: doc.metadata?.mode || "",
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
    ? await context.db.getDocumentFileByAttachment(context.user.id, attachment.id, { signal }).catch(() => null)
    : null;
  if (!doc) return keys;
  if (doc.extraction_key) keys.push(doc.extraction_key);
  if (doc.preview_key) keys.push(doc.preview_key);
  const pages = await context.db.listDocumentPages(context.user.id, doc.id, {
    limit: config.documents.maxPdfPages,
    signal
  }).catch(() => []);
  keys.push(...pages.map((page) => page.image_key));
  if (doc.kind === "pdf") {
    const maxPages = Number(doc.page_count || doc.metadata?.page_count || config.documents.maxPdfPages || 100);
    for (let page = 1; page <= Math.min(Math.max(maxPages, 0), config.documents.maxPdfPages); page += 1) {
      keys.push(`users/${context.user.id}/documents/${doc.id}/pages/page-${String(page).padStart(4, "0")}.jpg`);
    }
  }
  return keys;
}

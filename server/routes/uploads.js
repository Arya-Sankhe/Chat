import { createHash, createHmac } from "node:crypto";
import { configuredServices } from "../config.js";
import { HttpError, parseJsonBody, readRawBody, sendJson } from "../http/responses.js";
import { enforceRateLimit } from "../http/rateLimit.js";
import { OPENROUTER_TEXT_MODEL, resolveProvider } from "../providers.js";
import { createModelUsageMeter } from "../saas/usageMeter.js";
import { mapStorageRpcError, STORAGE_LIST_LIMIT, storageUsage, deleteReservedUpload } from "../saas/storageQuota.js";
import { assertUpload, documentKindFromFileName } from "../storage/r2.js";
import { stripImageMetadata } from "../storage/stripImageMetadata.js";
import { DocumentService } from "../documents/index.js";
import { buildMeteredWebsearch, resolveWebSearchMode } from "../chat/pipeline.js";
import { runEditorModel } from "../documents/editorModel.js";
import { transcribeCourseImage } from "../study/generate.js";
import { isAudioUpload } from "../study/audio.js";
import { requireChatContext } from "./context.js";

const REVISE_SELECTION_MAX = 24_000;
const REVISE_DOC_MAX = 120_000;
const REVISE_INSTRUCTION_MAX = 4_000;
const REVISE_TIMEOUT_MS = 300_000;

function documentUploadMaxBytes(context, config) {
  return Math.min(context.plan.maxDocumentFileBytes ?? config.documents.maxFileBytes, config.documents.maxFileBytes);
}

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

function documentExtractionLimits(config, plan) {
  const planPages = Number(plan?.maxDocumentPages);
  const maxPdfPages = Number.isInteger(planPages) && planPages > 0
    ? Math.min(config.documents.maxPdfPages, planPages)
    : config.documents.maxPdfPages;
  return {
    max_file_bytes: config.documents.maxFileBytes,
    max_pdf_pages: maxPdfPages,
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
  enforceRateLimit(req, "uploads-presign", 30, 60_000, context.user.id);
  const body = await parseJsonBody(req);
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const project = projectId
    ? await context.db.getProject(context.user.id, projectId, { signal: req.signal })
    : null;
  if (projectId && !project) throw new HttpError(404, "Project not found.");

  const category = assertUpload({
    category: body.category,
    contentType: body.contentType,
    fileName: body.fileName,
    sizeBytes: Number(body.sizeBytes)
  }, {
    maxImageBytes: config.r2.maxImageBytes,
    maxDocumentBytes: documentUploadMaxBytes(context, config)
  });
  if (projectId && category !== "document" && project.kind !== "course") {
    throw new HttpError(400, "Only documents can be added to project knowledge.");
  }
  if (category === "document" && !configuredServices(config).documents) {
    throw new HttpError(503, "Document uploads are not configured.");
  }

  const objectKey = context.r2.objectKey({ userId: context.user.id, fileName: body.fileName });
  const contentType = body.contentType || "application/octet-stream";
  const sizeBytes = Number(body.sizeBytes);
  let attachment;
  try {
    attachment = await context.db.reserveAttachment({
      userId: context.user.id,
      maxBytes: context.plan.maxStorageBytes,
      category,
      objectKey,
      fileName: String(body.fileName || "upload"),
      contentType,
      sizeBytes,
      projectId: projectId || null
    }, { signal: req.signal });
  } catch (error) {
    mapStorageRpcError(error);
  }

  const expiresSeconds = category === "document"
    ? config.documents.uploadExpiresSeconds
    : config.r2.uploadExpiresSeconds;
  sendJson(res, 200, {
    uploadId: attachment.id,
    objectKey,
    uploadUrl: context.r2.uploadUrl(objectKey, expiresSeconds, { contentLength: sizeBytes, contentType }),
    method: "PUT",
    headers: context.r2.uploadHeaders(contentType),
    category,
    maxImageBytes: config.r2.maxImageBytes,
    maxDocumentBytes: documentUploadMaxBytes(context, config)
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

  // Course audio is reserved through /api/study/courses/:id/audio; this relay only runs
  // when the browser cannot PUT to R2 directly.
  const audio = category === "document" && Boolean(attachment.project_id)
    && isAudioUpload({ fileName: attachment.file_name, contentType: attachment.content_type });
  const maxBytes = audio ? config.studyAudio.maxUploadBytes
    : category === "document" ? documentUploadMaxBytes(context, config) : config.r2.maxImageBytes;
  const raw = await readRawBody(req, maxBytes);
  const expectedSize = Number(attachment.size_bytes);
  if (Number.isInteger(expectedSize) && expectedSize > 0 && raw.length !== expectedSize) {
    throw new HttpError(400, "Uploaded file size did not match the presigned upload.");
  }

  if (!audio) assertUpload({
    category,
    contentType: attachment.content_type,
    fileName: attachment.file_name,
    sizeBytes: raw.length
  }, {
    maxImageBytes: config.r2.maxImageBytes,
    maxDocumentBytes: documentUploadMaxBytes(context, config)
  });

  const body = category === "image" ? stripImageMetadata(raw) : raw;
  const result = await context.r2.putObject(attachment.object_key, body, {
    contentType: attachment.content_type || req.headers["content-type"] || "application/octet-stream",
    expiresSeconds: category === "document" ? config.documents.uploadExpiresSeconds : config.r2.uploadExpiresSeconds,
    signal: req.signal
  });
  if (body.length !== raw.length) {
    await context.db.updateAttachment(context.user.id, attachment.id, {
      size_bytes: body.length
    }, { signal: req.signal });
  }

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

  const failComplete = async (error) => {
    if (attachment.status !== "pending") throw error;
    try {
      await deleteReservedUpload(context, attachment, { signal: req.signal });
    } catch {
      throw error;
    }
    throw error;
  };

  let head;
  try {
    head = await context.r2.headObject(attachment.object_key, { signal: req.signal });
  } catch (error) {
    await failComplete(error);
  }
  let sizeBytes = Number(head.sizeBytes);
  let etag = head.etag || attachment.etag || null;
  const reservedBytes = Number(attachment.size_bytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes !== reservedBytes) {
    await failComplete(new HttpError(400, "Uploaded file size did not match the reserved upload."));
  }

  const category = attachment.category || "image";
  if (category === "image") {
    try {
      const stored = await context.r2.getObject(attachment.object_key, { signal: req.signal });
      const cleaned = stripImageMetadata(stored);
      if (cleaned.length !== stored.length) {
        const rewritten = await context.r2.putObject(attachment.object_key, cleaned, {
          contentType: attachment.content_type || "application/octet-stream",
          expiresSeconds: config.r2.uploadExpiresSeconds,
          signal: req.signal
        });
        sizeBytes = cleaned.length;
        etag = rewritten.etag || etag;
      }
    } catch (error) {
      await failComplete(error);
    }
  }
  try {
    assertUpload({
      category,
      contentType: attachment.content_type,
      fileName: attachment.file_name,
      sizeBytes
    }, {
      maxImageBytes: config.r2.maxImageBytes,
      maxDocumentBytes: documentUploadMaxBytes(context, config)
    });
  } catch (error) {
    await failComplete(error);
  }

  let completed = attachment;
  let documentFile = null;
  try {
    if (category === "document") {
      const kind = documentKindFromUpload({
        fileName: attachment.file_name,
        contentType: attachment.content_type
      });
      if (!kind) throw new HttpError(400, "Unsupported document type.");
      const result = await context.db.completeDocumentUpload({
        userId: context.user.id,
        attachmentId: attachment.id,
        sizeBytes,
        etag,
        kind,
        queue: config.documents.queue,
        limits: documentExtractionLimits(config, context.plan),
        projectId: attachment.project_id || null,
        projectMaxBytes: context.plan.maxProjectBytes,
        accountMaxBytes: context.plan.maxStorageBytes
      }, { signal: req.signal });
      completed = result?.attachment;
      documentFile = result?.document_file;
      if (!completed || !documentFile) throw new HttpError(500, "Document upload could not be queued.");
    } else if (attachment.status === "pending") {
      completed = await context.db.completeReservedAttachment({
        userId: context.user.id,
        attachmentId: attachment.id,
        sizeBytes,
        etag,
        maxBytes: context.plan.maxStorageBytes
      }, { signal: req.signal });
    }
  } catch (error) {
    try {
      mapStorageRpcError(error);
    } catch (mapped) {
      await failComplete(mapped);
    }
  }

  let note = null;
  let courseImage = false;
  if (completed && (completed.category || category) === "image" && completed.project_id) {
    const project = await context.db.getProject(context.user.id, completed.project_id, { signal: req.signal });
    if (project?.kind === "course") {
      courseImage = true;
      try {
        note = await transcribeCourseImage({
          context,
          config,
          course: project,
          attachment: completed,
          signal: req.signal
        });
      } catch {
        note = null;
      }
    }
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
    } : null,
    ...(courseImage ? { note } : note ? { note } : {})
  });
}

function storageConversation(row) {
  const fromAttachment = row?.conversations;
  const fromMessage = Array.isArray(row?.messages) ? row.messages[0] : row?.messages;
  const nested = fromMessage?.conversations;
  const conversationId = row?.conversation_id || fromMessage?.conversation_id || fromAttachment?.id || nested?.id || "";
  const title = fromAttachment?.title || nested?.title || "";
  return { conversationId, title };
}

export async function handleStorage(req, res, config) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const [usedBytesRaw, items, totals] = await Promise.all([
    context.db.accountStorageUsed(context.user.id, { signal: req.signal }),
    context.db.listUserStorageAttachments(context.user.id, { limit: STORAGE_LIST_LIMIT, signal: req.signal }),
    context.db.listConversationStorageTotals(context.user.id, { signal: req.signal })
  ]);
  const usedBytes = Number(usedBytesRaw) || 0;
  const siblingByConversation = new Map();
  for (const row of Array.isArray(totals) ? totals : []) {
    const conversationId = row?.conversation_id;
    if (!conversationId) continue;
    siblingByConversation.set(conversationId, {
      count: Number(row.count || row.id || 0),
      bytes: Number(row.bytes || row.size_bytes || 0)
    });
  }
  const listed = (Array.isArray(items) ? items : []).map((row) => {
    const docs = Array.isArray(row.document_files) ? row.document_files[0] : row.document_files;
    const { conversationId, title } = storageConversation(row);
    const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    const sibling = siblingByConversation.get(conversationId) || { count: 0, bytes: 0 };
    const linkedToChat = Boolean(conversationId || row.message_id);
    return {
      id: row.id,
      fileName: row.file_name,
      contentType: row.content_type,
      category: row.category,
      status: row.status,
      sizeBytes: Number(row.size_bytes) || 0,
      createdAt: row.created_at,
      conversationId: conversationId || null,
      conversationTitle: title || null,
      projectId: row.project_id || project?.id || null,
      projectName: project?.name || null,
      source: docs?.source || "upload",
      processingStatus: docs?.processing_status || null,
      siblingCount: sibling.count,
      siblingBytes: sibling.bytes,
      canDelete: !linkedToChat
    };
  });
  const listedBytes = listed.reduce((sum, item) => sum + item.sizeBytes, 0);
  sendJson(res, 200, {
    ...storageUsage(usedBytes, context.plan.maxStorageBytes),
    listedBytes,
    hiddenBytes: Math.max(0, usedBytes - listedBytes),
    items: listed
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

function signOnlyOfficeConfig(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function onlyOfficeViewPayload(context, attachment, config) {
  const officeConfig = {
    document: {
      fileType: "xlsx",
      key: createHash("sha256")
        .update(`${attachment.id}:${attachment.etag || attachment.object_key}`)
        .digest("hex"),
      title: attachment.file_name,
      url: context.r2.readUrl(attachment.object_key, {
        fileName: attachment.file_name,
        disposition: "inline",
        contentType: attachment.content_type
      }),
      permissions: { download: false, edit: false, print: false }
    },
    documentType: "cell",
    editorConfig: {
      mode: "view",
      user: { id: context.user.id, name: "Klui" },
      customization: {
        compactHeader: true,
        compactToolbar: true,
        hideRightMenu: true,
        toolbarNoTabs: true
      }
    },
    type: "desktop"
  };
  return {
    status: "ready",
    fileName: attachment.file_name,
    contentType: attachment.content_type,
    kind: "office",
    sourceKind: "xlsx",
    attachmentId: attachment.id,
    officeUrl: config.onlyoffice.publicUrl,
    officeConfig: { ...officeConfig, token: signOnlyOfficeConfig(officeConfig, config.onlyoffice.jwtSecret) }
  };
}

async function loadSheetView(context, attachment, documentFile, config, signal) {
  let chunks = await context.db.listDocumentChunks(context.user.id, documentFile.id, {
    sourceType: "sheet_range",
    limit: 1000,
    signal
  });
  if (!chunks.length) {
    chunks = await context.db.listDocumentChunks(context.user.id, documentFile.id, {
      sourceType: "sheet",
      limit: config.documents.maxXlsxSheets,
      signal
    });
  }
  return chunks.length ? sheetViewPayload(attachment, chunks) : null;
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

// What the viewer may offer for a document: Ask Klui edits (PDF, Word, PowerPoint in a chat)
// and the formats it downloads as (a Klui document renders to both PDF and Word).
async function viewerActions(context, attachment, doc, signal) {
  if (!doc || !["pdf", "docx", "pptx"].includes(doc.kind)) return {};
  const spec = ["pdf", "docx"].includes(doc.kind) && typeof context.db.getDocSpecForDocument === "function"
    ? await context.db.getDocSpecForDocument(context.user.id, doc.id, { signal }).catch(() => null)
    : null;
  // Ask Klui edits a deck through the slide spec Klui generated it from; an uploaded PPTX has none.
  const deckSpec = doc.kind === "pptx" && doc.conversation_id && typeof context.db.getDeckSpecForDocument === "function"
    ? await context.db.getDeckSpecForDocument(context.user.id, doc.id, { signal }).catch(() => null)
    : null;
  return {
    editAttachmentId: attachment.id,
    canAsk: Boolean(doc.conversation_id) && (doc.kind !== "pptx" || Boolean(deckSpec)),
    designed: Boolean(spec),
    exportFormats: spec ? ["pdf", "docx"] : doc.kind === "pdf" ? ["pdf"] : [doc.kind, "pdf"]
  };
}

export async function handleAttachmentView(req, res, config, attachmentId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const attachment = await context.db.getAttachment(context.user.id, attachmentId, { signal: req.signal });
  if (!attachment || attachment.status !== "uploaded") throw new HttpError(404, "Attachment not found.");

  if (["text/plain", "text/markdown"].includes(attachment.content_type)) {
    const source = await context.db.getDocumentFileByAttachment(context.user.id, attachment.id, { signal: req.signal });
    if (source && ["text", "website"].includes(source.kind)) {
      const chunks = await context.db.listDocumentChunks(context.user.id, source.id, { limit: 100, signal: req.signal });
      sendJson(res, 200, {
        status: "ready", kind: "text", sourceKind: source.kind,
        fileName: source.metadata?.title || attachment.file_name,
        markdown: chunks.map(chunk => chunk.text).join(""), sourceUrl: source.metadata?.source_url || ""
      });
      return;
    }
  }

  const kind = attachmentDocumentKind(attachment);
  const doc = ["pdf", "docx"].includes(kind) && configuredServices(config).documents
    ? await context.db.getDocumentFileByAttachment(context.user.id, attachment.id, { signal: req.signal })
    : null;

  if (doc?.metadata?.editable === true && String(doc.metadata?.editor_markdown || "").trim()) {
    sendJson(res, 200, editableViewPayload(attachment, doc));
    return;
  }

  if (kind === "pdf") {
    sendJson(res, 200, { ...inlineViewPayload(context, attachment, { sourceKind: "pdf" }), ...await viewerActions(context, attachment, doc, req.signal) });
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

  if (kind === "xlsx") {
    const sheetFallback = new URL(req.url, "http://localhost").searchParams.get("fallback") === "sheet";
    if (!sheetFallback && config.onlyoffice?.publicUrl && config.onlyoffice?.jwtSecret) {
      sendJson(res, 200, onlyOfficeViewPayload(context, attachment, config));
      return;
    }
    if (documentFile.text_ready_at) {
      const payload = await loadSheetView(context, attachment, documentFile, config, req.signal);
      if (payload) {
        sendJson(res, 200, payload);
        return;
      }
    }
    throw new HttpError(409, "The workbook preview is still being prepared.");
  }

  const cached = await context.db.getReadyPdfPreviewForDocument(context.user.id, documentFile.id, { signal: req.signal });
  if (cached?.attachments?.status === "uploaded" && cached.attachments.object_key) {
    sendJson(res, 200, { ...inlineViewPayload(context, cached.attachments, { sourceKind: kind }), ...await viewerActions(context, attachment, documentFile, req.signal) });
    return;
  }

  const active = await context.db.getActivePdfPreviewJob(context.user.id, documentFile.id, { signal: req.signal });
  const job = active || await context.db.createDocumentJob({
    user_id: context.user.id,
    queue: config.documents.queue,
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
      output_file_name: pdfPreviewFileName(attachment.file_name),
      account_max_bytes: context.plan.maxStorageBytes,
      project_id: documentFile.project_id || attachment.project_id || null
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
  const source = await context.db.getDocumentFileByAttachment(context.user.id, attachmentId, { signal: req.signal });
  const editable = source?.metadata?.editable === true && String(source.metadata?.editor_markdown || "").trim();
  if (!editable) {
    // A document file (Klui-designed or uploaded) exports through the worker.
    if (!source || !["pdf", "docx", "pptx", "xlsx"].includes(source.kind)) throw new HttpError(404, "Document not found.");
    const body = await parseJsonBody(req, 16 * 1024);
    const format = String(body.format || "").toLowerCase();
    if (!["docx", "pdf"].includes(format)) throw new HttpError(400, "Export format must be docx or pdf.");
    const documents = new DocumentService({
      config, db: context.db, r2: context.r2, userId: context.user.id, conversationId: source.conversation_id,
      projectId: source.project_id || attachment.project_id || null, plan: context.plan, signal: req.signal
    });
    const result = await documents.exportDocument({ attachmentId, targetFormat: format });
    const output = result.output || {};
    if (result.pending) {
      sendJson(res, 202, { status: "processing", jobId: result.job?.id || output.job_id });
      return;
    }
    if (!result.ok || !output.attachment_id) throw new HttpError(502, result.error?.message || "Document export failed.");
    sendJson(res, 200, { status: "ready", artifact: { attachment_id: output.attachment_id, file_name: output.file_name, format: output.kind } });
    return;
  }
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
    projectId: doc.project_id || attachment.project_id || null,
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
  const meter = createModelUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal: req.signal,
    meteringMode: config.desktop.meteringMode,
    reservationCredits: config.desktop.chatReservationCredits
  });

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(REVISE_TIMEOUT_MS)]);
  // Web search like a chat turn, unless the user turned search off; the model decides whether
  // the change needs it ("update this price to the latest official figure").
  const websearch = buildMeteredWebsearch({ config });
  let content;
  try {
    ({ content } = await runEditorModel({
      config,
      modelClient: meter,
      provider,
      websearch: resolveWebSearchMode({ body, config, websearch }) !== "off" ? websearch : null,
      signal,
      note: "You can call web_search and read_url when the change needs current or missing facts. Your final reply must still be only the replacement markdown.",
      body: {
        model: OPENROUTER_TEXT_MODEL,
        temperature: 0.2,
        max_tokens: 32_000,
        // Medium reasoning ensures adherence to structural formatting and surrounding context while avoiding the token/latency overhead of high effort.
        reasoning: { effort: "medium", exclude: false },
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
    }));
  } catch (error) {
    if (signal.aborted && !req.signal.aborted) throw new HttpError(504, "Document revision timed out. Try again.");
    throw error;
  }

  const replacement = stripReviseFences(content);
  if (!replacement) throw new HttpError(502, "The model returned an empty revision.");
  sendJson(res, 200, { replacement });
}

const ASK_INSTRUCTION_MAX = 4_000;
const ASK_SELECTION_MAX = 12_000;
const ASK_TIMEOUT_MS = 300_000;

function askArtifact(output, fallbackName) {
  const attachmentId = String(output?.attachment_id || "");
  if (!attachmentId) return null;
  return {
    id: attachmentId,
    attachment_id: attachmentId,
    document_file_id: output.document_file_id || "",
    file_name: output.file_name || fallbackName,
    format: output.kind || "",
    status: output.status || "ready",
    download_url: `/api/attachments/${encodeURIComponent(attachmentId)}/download`,
    source_tool: "edit_document"
  };
}

// "Ask Klui" in the document viewer: a precise edit of this exact document (only the selection,
// when there is one). The edit is a new version; the request and the new version are recorded
// in the chat so the conversation and later edits continue from it.
export async function handleDocumentAsk(req, res, config, attachmentId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  if (!configuredServices(config).documents) throw new HttpError(503, "Document editing is not configured.");
  const context = await requireChatContext(req, config);
  const attachment = await context.db.getAttachment(context.user.id, attachmentId, { signal: req.signal });
  if (!attachment || attachment.status !== "uploaded") throw new HttpError(404, "Attachment not found.");
  const doc = await context.db.getDocumentFileByAttachment(context.user.id, attachment.id, { signal: req.signal });
  if (!doc || !["pdf", "docx", "pptx"].includes(doc.kind)) throw new HttpError(400, "Ask Klui edits PDF, Word and PowerPoint documents.");
  if (!doc.conversation_id) throw new HttpError(403, "Project knowledge is read-only. Create a copy before editing it.");
  if (doc.kind === "pptx" && !(await context.db.getDeckSpecForDocument?.(context.user.id, doc.id, { signal: req.signal }))) {
    throw new HttpError(400, "Ask Klui edits decks Klui made. To change text in this presentation, ask in the chat.");
  }
  const body = await parseJsonBody(req, 64 * 1024);
  const instruction = String(body.instruction || "").trim();
  if (!instruction) throw new HttpError(400, "Describe the change you want.");
  if (instruction.length > ASK_INSTRUCTION_MAX) throw new HttpError(413, "Change request is too long.");
  const raw = body.selection && typeof body.selection === "object" ? body.selection : null;
  const selection = raw && String(raw.text || "").trim()
    ? {
        text: String(raw.text).trim().slice(0, ASK_SELECTION_MAX),
        before: String(raw.before || "").slice(-200),
        after: String(raw.after || "").slice(0, 200),
        page: Number.isInteger(Number(raw.page)) && Number(raw.page) > 0 ? Number(raw.page) : null,
        blocks: Array.isArray(raw.blocks) ? raw.blocks.map(String).slice(0, 40) : []
      }
    : null;
  enforceRateLimit(req, "document-ask", 20, 60_000, context.user.id);

  const meter = createModelUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal: req.signal,
    meteringMode: config.desktop.meteringMode,
    reservationCredits: config.desktop.chatReservationCredits
  });
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(ASK_TIMEOUT_MS)]);
  // The editor gets web search like a chat turn (unless the user turned search off) and decides
  // itself whether the change needs it ("update these prices to today's").
  const websearch = buildMeteredWebsearch({ config });
  const documents = new DocumentService({
    config,
    db: context.db,
    r2: context.r2,
    userId: context.user.id,
    conversationId: doc.conversation_id,
    projectId: doc.project_id || attachment.project_id || null,
    plan: context.plan,
    signal,
    modelClient: meter,
    websearch: resolveWebSearchMode({ body, config, websearch }) !== "off" ? websearch : null,
    userRequest: instruction
  });
  let result;
  try {
    result = await documents.editDocument({ attachmentId: attachment.id, instructions: instruction, selection });
  } catch (error) {
    if (signal.aborted && !req.signal.aborted) throw new HttpError(504, "The edit took too long. Try again.");
    throw error;
  }
  const output = result?.output || {};
  if (!result?.ok) throw new HttpError(502, result?.error?.message || "The edit failed.");
  if (output.status === "unchanged") {
    sendJson(res, 200, { status: "unchanged", summary: output.doc_edit_summary || "Nothing was changed." });
    return;
  }
  const summaryText = String(output.doc_edit_summary || output.deck_edit_summary || "").trim();
  let artifact;
  if (result.pending) {
    const jobId = result.job?.id || output.job_id || "";
    if (!jobId) throw new HttpError(502, "The edit could not be queued.");
    // Still rendering: the chat records a pending card for the job, which the chat resolves to the
    // new version when the job finishes (the same way a pending create_document card does).
    artifact = {
      pending: true,
      job_id: jobId,
      file_name: attachment.file_name,
      format: doc.kind,
      status: "processing",
      source_tool: "edit_document"
    };
  } else {
    artifact = askArtifact(output, attachment.file_name);
    if (!artifact) throw new HttpError(502, "The edited document was not saved.");
  }
  const summary = summaryText || "Updated the document.";
  // Record the edit in the chat: the request (with what was selected) and the new version.
  let messages = [];
  try {
    const quoted = selection ? ` (selected: "${selection.text.slice(0, 160)}${selection.text.length > 160 ? "…" : ""}")` : "";
    const userMessage = await context.db.insertMessage({
      user_id: context.user.id,
      conversation_id: doc.conversation_id,
      role: "user",
      model: null,
      content: `${instruction}${quoted}`,
      reasoning: "",
      tool_calls: [],
      metadata: { documentAsk: { attachmentId: attachment.id, fileName: attachment.file_name, ...(selection ? { selection: selection.text.slice(0, 500) } : {}) } }
    }, { signal: req.signal });
    const assistantMessage = await context.db.insertMessage({
      user_id: context.user.id,
      conversation_id: doc.conversation_id,
      role: "assistant",
      model: "klui-docs",
      content: summary,
      reasoning: "",
      tool_calls: [],
      metadata: {
        documents: { artifacts: [artifact], toolCallCount: 1 },
        ...(Array.isArray(output.web_sources) && output.web_sources.length ? { websearch: { mode: "auto", citations: output.web_sources } } : {}),
        documentAsk: { sourceAttachmentId: attachment.id }
      }
    }, { signal: req.signal });
    messages = [userMessage, assistantMessage].filter(Boolean);
  } catch (error) {
    console.warn(`document ask: chat record failed: ${error?.message || error}`);
  }
  if (result.pending) {
    sendJson(res, 202, {
      status: "processing",
      jobId: artifact.job_id,
      summary: summaryText,
      conversationId: doc.conversation_id,
      messageIds: messages.map((message) => message.id)
    });
    return;
  }
  sendJson(res, 200, {
    status: "ready",
    summary,
    artifact,
    previewAttachmentId: output.preview_attachment_id || null,
    conversationId: doc.conversation_id,
    messageIds: messages.map((message) => message.id)
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

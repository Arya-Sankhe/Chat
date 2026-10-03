import { single } from "./helpers.js";
import { assertDocumentVersions } from "../../documents/library.js";

// Shared by chat, Study Hub and editor reads. A re-ingest clears readiness before
// writing and publishes a new stamp after writing, so both sides must match.
async function readDocumentContent(client, userId, ids, read, signal) {
  if (!ids.length) return [];
  const versions = () => client.request("document_files", {
    query: {
      user_id: `eq.${userId}`,
      id: `in.(${ids.join(",")})`,
      select: "id,text_ready_at,visual_ready_at"
    },
    signal
  });
  const before = await versions();
  assertDocumentVersions(ids.map((id) => before.find((doc) => doc.id === id) || { id }), before);
  const result = await read();
  assertDocumentVersions(before, await versions());
  return result;
}

export async function createDocumentFile(client, documentFile, { signal } = {}) {
  const rows = await client.request("document_files", {
    method: "POST",
    body: documentFile,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function getDocumentFile(client, userId, documentFileId, { signal } = {}) {
  const rows = await client.request("document_files", {
    query: {
      id: `eq.${documentFileId}`,
      user_id: `eq.${userId}`,
      select: "*,attachments(id,file_name,content_type,size_bytes,object_key,etag)",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function getDocumentFileByAttachment(client, userId, attachmentId, { signal } = {}) {
  const rows = await client.request("document_files", {
    query: {
      attachment_id: `eq.${attachmentId}`,
      user_id: `eq.${userId}`,
      select: "*,attachments(id,file_name,content_type,size_bytes,object_key,etag)",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function getReadyPdfPreviewForDocument(client, userId, documentFileId, { signal } = {}) {
  const rows = await client.request("document_files", {
    query: {
      parent_document_id: `eq.${documentFileId}`,
      user_id: `eq.${userId}`,
      kind: "eq.pdf",
      processing_status: "eq.ready",
      select: "*,attachments(id,file_name,content_type,size_bytes,object_key,etag,status)",
      order: "created_at.desc",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function getActivePdfPreviewJob(client, userId, documentFileId, { signal } = {}) {
  const rows = await client.request("document_jobs", {
    query: {
      user_id: `eq.${userId}`,
      document_file_id: `eq.${documentFileId}`,
      status: "in.(queued,running)",
      job_type: "in.(document.export.docx_to_pdf,document.export.xlsx_to_pdf,document.export.pptx_to_pdf)",
      select: "*",
      order: "created_at.desc",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function listReadyDocumentFiles(client, userId, conversationId, { signal } = {}) {
  return client.request("document_files", {
    query: {
      user_id: `eq.${userId}`,
      conversation_id: `eq.${conversationId}`,
      processing_status: "eq.ready",
      select: "*,attachments(id,file_name,content_type,size_bytes,object_key,etag)",
      order: "created_at.asc"
    },
    signal
  });
}

export async function listUsableDocumentFiles(client, userId, conversationId, { signal } = {}) {
  return client.request("document_files", {
    query: {
      user_id: `eq.${userId}`,
      conversation_id: `eq.${conversationId}`,
      or: "(text_ready_at.not.is.null,visual_ready_at.not.is.null)",
      select: "*,attachments(id,file_name,content_type,size_bytes,object_key,etag)",
      order: "created_at.asc"
    },
    signal
  });
}

export async function listUsableProjectDocumentFiles(client, userId, projectId, { signal } = {}) {
  return client.request("document_files", {
    query: {
      user_id: `eq.${userId}`,
      project_id: `eq.${projectId}`,
      or: "(text_ready_at.not.is.null,visual_ready_at.not.is.null)",
      select: "*,attachments(id,file_name,content_type,size_bytes,object_key,etag)",
      order: "created_at.asc"
    },
    signal
  });
}

/** Documents of a chat or project that are still processing or failed, so a turn can name them. */
export async function listUnreadyDocumentFiles(client, userId, { conversationId = null, projectId = null } = {}, { signal } = {}) {
  const owners = [
    conversationId ? `conversation_id.eq.${conversationId}` : "",
    projectId ? `project_id.eq.${projectId}` : ""
  ].filter(Boolean);
  if (!owners.length) return [];
  return client.request("document_files", {
    query: {
      user_id: `eq.${userId}`,
      or: `(${owners.join(",")})`,
      text_ready_at: "is.null",
      visual_ready_at: "is.null",
      select: "id,attachment_id,conversation_id,project_id,kind,processing_status,error,metadata,created_at,attachments(file_name)",
      order: "created_at.asc",
      limit: "40"
    },
    signal
  });
}

/** Chosen project documents by id, in any processing state, so a turn can wait for pending ones. */
export async function listProjectDocumentFilesByIds(client, userId, projectId, documentFileIds = [], { signal } = {}) {
  const ids = [...new Set(documentFileIds.filter(Boolean))];
  if (!projectId || !ids.length) return [];
  return client.request("document_files", {
    query: {
      user_id: `eq.${userId}`,
      project_id: `eq.${projectId}`,
      id: `in.(${ids.join(",")})`,
      select: "id,attachment_id,processing_status,text_ready_at,visual_ready_at,error,metadata"
    },
    signal
  });
}

export async function listDocumentChunksForFiles(client, userId, documentFileIds = [], { limit = 5000, offset = 0, signal } = {}) {
  const ids = [...new Set(documentFileIds.filter(Boolean))];
  if (!ids.length) return [];
  return readDocumentContent(client, userId, ids, () => client.request("document_chunks", {
    query: {
      user_id: `eq.${userId}`,
      document_file_id: `in.(${ids.join(",")})`,
      select: "document_file_id,chunk_index,source_type,source_label,text,token_estimate,metadata",
      order: "document_file_id.asc,chunk_index.asc",
      limit: String(limit),
      ...(offset ? { offset: String(offset) } : {})
    },
    signal
  }), signal);
}

export async function listDocumentFilesByAttachments(client, userId, attachmentIds = [], { signal } = {}) {
  const ids = [...new Set(attachmentIds.filter(Boolean))];
  if (!ids.length) return [];
  return client.request("document_files", {
    query: {
      user_id: `eq.${userId}`,
      attachment_id: `in.(${ids.join(",")})`,
      select: "*,attachments(id,file_name,content_type,size_bytes,object_key,etag)"
    },
    signal
  });
}

export async function updateDocumentFile(client, userId, documentFileId, patch, { signal } = {}) {
  const rows = await client.request("document_files", {
    method: "PATCH",
    query: { id: `eq.${documentFileId}`, user_id: `eq.${userId}` },
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function updateDocumentFileByAttachment(client, userId, attachmentId, patch, { signal } = {}) {
  const rows = await client.request("document_files", {
    method: "PATCH",
    query: { attachment_id: `eq.${attachmentId}`, user_id: `eq.${userId}` },
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function createDocumentJob(client, job, { signal } = {}) {
  const rows = await client.request("document_jobs", {
    method: "POST",
    body: job,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function completeDocumentUpload(client, {
  userId,
  attachmentId,
  sizeBytes,
  etag = null,
  kind,
  queue = "local",
  limits = {},
  projectId = null,
  projectMaxBytes = null,
  accountMaxBytes = null
}, { signal } = {}) {
  return client.rpc("klui_complete_document_upload", {
    p_user_id: userId,
    p_attachment_id: attachmentId,
    p_size_bytes: sizeBytes,
    p_etag: etag,
    p_kind: kind,
    p_queue: queue,
    p_limits: limits,
    p_project_id: projectId,
    p_project_max_bytes: projectMaxBytes,
    p_account_max_bytes: accountMaxBytes
  }, { signal });
}

export async function getDocumentJob(client, userId, jobId, { signal } = {}) {
  const rows = await client.request("document_jobs", {
    query: { id: `eq.${jobId}`, user_id: `eq.${userId}`, select: "*", limit: "1" },
    signal
  });
  return single(rows);
}

// The DeckSpec a generated or edited PPTX was rendered from, stored on the job that made it.
// The worker reports the deck exactly as rendered (resolved theme, markdown fallback); older
// jobs only have the spec they were sent.
export async function getDeckSpecForDocument(client, userId, documentFileId, { signal } = {}) {
  const rows = await client.request("document_jobs", {
    query: {
      user_id: `eq.${userId}`,
      "output->>document_file_id": `eq.${documentFileId}`,
      status: "eq.succeeded",
      job_type: "in.(document.create.pptx,document.edit.pptx)",
      select: "id,rendered:output->deck,sent:input->data->deck",
      order: "created_at.desc",
      limit: "1"
    },
    signal
  });
  const row = single(rows);
  const usable = (deck) => deck && typeof deck === "object" && Array.isArray(deck.slides);
  return usable(row?.rendered) ? row.rendered : usable(row?.sent) ? row.sent : null;
}

// The DocSpec a Klui PDF or Word document was rendered from, stored on the job that made it
// (create, edit or export). Uploaded files have none and are edited in place instead.
export async function getDocSpecForDocument(client, userId, documentFileId, { signal } = {}) {
  const rows = await client.request("document_jobs", {
    query: {
      user_id: `eq.${userId}`,
      "output->>document_file_id": `eq.${documentFileId}`,
      status: "eq.succeeded",
      job_type: "in.(document.create.docx,document.create.pdf,document.edit.docx,document.edit.pdf,document.export.docx_to_pdf,document.export.pdf_to_docx,document.export.docx_to_docx,document.export.pdf_to_pdf)",
      select: "id,rendered:output->doc,sent:input->data->doc",
      order: "created_at.desc",
      limit: "1"
    },
    signal
  });
  const row = single(rows);
  const usable = (doc) => doc && typeof doc === "object" && Array.isArray(doc.blocks);
  return usable(row?.rendered) ? row.rendered : usable(row?.sent) ? row.sent : null;
}

export async function listDocumentChunks(client, userId, documentFileId, { limit = 20, offset = 0, sourceType = "", sheet = "", signal } = {}) {
  return readDocumentContent(client, userId, [documentFileId], () => client.request("document_chunks", {
    query: {
      user_id: `eq.${userId}`,
      document_file_id: `eq.${documentFileId}`,
      ...(sourceType ? { source_type: `eq.${sourceType}` } : {}),
      ...(sheet ? { "metadata->>sheet": `eq.${sheet}` } : {}),
      select: "id,document_file_id,chunk_index,source_type,source_label,text,metadata",
      order: "chunk_index.asc",
      limit: String(limit),
      ...(offset ? { offset: String(offset) } : {})
    },
    signal
  }), signal);
}

export async function listDocumentPages(client, userId, documentFileId, { limit = 40, pageStart = null, pageEnd = null, allowUnready = false, signal } = {}) {
  const read = () => client.request("document_pages", {
    query: {
      user_id: `eq.${userId}`,
      document_file_id: `eq.${documentFileId}`,
      ...(pageStart ? { page_number: `gte.${pageStart}` } : {}),
      ...(pageEnd ? { and: `(page_number.lte.${pageEnd})` } : {}),
      select: "id,document_file_id,page_number,source_label,image_key,image_content_type,width_px,height_px,text,metadata",
      order: "page_number.asc",
      limit: String(limit)
    },
    signal
  });
  // Storage cleanup must also be able to remove failed or partially-ingested uploads.
  return allowUnready ? read() : readDocumentContent(client, userId, [documentFileId], read, signal);
}

export async function listDocumentPagesByNumbers(client, userId, documentFileId, pageNumbers = [], { signal } = {}) {
  const numbers = [...new Set(pageNumbers.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
  if (!numbers.length) return [];
  return readDocumentContent(client, userId, [documentFileId], () => client.request("document_pages", {
    query: {
      user_id: `eq.${userId}`,
      document_file_id: `eq.${documentFileId}`,
      page_number: `in.(${numbers.join(",")})`,
      select: "id,document_file_id,page_number,source_label,image_key,image_content_type,width_px,height_px,text,metadata",
      order: "page_number.asc"
    },
    signal
  }), signal);
}

export async function updateDocumentPage(client, userId, documentFileId, pageNumber, patch, { signal } = {}) {
  const rows = await client.request("document_pages", {
    method: "PATCH",
    query: {
      user_id: `eq.${userId}`,
      document_file_id: `eq.${documentFileId}`,
      page_number: `eq.${Number(pageNumber)}`
    },
    body: patch,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function deleteDocumentPages(client, userId, documentFileId, { signal } = {}) {
  return client.request("document_pages", {
    method: "DELETE",
    query: { user_id: `eq.${userId}`, document_file_id: `eq.${documentFileId}` },
    prefer: "return=minimal",
    signal
  });
}

export async function searchDocumentChunks(client, { userId, documentFileIds = [], query = "", limit = 5 }, { signal } = {}) {
  return readDocumentContent(client, userId, documentFileIds, () => client.rpc("klui_search_document_chunks", {
    p_user_id: userId,
    p_document_ids: documentFileIds,
    p_query: query,
    p_limit: limit
  }, { signal }), signal);
}

/** Replace a document's text with new units (the editor saved new content). */
export async function replaceDocumentChunks(client, userId, documentFileId, chunks = [], { signal } = {}) {
  const rows = chunks.map((chunk, index) => ({
    user_id: userId,
    document_file_id: documentFileId,
    chunk_index: index,
    source_type: chunk.source_type || "section",
    source_label: chunk.source_label || `Part ${index + 1}`,
    text: String(chunk.text || ""),
    char_count: String(chunk.text || "").length,
    token_estimate: Math.ceil(String(chunk.text || "").length / 4),
    metadata: chunk.metadata || {}
  }));
  if (rows.length) {
    await client.request("document_chunks", {
      method: "POST",
      query: { on_conflict: "document_file_id,chunk_index" },
      body: rows,
      prefer: "resolution=merge-duplicates,return=minimal",
      signal
    });
  }
  await client.request("document_chunks", {
    method: "DELETE",
    query: { user_id: `eq.${userId}`, document_file_id: `eq.${documentFileId}`, chunk_index: `gte.${rows.length}` },
    prefer: "return=minimal",
    signal
  });
}

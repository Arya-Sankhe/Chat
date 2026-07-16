import { single } from "./helpers.js";

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

export async function listDocumentChunksForFiles(client, userId, documentFileIds = [], { limit = 5000, signal } = {}) {
  const ids = [...new Set(documentFileIds.filter(Boolean))];
  if (!ids.length) return [];
  return client.request("document_chunks", {
    query: {
      user_id: `eq.${userId}`,
      document_file_id: `in.(${ids.join(",")})`,
      select: "document_file_id,chunk_index,source_type,source_label,text,token_estimate,metadata",
      order: "document_file_id.asc,chunk_index.asc",
      limit: String(limit)
    },
    signal
  });
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
  limits = {},
  projectId = null,
  projectMaxBytes = null
}, { signal } = {}) {
  return client.rpc("klui_complete_document_upload", {
    p_user_id: userId,
    p_attachment_id: attachmentId,
    p_size_bytes: sizeBytes,
    p_etag: etag,
    p_kind: kind,
    p_limits: limits,
    p_project_id: projectId,
    p_project_max_bytes: projectMaxBytes
  }, { signal });
}

export async function getDocumentJob(client, userId, jobId, { signal } = {}) {
  const rows = await client.request("document_jobs", {
    query: { id: `eq.${jobId}`, user_id: `eq.${userId}`, select: "*", limit: "1" },
    signal
  });
  return single(rows);
}

export async function listDocumentChunks(client, userId, documentFileId, { limit = 20, sourceType = "", sheet = "", signal } = {}) {
  return client.request("document_chunks", {
    query: {
      user_id: `eq.${userId}`,
      document_file_id: `eq.${documentFileId}`,
      ...(sourceType ? { source_type: `eq.${sourceType}` } : {}),
      ...(sheet ? { "metadata->>sheet": `eq.${sheet}` } : {}),
      select: "id,document_file_id,chunk_index,source_type,source_label,text,metadata",
      order: "chunk_index.asc",
      limit: String(limit)
    },
    signal
  });
}

export async function listDocumentPages(client, userId, documentFileId, { limit = 40, pageStart = null, pageEnd = null, signal } = {}) {
  return client.request("document_pages", {
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
}

export async function listDocumentPagesByNumbers(client, userId, documentFileId, pageNumbers = [], { signal } = {}) {
  const numbers = [...new Set(pageNumbers.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
  if (!numbers.length) return [];
  return client.request("document_pages", {
    query: {
      user_id: `eq.${userId}`,
      document_file_id: `eq.${documentFileId}`,
      page_number: `in.(${numbers.join(",")})`,
      select: "id,document_file_id,page_number,source_label,image_key,image_content_type,width_px,height_px,text,metadata",
      order: "page_number.asc"
    },
    signal
  });
}

export async function queueDocumentPageRender(client, {
  userId,
  documentFileId,
  pageNumber
}, { signal } = {}) {
  return client.rpc("klui_queue_document_page_render", {
    p_user_id: userId,
    p_document_file_id: documentFileId,
    p_page_number: pageNumber
  }, { signal });
}

export async function searchDocumentPages(client, { userId, documentFileIds = [], queryEmbedding = "", limit = 8 }, { signal } = {}) {
  return client.rpc("klui_search_document_pages", {
    p_user_id: userId,
    p_document_ids: documentFileIds,
    p_query_embedding: queryEmbedding,
    p_limit: limit
  }, { signal });
}

export async function searchDocumentChunks(client, { userId, documentFileIds = [], query = "", limit = 5 }, { signal } = {}) {
  return client.rpc("klui_search_document_chunks", {
    p_user_id: userId,
    p_document_ids: documentFileIds,
    p_query: query,
    p_limit: limit
  }, { signal });
}

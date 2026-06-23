async function readProblem(response) {
  try {
    const json = await response.json();
    return json.error || "Request failed.";
  } catch {
    return response.statusText || "Request failed.";
  }
}

function apiHeaders(session, extra = {}) {
  return {
    ...extra,
    ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {})
  };
}

const authRuntime = {
  getSession: null,
  refresh: null,
  onSession: null,
  onExpired: null
};

export function configureApiAuth({ getSession, refresh, onSession, onExpired } = {}) {
  authRuntime.getSession = typeof getSession === "function" ? getSession : null;
  authRuntime.refresh = typeof refresh === "function" ? refresh : null;
  authRuntime.onSession = typeof onSession === "function" ? onSession : null;
  authRuntime.onExpired = typeof onExpired === "function" ? onExpired : null;
}

async function resolveSession(session, { force = false } = {}) {
  const current = authRuntime.getSession?.() || session;
  if (!current?.access_token || !authRuntime.refresh) return current;
  const next = await authRuntime.refresh(current, { force });
  if (next?.access_token) {
    if (next !== current) authRuntime.onSession?.(next);
    return next;
  }
  authRuntime.onExpired?.();
  return null;
}

async function apiFetch(path, { session, headers, retryOnUnauthorized = true, ...options } = {}) {
  let activeSession = await resolveSession(session);
  let response = await fetch(apiUrl(path), {
    ...options,
    headers: apiHeaders(activeSession, headers)
  });

  if (response.status === 401 && retryOnUnauthorized && activeSession?.refresh_token && !options.signal?.aborted) {
    activeSession = await resolveSession(activeSession, { force: true });
    if (activeSession?.access_token) {
      response = await fetch(apiUrl(path), {
        ...options,
        headers: apiHeaders(activeSession, headers)
      });
    }
  }

  return response;
}

export async function fetchConfig() {
  const response = await fetch(apiUrl("/api/config"));
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchPlans() {
  const response = await fetch(apiUrl("/api/plans"));
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function createZiinaPaymentRequest(session, planId) {
  const response = await apiFetch("/api/payments/ziina", {
    session,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ planId })
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchZiinaPaymentRequests(session) {
  const response = await apiFetch("/api/payments/ziina", { session });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function approveAdminPayment(session, id) {
  const response = await apiFetch(`/api/admin/payments/${encodeURIComponent(id)}/approve`, {
    session,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function rejectAdminPayment(session, id) {
  const response = await apiFetch(`/api/admin/payments/${encodeURIComponent(id)}/reject`, {
    session,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchMe(session) {
  const response = await apiFetch("/api/me", { session });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchModels(session) {
  const response = await apiFetch("/api/models", { session });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function listConversations(session) {
  const response = await apiFetch("/api/conversations", { session });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function createConversation(session, body = {}) {
  const response = await apiFetch("/api/conversations", {
    session,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchConversation(session, id) {
  const response = await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, { session });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function deleteConversation(session, id) {
  const response = await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, {
    session,
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function updateConversation(session, id, body) {
  const response = await apiFetch(`/api/conversations/${encodeURIComponent(id)}`, {
    session,
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

function uploadCategory(file) {
  return String(file.type || "").startsWith("image/") ? "image" : "document";
}

export async function presignUpload(session, file, category = uploadCategory(file), { signal } = {}) {
  const response = await apiFetch("/api/uploads/presign", {
    session,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      category
    }),
    signal
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function completeUpload(session, uploadId, { signal } = {}) {
  const response = await apiFetch("/api/uploads/complete", {
    session,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uploadId }),
    signal
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

async function relayUploadContent(session, uploadId, file, category, { signal } = {}) {
  const response = await apiFetch(`/api/uploads/${encodeURIComponent(uploadId)}/content`, {
    session,
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
    signal
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function putUploadContent(session, upload, file, category = upload.category || uploadCategory(file), { signal } = {}) {
  try {
    const put = await fetch(upload.uploadUrl, {
      method: upload.method || "PUT",
      headers: {
        ...(upload.headers || {}),
        "content-type": file.type || "application/octet-stream"
      },
      body: file,
      signal
    });
    if (put.ok) return { mode: "direct" };
  } catch {
    // Browser-side R2 CORS failures surface as network errors. Fall back to
    // the same-origin upload relay so the user can keep working.
  }

  await relayUploadContent(session, upload.uploadId, file, category, { signal });
  return { mode: "relay" };
}

export async function uploadImage(session, file, { signal } = {}) {
  const upload = await presignUpload(session, file, "image", { signal });
  await putUploadContent(session, upload, file, "image", { signal });
  return completeUpload(session, upload.uploadId, { signal });
}

export async function uploadFile(session, file, { signal } = {}) {
  const category = uploadCategory(file);
  const upload = await presignUpload(session, file, category, { signal });
  await putUploadContent(session, upload, file, category, { signal });
  return completeUpload(session, upload.uploadId, { signal });
}

export async function fetchDocumentStatus(session, attachmentId) {
  const response = await apiFetch(`/api/documents/${encodeURIComponent(attachmentId)}/status`, { session });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function deleteAttachment(session, attachmentId) {
  const response = await apiFetch(`/api/attachments/${encodeURIComponent(attachmentId)}`, {
    session,
    method: "DELETE"
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchDocumentJobStatus(session, jobId) {
  const response = await apiFetch(`/api/documents/jobs/${encodeURIComponent(jobId)}/status`, { session });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchAttachmentView(session, attachmentId) {
  const response = await apiFetch(`/api/attachments/${encodeURIComponent(attachmentId)}/view`, {
    session,
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

/**
 * Authenticated download: ask the API for a short-lived signed URL and
 * navigate to it. The presigned URL carries its own auth in the query
 * string, so the browser doesn't need the Bearer token.
 */
export async function downloadAttachment(session, attachmentId, fileName = "download") {
  const response = await apiFetch(`/api/attachments/${encodeURIComponent(attachmentId)}/download?json=1`, {
    session,
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error(await readProblem(response));

  const payload = await response.json();
  const url = payload?.url;
  if (!url) throw new Error("Download URL was not returned.");

  await platformDownload(url, payload.fileName || fileName);
}

async function readSseStream(response, onEvent) {
  if (!response.body) throw new Error("Streaming is not available in this browser.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (!data) continue;
      if (data === "[DONE]") return;
      onEvent(JSON.parse(data));
    }
  }
}

export async function streamConversationMessage(session, conversationId, payload, { signal, onEvent }) {
  const response = await apiFetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    session,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) throw new Error(await readProblem(response));
  return readSseStream(response, onEvent);
}

export async function streamCompareConversationMessage(session, conversationId, payload, { signal, onEvent }) {
  return streamConversationMessage(session, conversationId, payload, { signal, onEvent });
}

export async function streamTemporaryChat(session, payload, { signal, onEvent }) {
  const response = await apiFetch("/api/temporary-chat", {
    session,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) throw new Error(await readProblem(response));
  return readSseStream(response, onEvent);
}

export async function fetchAdminSummary(session) {
  const response = await apiFetch("/api/admin/summary", { session });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}
import { apiUrl, download as platformDownload } from "./platform/index.js";

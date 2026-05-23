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

export async function fetchConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchPlans() {
  const response = await fetch("/api/plans");
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchMe(session) {
  const response = await fetch("/api/me", { headers: apiHeaders(session) });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchModels(session) {
  const response = await fetch("/api/models", { headers: apiHeaders(session) });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function listConversations(session) {
  const response = await fetch("/api/conversations", { headers: apiHeaders(session) });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function createConversation(session, body = {}) {
  const response = await fetch("/api/conversations", {
    method: "POST",
    headers: apiHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchConversation(session, id) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { headers: apiHeaders(session) });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function deleteConversation(session, id) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: apiHeaders(session)
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

function uploadCategory(file) {
  return String(file.type || "").startsWith("image/") ? "image" : "document";
}

export async function presignUpload(session, file, category = uploadCategory(file)) {
  const response = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: apiHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      category
    })
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function completeUpload(session, uploadId) {
  const response = await fetch("/api/uploads/complete", {
    method: "POST",
    headers: apiHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({ uploadId })
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function uploadImage(session, file) {
  const upload = await presignUpload(session, file, "image");
  const put = await fetch(upload.uploadUrl, {
    method: upload.method || "PUT",
    headers: { "content-type": file.type },
    body: file
  });
  if (!put.ok) throw new Error("Image upload failed.");
  return completeUpload(session, upload.uploadId);
}

export async function uploadFile(session, file) {
  const category = uploadCategory(file);
  const upload = await presignUpload(session, file, category);
  const put = await fetch(upload.uploadUrl, {
    method: upload.method || "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file
  });
  if (!put.ok) throw new Error(category === "image" ? "Image upload failed." : "Document upload failed.");
  return completeUpload(session, upload.uploadId);
}

export async function fetchDocumentStatus(session, attachmentId) {
  const response = await fetch(`/api/documents/${encodeURIComponent(attachmentId)}/status`, {
    headers: apiHeaders(session)
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchDocumentJobStatus(session, jobId) {
  const response = await fetch(`/api/documents/jobs/${encodeURIComponent(jobId)}/status`, {
    headers: apiHeaders(session)
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchAttachmentView(session, attachmentId) {
  const response = await fetch(`/api/attachments/${encodeURIComponent(attachmentId)}/view`, {
    headers: apiHeaders(session, { accept: "application/json" })
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
  const response = await fetch(`/api/attachments/${encodeURIComponent(attachmentId)}/download?json=1`, {
    headers: apiHeaders(session, { accept: "application/json" })
  });
  if (!response.ok) throw new Error(await readProblem(response));

  const payload = await response.json();
  const url = payload?.url;
  if (!url) throw new Error("Download URL was not returned.");

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = payload.fileName || fileName;
  anchor.rel = "noopener";
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function streamConversationMessage(session, conversationId, payload, { signal, onEvent }) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    headers: apiHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) throw new Error(await readProblem(response));
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

export async function streamCompareConversationMessage(session, conversationId, payload, { signal, onEvent }) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    headers: apiHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) throw new Error(await readProblem(response));
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

export async function fetchAdminSummary(session) {
  const response = await fetch("/api/admin/summary", { headers: apiHeaders(session) });
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

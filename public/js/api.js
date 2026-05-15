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

export async function presignUpload(session, file) {
  const response = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: apiHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size
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
  const upload = await presignUpload(session, file);
  const put = await fetch(upload.uploadUrl, {
    method: upload.method || "PUT",
    headers: { "content-type": file.type },
    body: file
  });
  if (!put.ok) throw new Error("Image upload failed.");
  return completeUpload(session, upload.uploadId);
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

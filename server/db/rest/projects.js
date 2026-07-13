import { single } from "./helpers.js";

export async function listProjects(client, userId, { signal } = {}) {
  return client.request("projects", {
    query: {
      user_id: `eq.${userId}`,
      select: "*",
      order: "updated_at.desc"
    },
    signal
  });
}

export async function createProject(client, userId, name, { signal } = {}) {
  const rows = await client.request("projects", {
    method: "POST",
    body: { user_id: userId, name },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function getProject(client, userId, projectId, { signal } = {}) {
  const rows = await client.request("projects", {
    query: { id: `eq.${projectId}`, user_id: `eq.${userId}`, select: "*", limit: "1" },
    signal
  });
  return single(rows);
}

export async function updateProject(client, userId, projectId, patch, { signal } = {}) {
  const rows = await client.request("projects", {
    method: "PATCH",
    query: { id: `eq.${projectId}`, user_id: `eq.${userId}` },
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function deleteProject(client, userId, projectId, { signal } = {}) {
  const rows = await client.request("projects", {
    method: "DELETE",
    query: { id: `eq.${projectId}`, user_id: `eq.${userId}` },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function listProjectAttachments(client, userId, projectId, { signal } = {}) {
  return client.request("attachments", {
    query: {
      user_id: `eq.${userId}`,
      project_id: `eq.${projectId}`,
      select: "id,project_id,object_key,category,file_name,content_type,size_bytes,etag,status,created_at",
      order: "created_at.asc"
    },
    signal
  });
}

export async function listProjectConversations(client, userId, projectId, { signal } = {}) {
  return client.request("conversations", {
    query: {
      user_id: `eq.${userId}`,
      project_id: `eq.${projectId}`,
      deleted_at: "is.null",
      select: "id,title,model,project_id,created_at,updated_at",
      order: "updated_at.desc"
    },
    signal
  });
}

export async function listProjectDocuments(client, userId, projectId, { signal } = {}) {
  return client.request("document_files", {
    query: {
      user_id: `eq.${userId}`,
      project_id: `eq.${projectId}`,
      select: "id,attachment_id,project_id,kind,processing_status,text_ready_at,visual_ready_at,page_count,word_count,sheet_count,created_at,attachments(id,file_name,content_type,size_bytes,status)",
      order: "created_at.asc"
    },
    signal
  });
}

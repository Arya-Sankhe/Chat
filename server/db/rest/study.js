import { single } from "./helpers.js";

const NOTE_SELECT = "id,user_id,project_id,document_file_id,kind,title,content,created_at";
const CARD_SELECT = "id,user_id,project_id,document_file_id,note_id,deck_key,front,back,starred,created_at";
const QUIZ_SELECT = "id,user_id,project_id,document_file_id,note_id,deck_key,title,questions,created_at";

export async function listStudyNotes(client, userId, projectId, { signal } = {}) {
  return client.request("study_notes", {
    query: {
      user_id: `eq.${userId}`,
      project_id: `eq.${projectId}`,
      select: NOTE_SELECT,
      order: "created_at.desc"
    },
    signal
  });
}

export async function getStudyNote(client, userId, id, { signal } = {}) {
  const rows = await client.request("study_notes", {
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, select: NOTE_SELECT, limit: "1" },
    signal
  });
  return single(rows);
}

export async function createStudyNote(client, userId, note, { signal } = {}) {
  const rows = await client.request("study_notes", {
    method: "POST",
    body: { ...note, user_id: userId },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function deleteStudyNote(client, userId, id, { signal } = {}) {
  const rows = await client.request("study_notes", {
    method: "DELETE",
    query: { id: `eq.${id}`, user_id: `eq.${userId}` },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function listStudyCards(client, userId, projectId, { select = CARD_SELECT, signal } = {}) {
  return client.request("study_cards", {
    query: {
      user_id: `eq.${userId}`,
      project_id: `eq.${projectId}`,
      select,
      order: "created_at.asc"
    },
    signal
  });
}

export async function getStudyCard(client, userId, id, { signal } = {}) {
  const rows = await client.request("study_cards", {
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, select: CARD_SELECT, limit: "1" },
    signal
  });
  return single(rows);
}

export async function createStudyCards(client, userId, cards, { signal } = {}) {
  const rows = Array.isArray(cards) ? cards.map((card) => ({ ...card, user_id: userId })) : [];
  if (!rows.length) return [];
  const created = await client.request("study_cards", {
    method: "POST",
    body: rows,
    prefer: "return=representation",
    signal
  });
  return Array.isArray(created) ? created : created ? [created] : [];
}

export async function deleteStudyCard(client, userId, id, { signal } = {}) {
  return client.request("study_cards", {
    method: "DELETE",
    query: { id: `eq.${id}`, user_id: `eq.${userId}` },
    prefer: "return=minimal",
    signal
  });
}

export async function updateStudyCard(client, userId, id, patch, { signal } = {}) {
  const rows = await client.request("study_cards", {
    method: "PATCH",
    query: { id: `eq.${id}`, user_id: `eq.${userId}` },
    body: patch,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function deleteStudyCardsForSource(client, userId, {
  projectId,
  documentFileId,
  noteId,
  manual,
  deckKey,
  signal
} = {}) {
  const query = { user_id: `eq.${userId}` };
  if (projectId) query.project_id = `eq.${projectId}`;
  if (deckKey) query.deck_key = `eq.${deckKey}`;
  else if (documentFileId) query.document_file_id = `eq.${documentFileId}`;
  else if (noteId) query.note_id = `eq.${noteId}`;
  else if (manual) {
    if (!projectId) return null;
    query.document_file_id = "is.null";
    query.note_id = "is.null";
    query.deck_key = "is.null";
  } else {
    return null;
  }
  return client.request("study_cards", {
    method: "DELETE",
    query,
    prefer: "return=minimal",
    signal
  });
}

export async function listStudyQuizzes(client, userId, projectId, { signal } = {}) {
  return client.request("study_quizzes", {
    query: {
      user_id: `eq.${userId}`,
      project_id: `eq.${projectId}`,
      select: QUIZ_SELECT,
      order: "created_at.desc"
    },
    signal
  });
}

export async function getStudyQuiz(client, userId, id, { signal } = {}) {
  const rows = await client.request("study_quizzes", {
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, select: QUIZ_SELECT, limit: "1" },
    signal
  });
  return single(rows);
}

export async function createStudyQuiz(client, userId, quiz, { signal } = {}) {
  const rows = await client.request("study_quizzes", {
    method: "POST",
    body: { ...quiz, user_id: userId },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}



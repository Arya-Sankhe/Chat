import { single } from "./helpers.js";

const NOTE_SELECT = "id,user_id,project_id,document_file_id,kind,title,content,created_at";
const CARD_SELECT = "id,user_id,project_id,document_file_id,note_id,deck_key,front,back,starred,sources,created_at";
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
  } else {
    return null;
  }
  if (!deckKey) query.deck_key = "is.null";
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

export async function updateStudyQuiz(client, userId, id, patch, { signal } = {}) {
  const rows = await client.request("study_quizzes", {
    method: "PATCH",
    query: { id: `eq.${id}`, user_id: `eq.${userId}` },
    body: patch,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function deleteStudyQuiz(client, userId, id, { signal } = {}) {
  return client.request("study_quizzes", {
    method: "DELETE",
    query: { id: `eq.${id}`, user_id: `eq.${userId}` },
    prefer: "return=minimal",
    signal
  });
}


const PODCAST_LIST_SELECT = "id,project_id,title,style,length,duration_seconds,created_at";
const PODCAST_SELECT = "id,user_id,project_id,attachment_id,title,style,length,voices,transcript,duration_seconds,created_at";

export async function listStudyPodcasts(client, userId, projectId, { signal } = {}) {
  return client.request("study_podcasts", {
    query: {
      user_id: `eq.${userId}`,
      project_id: `eq.${projectId}`,
      select: PODCAST_LIST_SELECT,
      order: "created_at.desc"
    },
    signal
  });
}

export async function getStudyPodcast(client, userId, id, { signal } = {}) {
  const rows = await client.request("study_podcasts", {
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, select: PODCAST_SELECT, limit: "1" },
    signal
  });
  return single(rows);
}

export async function createStudyPodcast(client, userId, podcast, { signal } = {}) {
  const rows = await client.request("study_podcasts", {
    method: "POST",
    body: { ...podcast, user_id: userId },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function updateStudyPodcast(client, userId, id, patch, { signal } = {}) {
  const rows = await client.request("study_podcasts", {
    method: "PATCH",
    query: { id: `eq.${id}`, user_id: `eq.${userId}` },
    body: patch,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

const TUTOR_LIST_SELECT = "id,project_id,title,style,voice,status,active_seconds,created_at";

export async function listStudyTutorSessions(client, userId, projectId, { signal } = {}) {
  return client.request("study_tutor_sessions", {
    query: {
      user_id: `eq.${userId}`,
      project_id: `eq.${projectId}`,
      select: TUTOR_LIST_SELECT,
      order: "created_at.desc"
    },
    signal
  });
}

export async function getStudyTutorSession(client, userId, id, { signal } = {}) {
  const rows = await client.request("study_tutor_sessions", {
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, select: "*", limit: "1" },
    signal
  });
  return single(rows);
}

export async function createStudyTutorSession(client, userId, session, { signal } = {}) {
  const rows = await client.request("study_tutor_sessions", {
    method: "POST",
    body: { ...session, user_id: userId },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function updateStudyTutorSession(client, userId, id, patch, { signal } = {}) {
  const rows = await client.request("study_tutor_sessions", {
    method: "PATCH",
    query: { id: `eq.${id}`, user_id: `eq.${userId}` },
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function deleteStudyTutorSession(client, userId, id, { signal } = {}) {
  return client.request("study_tutor_sessions", {
    method: "DELETE",
    query: { id: `eq.${id}`, user_id: `eq.${userId}` },
    prefer: "return=minimal",
    signal
  });
}

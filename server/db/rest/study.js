import { single } from "./helpers.js";

const NOTE_SELECT = "id,user_id,project_id,document_file_id,kind,title,content,created_at";
const CARD_SELECT = "id,user_id,project_id,document_file_id,note_id,front,back,state,difficulty,stability,reps,lapses,due_at,last_reviewed_at,created_at";
const QUIZ_SELECT = "id,user_id,project_id,document_file_id,note_id,title,questions,created_at";
const ATTEMPT_SELECT = "id,user_id,quiz_id,answers,score,total,created_at";

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

export async function listDueStudyCards(client, userId, projectId, nowIso, limit = 100, { signal } = {}) {
  return client.request("study_cards", {
    query: {
      user_id: `eq.${userId}`,
      project_id: `eq.${projectId}`,
      due_at: `lte.${nowIso}`,
      select: CARD_SELECT,
      order: "due_at.asc",
      limit: String(limit)
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

export async function deleteStudyCardsForSource(client, userId, { documentFileId, noteId, signal } = {}) {
  const query = { user_id: `eq.${userId}` };
  if (documentFileId) query.document_file_id = `eq.${documentFileId}`;
  else if (noteId) query.note_id = `eq.${noteId}`;
  else return null;
  return client.request("study_cards", {
    method: "DELETE",
    query,
    prefer: "return=minimal",
    signal
  });
}

export async function createStudyReview(client, userId, review, { signal } = {}) {
  const rows = await client.request("study_reviews", {
    method: "POST",
    body: { ...review, user_id: userId },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function listRecentStudyReviewDates(client, userId, { signal } = {}) {
  return client.request("study_reviews", {
    query: {
      user_id: `eq.${userId}`,
      select: "reviewed_at",
      order: "reviewed_at.desc",
      limit: "500"
    },
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

export async function createStudyQuizAttempt(client, userId, attempt, { signal } = {}) {
  const rows = await client.request("study_quiz_attempts", {
    method: "POST",
    body: { ...attempt, user_id: userId },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function listStudyQuizAttempts(client, userId, { projectId, quizId, signal } = {}) {
  if (quizId) {
    return client.request("study_quiz_attempts", {
      query: {
        user_id: `eq.${userId}`,
        quiz_id: `eq.${quizId}`,
        select: ATTEMPT_SELECT,
        order: "created_at.desc"
      },
      signal
    });
  }
  if (projectId) {
    return client.request("study_quiz_attempts", {
      query: {
        user_id: `eq.${userId}`,
        select: `${ATTEMPT_SELECT},study_quizzes!inner(project_id,title)`,
        "study_quizzes.project_id": `eq.${projectId}`,
        order: "created_at.desc"
      },
      signal
    });
  }
  return client.request("study_quiz_attempts", {
    query: {
      user_id: `eq.${userId}`,
      select: ATTEMPT_SELECT,
      order: "created_at.desc"
    },
    signal
  });
}

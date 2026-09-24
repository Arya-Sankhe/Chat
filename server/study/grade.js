import { streamComplete } from "./generate.js";

const MARK_MS = 60_000;
const WRITTEN_CAP = 4000;
const STOP_WORDS = new Set("a an and are as at be because but by can do does for from has have how in into is it its of on or so than that the their them then there these they this to was were what when which while who why will with you your".split(" "));

// Marks live on each question; older tests without them fall back to a sensible default.
export function questionMarks(question) {
  const marks = Number(question?.marks);
  if (Number.isInteger(marks) && marks >= 1 && marks <= 5) return marks;
  return question?.type === "short" ? 3 : 1;
}

function keyTerms(text) {
  return new Set(String(text || "").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length > 2 && !STOP_WORDS.has(word)) || []);
}

// Used only when the AI marker is unavailable: credit the share of model-answer key terms the student used.
export function estimateWrittenMarks(written, modelAnswer, marks) {
  const expected = keyTerms(modelAnswer);
  if (!expected.size) return 0;
  const given = keyTerms(written);
  let hits = 0;
  for (const word of expected) if (given.has(word)) hits += 1;
  return Math.max(0, Math.min(marks, Math.round((hits / expected.size) * marks * 1.4)));
}

function topicOf(question, index) {
  return String(question.topic || "").trim() || `Question ${index + 1}`;
}

function unique(list) {
  return [...new Set(list)];
}

// Encouraging summary built from topic results, for when the AI marker cannot run.
export function fallbackSummary(questions, results) {
  const strong = [];
  const growing = [];
  results.forEach((row, index) => {
    const topic = topicOf(questions[index], index);
    if (row.earned === row.marks) strong.push(topic);
    else growing.push(topic);
  });
  const strengths = unique(strong).slice(0, 3).map(topic => `Clear understanding of ${topic}.`);
  const growth = unique(growing).slice(0, 3).map(topic => `Build more confidence with ${topic}.`);
  const next = growing.length
    ? [`Revisit ${unique(growing).slice(0, 2).join(" and ")} in your notes, then retake the test.`, "Add the questions you want to remember to your flashcards."]
    : ["Try a harder practice test to stretch yourself.", "Teach one of these ideas out loud to lock it in."];
  return {
    headline: growing.length ? "Good effort — here's where to focus next." : "Excellent work — every mark earned.",
    strengths: strengths.length ? strengths : ["You worked through the whole test — that's how progress starts."],
    growth: growth.length ? growth : ["Keep this level up by mixing in harder questions."],
    next
  };
}

function cleanList(value, fallback) {
  const list = (Array.isArray(value) ? value : [])
    .map(item => String(item || "").replace(/\s+/g, " ").trim().slice(0, 240))
    .filter(Boolean)
    .slice(0, 4);
  return list.length ? list : fallback;
}

function parseMarkerJson(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const MARKER_SYSTEM = `You are a warm, encouraging teacher marking a student's practice test. Return ONLY valid JSON, no markdown:
{"written":[{"index":0,"earned":0,"feedback":"..."}],"headline":"...","strengths":["..."],"growth":["..."],"next":["..."]}
Marking rules for written answers: award whole marks from 0 to that question's marks, one mark per key point from the model answer that the student expressed, in any wording. Accept correct paraphrases and extra correct detail. Give "feedback" in one or two short sentences: first what they did well, then the specific idea that would earn the remaining marks.
Summary rules: "headline" is one short, upbeat sentence about the result. "strengths" lists 2-4 specific concepts the student clearly understands. "growth" lists 1-3 specific concepts to strengthen, phrased as opportunities. "next" lists 2-3 concrete study actions (what to revise or practise next). Each item under 22 words and names real concepts from the test.
Tone: always supportive and motivating. Never use negative words such as wrong, bad, poor, weak, failed, incorrect, or mistake; describe gaps as ideas to build on.`;

function markerPrompt(questions, results, answers) {
  const items = questions.map((question, index) => {
    const row = results[index];
    const base = { index, type: question.type === "short" ? "written" : "multiple_choice", topic: topicOf(question, index), marks: row.marks, question: question.q };
    if (question.type === "short") {
      return { ...base, modelAnswer: question.choices?.[0] || "", studentAnswer: row.status === "skipped" ? "(not answered)" : answers[index] };
    }
    return {
      ...base,
      correctAnswer: question.choices?.[row.answer] || "",
      studentAnswer: row.yourAnswer >= 0 ? question.choices?.[row.yourAnswer] || "" : "(not answered)",
      earned: row.earned
    };
  });
  return `Mark the written answers that were attempted, then summarise the whole test.\n${JSON.stringify(items)}`;
}

export async function gradeQuizAttempt({ context, config, quiz, submitted, signal, complete = streamComplete }) {
  const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
  const answers = questions.map((question, index) => {
    const value = submitted[index];
    if (question.type === "short") return typeof value === "string" ? value.trim().slice(0, WRITTEN_CAP) : "";
    const pick = Number(value);
    return Number.isInteger(pick) && pick >= 0 && pick < (question.choices?.length || 0) ? pick : -1;
  });
  const results = questions.map((question, index) => {
    const marks = questionMarks(question);
    const answer = Number(question.answer);
    const explanation = String(question.explanation || "");
    if (question.type === "short") {
      const written = answers[index];
      return { type: "short", marks, earned: 0, status: written ? "pending" : "skipped", answer, yourAnswer: written ? 0 : -1, explanation, feedback: "" };
    }
    const yourAnswer = answers[index];
    const correct = yourAnswer === answer;
    return { type: "mcq", marks, earned: correct ? marks : 0, status: correct ? "full" : yourAnswer < 0 ? "skipped" : "revisit", answer, yourAnswer, explanation, feedback: "" };
  });

  let marked = null;
  if (results.length) {
    const timeout = AbortSignal.timeout(MARK_MS);
    try {
      const reply = await complete({
        context,
        config,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        system: MARKER_SYSTEM,
        user: markerPrompt(questions, results, answers),
        maxTokens: 3000,
        expect: "json"
      });
      marked = parseMarkerJson(reply?.content);
    } catch (error) {
      if (signal?.aborted) throw error;
      marked = null;
    }
  }

  const byIndex = new Map((Array.isArray(marked?.written) ? marked.written : []).map(item => [Number(item?.index), item]));
  let estimated = false;
  results.forEach((row, index) => {
    if (row.status !== "pending") return;
    const ai = byIndex.get(index);
    const earned = Number(ai?.earned);
    if (Number.isFinite(earned)) {
      row.earned = Math.max(0, Math.min(row.marks, Math.round(earned)));
      row.feedback = String(ai.feedback || "").trim().slice(0, 400);
    } else {
      estimated = true;
      row.earned = estimateWrittenMarks(answers[index], questions[index].choices?.[0], row.marks);
    }
    row.status = row.earned === row.marks ? "full" : row.earned > 0 ? "partial" : "revisit";
  });
  for (const row of results) row.correct = row.earned === row.marks;

  const fallback = fallbackSummary(questions, results);
  const summary = marked
    ? {
      headline: String(marked.headline || "").trim().slice(0, 200) || fallback.headline,
      strengths: cleanList(marked.strengths, fallback.strengths),
      growth: cleanList(marked.growth, fallback.growth),
      next: cleanList(marked.next, fallback.next)
    }
    : fallback;
  return {
    score: results.reduce((sum, row) => sum + row.earned, 0),
    total: results.reduce((sum, row) => sum + row.marks, 0),
    results,
    summary,
    marker: marked && !estimated ? "ai" : "estimate"
  };
}

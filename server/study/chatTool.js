import { randomUUID } from "node:crypto";
import { generateFlashcards, generateQuiz, generateSummary } from "./generate.js";

export function buildStudyPreviewTool() {
  return {
    type: "function",
    function: {
      name: "create_study_preview",
      description: "Create an interactive, unsaved study preview inside this course chat. Select the correct course source by attachment_id, and pass page_number when the user specifies a page. Use for flashcards (basic, multiple-choice, or fill-in-the-blank), practice questions (mixed, short-answer, or multiple-choice), and mind maps. Do not call create_document for these.",
      parameters: {
        type: "object",
        properties: {
          attachment_id: { type: "string", description: "Exact attachment id of the course document." },
          page_number: { type: "integer", minimum: 1, description: "Exact PDF page or slide number, if requested." },
          type: { type: "string", enum: ["flashcards", "practice", "mindmap"] },
          format: { type: "string", enum: ["basic", "mcq", "cloze", "mixed", "short"], description: "Flashcards: basic/mcq/cloze. Practice: mixed/short/mcq." },
          count: { type: "integer", minimum: 1, maximum: 10, description: "Desired number of cards or questions, if specified; otherwise 7 flashcards or 5 questions." },
          focus: { type: "string", description: "The concept or task the user wants to study." }
        },
        required: ["attachment_id", "type"]
      }
    }
  };
}

export async function executeStudyPreviewTool({ toolCall, study, documents, signal }) {
  const args = JSON.parse(toolCall.function.arguments || "{}");
  const { context, config, course } = study;
  const type = args.type;
  if (!["flashcards", "practice", "mindmap"].includes(type)) throw new Error("Choose flashcards, practice, or mindmap.");
  const documentFile = await documents.requireDocumentByAttachment(args.attachment_id);
  if (documentFile.project_id !== course.id) throw new Error("Choose a document from this course.");
  const pageNumber = args.page_number == null ? null : Number(args.page_number);
  if (pageNumber != null && (!Number.isInteger(pageNumber) || pageNumber < 1)) throw new Error("Choose a valid page number.");
  const source = { documentFile };
  const common = { context, config, course, source, signal, preview: true, pageNumber, documents };
  const count = Math.min(10, Math.max(1, Number.isInteger(args.count) ? args.count : (type === "flashcards" ? 7 : 5)));
  const focus = String(args.focus || "").trim().slice(0, 1000);
  let artifact;
  if (type === "flashcards") {
    const cardType = ["basic", "mcq", "cloze"].includes(args.format) ? args.format : "basic";
    const cards = await generateFlashcards({ ...common, mode: "rapid", maxCards: count, options: { cardType, focus } });
    artifact = { type: "study_preview", kind: "flashcards", format: cardType, cards, count: cards.length };
  } else if (type === "practice") {
    const examType = ["mixed", "short", "mcq"].includes(args.format) ? args.format : "mixed";
    const { quiz } = await generateQuiz({ ...common, count, options: { examType, focus } });
    artifact = { type: "study_preview", kind: "practice", format: examType, questions: quiz.questions, count: quiz.questions.length };
  } else {
    const { note } = await generateSummary({ ...common, mode: "mindmap", options: { focus } });
    artifact = { type: "study_preview", kind: "mindmap", title: note.title, content: note.content, count: 1 };
  }
  artifact.id = randomUUID();
  artifact.course_id = course.id;
  artifact.document_file_id = documentFile.id;
  artifact.source = (Array.isArray(documentFile.attachments) ? documentFile.attachments[0] : documentFile.attachments)?.file_name || documentFile.file_name || "Course material";
  artifact.page = pageNumber;
  return {
    ok: true,
    name: "create_study_preview",
    provider: "study",
    query: focus || `${type} from ${artifact.source}`,
    citations: [],
    artifacts: [artifact],
    toolResultJson: JSON.stringify({ created: type, count: artifact.count, source: artifact.source, page: pageNumber, instruction: "The interactive preview is displayed in chat. Mention it briefly; do not repeat every card or map branch in prose. The user can save it to Create." })
  };
}

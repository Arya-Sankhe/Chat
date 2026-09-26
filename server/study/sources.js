import { HttpError } from "../http/responses.js";
import { readWebPage } from "../websearch/index.js";
import { deleteReservedUpload, mapStorageRpcError } from "../saas/storageQuota.js";

export const SOURCE_MAX_CHARS = 250_000;

export async function createCourseSource({ context, config, course, body, signal, readPage = readWebPage }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Provide a source object.");
  const kind = body.kind;
  if (!["text", "website"].includes(kind)) throw new HttpError(400, "Choose a website or pasted text.");
  let content = typeof body.text === "string" ? body.text.trim() : "";
  let title = typeof body.title === "string" ? body.title.trim() : "";
  let sourceUrl = "";
  if (title.length > 120) throw new HttpError(400, "Use a title of 120 characters or fewer.");
  if (kind === "website") {
    const input = typeof body.url === "string" ? body.url.trim() : "";
    if (!input || input.length > 4096) throw new HttpError(400, "Enter a website URL.");
    if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^https?:\/\//i.test(input)) {
      throw new HttpError(400, "Use an http or https website URL.");
    }
    let url;
    try { url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); }
    catch { throw new HttpError(400, "Enter a valid website URL."); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      throw new HttpError(400, "Use a public http or https URL without login details.");
    }
    if (/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(url.hostname)) {
      throw new HttpError(400, "YouTube sources are not supported.");
    }
    url.hash = "";
    sourceUrl = url.href;
    const page = await readPage({ url: sourceUrl, config, signal, timeoutMs: 45_000, maxChars: SOURCE_MAX_CHARS + 1 });
    content = String(page.content || "").trim();
    title ||= String(page.title || url.hostname).trim().slice(0, 120);
  }
  if (!content) throw new HttpError(400, kind === "website" ? "This page has no readable text. Try pasting its content instead." : "Paste some text to add a source.");
  if (content.includes("\0")) throw new HttpError(400, "Source contains unsupported null characters.");
  if (content.length > SOURCE_MAX_CHARS) {
    throw new HttpError(413, kind === "website"
      ? "This page is longer than 250,000 characters. Paste the section you need instead."
      : "Use a source of 250,000 characters or fewer. Split longer material into separate sources.");
  }
  title ||= content.split(/\r?\n/)[0].replace(/^#+\s*/, "").slice(0, 80) || "Pasted text";
  const fileName = `${title.replace(/[\\/\x00-\x1f]/g, " ").trim() || "Source"}.${kind === "website" ? "md" : "txt"}`;
  const contentType = kind === "website" ? "text/markdown" : "text/plain";
  const data = Buffer.from(content, "utf8");
  let attachment;
  try {
    attachment = await context.db.reserveAttachment({
      userId: context.user.id, maxBytes: context.plan.maxStorageBytes, category: "document",
      objectKey: context.r2.objectKey({ userId: context.user.id, fileName }),
      fileName, contentType, sizeBytes: data.length, projectId: course.id
    }, { signal });
    await context.r2.putObject(attachment.object_key, data, { contentType, signal });
    return await context.db.rpc("klui_complete_study_source", {
      p_user_id: context.user.id, p_attachment_id: attachment.id, p_project_id: course.id,
      p_kind: kind, p_title: title, p_content: content, p_source_url: sourceUrl,
      p_project_max_bytes: context.plan.maxProjectBytes
    }, { signal });
  } catch (error) {
    // Cleanup must still run if the browser disconnects during an import.
    if (attachment) await deleteReservedUpload(context, attachment).catch(() => {});
    if (String(error?.message || "").includes("project_storage_limit_exceeded")) {
      throw new HttpError(413, "This course is full. Remove sources to free up space.");
    }
    mapStorageRpcError(error);
  }
}

import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { api, API_ORIGIN, loadConfig, session } from "./runtime";

export type PickedFile = { uri: string; name: string; mimeType: string; size: number; category: "image" | "document" };

const directUpload = async (url: string, method: string, headers: Record<string, string>, file: PickedFile) => {
  const result = await FileSystem.uploadAsync(url, file.uri, {
    httpMethod: method as "PUT" | "POST",
    headers,
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT
  });
  return result.status >= 200 && result.status < 300;
};

const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  tsv: "text/tab-separated-values"
};

/** What the file picker may offer: the same files the web client takes. */
export const PICKABLE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", ...Object.values(DOCUMENT_TYPES), "text/comma-separated-values", "application/csv"];

/* Phones name some types their own way (Android's text/comma-separated-values); the server knows the standard ones. */
export function documentType(fileName: string, reported: string) {
  return DOCUMENT_TYPES[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? reported;
}

const MAX_IMAGE_EDGE = 2048;
const FORMATS: Record<string, SaveFormat> = { "image/jpeg": SaveFormat.JPEG, "image/png": SaveFormat.PNG, "image/webp": SaveFormat.WEBP };

const sizeOf = async (uri: string, fallback: number) => {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? info.size : fallback;
};

/* Big photos are made smaller here, as the web client does, keeping their format. */
async function fitImage(file: PickedFile, size: number): Promise<{ uri: string; size: number }> {
  if (file.category !== "image") return { uri: file.uri, size };
  const maxBytes = Number((await loadConfig())?.maxImageBytes) || 10 * 1024 * 1024;
  const megabytes = Math.floor(maxBytes / 1024 / 1024);
  const format = FORMATS[file.mimeType];
  if (!format) {
    if (size <= maxBytes) return { uri: file.uri, size };
    throw new Error(`This image must be ${megabytes}MB or smaller.`);
  }
  let image;
  try {
    image = await ImageManipulator.manipulate(file.uri).renderAsync();
  } catch (error) {
    // An image within the limit can still go up as-is; the server validates it.
    if (size <= maxBytes) return { uri: file.uri, size };
    throw new Error("The image could not be read.");
  }
  const longEdge = Math.max(image.width, image.height);
  let scale = Math.min(1, MAX_IMAGE_EDGE / longEdge);
  if (scale === 1 && size <= maxBytes) return { uri: file.uri, size };
  if (size * scale * scale > maxBytes) scale = Math.min(0.98, Math.sqrt(maxBytes / size) * 0.98);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const resized = await ImageManipulator.manipulate(file.uri).resize({ width: Math.max(1, Math.round(image.width * scale)) }).renderAsync();
    const saved = await resized.saveAsync({ format, compress: 0.9 });
    const savedSize = await sizeOf(saved.uri, 0);
    if (savedSize && savedSize <= maxBytes) return { uri: saved.uri, size: savedSize };
    scale *= Math.min(0.9, Math.sqrt(maxBytes / (savedSize || maxBytes * 2)) * 0.98);
  }
  throw new Error(`The image could not be reduced below ${megabytes}MB.`);
}

/* A document can't go with a message until the server has read it. */
export async function waitForDocument(attachmentId: string, stillWanted: () => boolean) {
  let failures = 0;
  while (stillWanted()) {
    let document;
    try {
      ({ document } = await api.fetchDocumentStatus(attachmentId));
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(10000, 1000 * 2 ** failures)));
      continue;
    }
    if (document?.usable) return;
    if (document?.status === "failed") throw new Error(document.error?.message || "Document could not be processed.");
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

/* Presign, send the bytes straight to storage (or through the API if that fails), complete.
   Resolves with the attachment the chat send refers to. */
export async function uploadPicked(file: PickedFile) {
  // The server holds us to the size we reserve; pickers can omit it or report the original's.
  const fitted = await fitImage(file, await sizeOf(file.uri, file.size));
  const upload = { ...file, uri: fitted.uri };
  const { uploadId, uploadUrl, method, headers } = await api.presignUpload({
    fileName: file.name,
    contentType: file.mimeType,
    sizeBytes: fitted.size,
    category: file.category
  });
  let sent = false;
  try {
    sent = await directUpload(uploadUrl, method || "PUT", headers || {}, upload);
  } catch {
    // Falls through to the relay.
  }
  if (!sent) {
    const token = (await session.ensureFresh())?.access_token || "";
    const relayed = await directUpload(
      `${API_ORIGIN}/api/uploads/${encodeURIComponent(uploadId)}/content`,
      "PUT",
      { "content-type": file.mimeType || "application/octet-stream", authorization: `Bearer ${token}` },
      upload
    );
    if (!relayed) throw new Error("The file could not be uploaded.");
  }
  return api.completeUpload(uploadId);
}

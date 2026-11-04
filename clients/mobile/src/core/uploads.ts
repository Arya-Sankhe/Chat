import * as FileSystem from "expo-file-system/legacy";
import { api, API_ORIGIN, session } from "./runtime";

export type PickedFile = { uri: string; name: string; mimeType: string; size: number; category: "image" | "document" };

const directUpload = async (url: string, method: string, headers: Record<string, string>, file: PickedFile) => {
  const result = await FileSystem.uploadAsync(url, file.uri, {
    httpMethod: method as "PUT" | "POST",
    headers,
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT
  });
  return result.status >= 200 && result.status < 300;
};

/* Presign, send the bytes straight to storage (or through the API if that fails), complete.
   Resolves with the attachment the chat send refers to. */
export async function uploadPicked(file: PickedFile) {
  // The server holds us to the size we reserve; pickers can omit it or report the original's.
  const info = await FileSystem.getInfoAsync(file.uri);
  const { uploadId, uploadUrl, method, headers } = await api.presignUpload({
    fileName: file.name,
    contentType: file.mimeType,
    sizeBytes: info.exists ? info.size : file.size,
    category: file.category
  });
  let sent = false;
  try {
    sent = await directUpload(uploadUrl, method || "PUT", headers || {}, file);
  } catch {
    // Falls through to the relay.
  }
  if (!sent) {
    const token = (await session.ensureFresh())?.access_token || "";
    const relayed = await directUpload(
      `${API_ORIGIN}/api/uploads/${encodeURIComponent(uploadId)}/content`,
      "PUT",
      { "content-type": file.mimeType || "application/octet-stream", authorization: `Bearer ${token}` },
      file
    );
    if (!relayed) throw new Error("The file could not be uploaded.");
  }
  return api.completeUpload(uploadId);
}

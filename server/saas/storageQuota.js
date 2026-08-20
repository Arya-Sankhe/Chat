import { HttpError } from "../http/responses.js";

export const STORAGE_EXHAUSTED_CODE = "storage_exhausted";
export const STORAGE_EXHAUSTED_MESSAGE = "Storage is full. Delete files to free up space.";
export const STORAGE_LIST_LIMIT = 200;

export function storageUsage(usedBytes, maxBytes) {
  const used = Math.max(0, Number(usedBytes) || 0);
  const max = Math.max(0, Number(maxBytes) || 0);
  return {
    usedBytes: used,
    maxBytes: max,
    percent: max > 0 ? Math.floor((used / max) * 100) : 0
  };
}

export function isStorageQuotaError(error) {
  const message = String(error?.message || error?.details?.message || "");
  return message.includes("account_storage_limit_exceeded")
    || message.includes("pending_storage_limit_exceeded")
    || error?.code === STORAGE_EXHAUSTED_CODE;
}

export function mapStorageRpcError(error) {
  if (isStorageQuotaError(error)) {
    throw new HttpError(413, STORAGE_EXHAUSTED_MESSAGE, { code: STORAGE_EXHAUSTED_CODE });
  }
  throw error;
}

export async function deleteReservedUpload(context, attachment, { signal } = {}) {
  if (!attachment?.id) return;
  const keys = [attachment.object_key].filter(Boolean);
  if (keys.length) await context.r2.deleteObjects(keys, { signal });
  await context.db.deleteAttachment(context.user.id, attachment.id, { signal });
}

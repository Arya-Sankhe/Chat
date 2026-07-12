import { randomUUID } from "node:crypto";
import { HttpError } from "../http/responses.js";

export const PENDING_TURN_LEASE_SECONDS = 120;
export const PENDING_TURN_HEARTBEAT_MS = 30_000;
const DOCUMENT_POLL_MS = 750;

function abortError() {
  const error = new Error("The request was aborted.");
  error.name = "AbortError";
  return error;
}

export function documentHasUsableCapability(documentFile) {
  return Boolean(documentFile?.text_ready_at || documentFile?.visual_ready_at);
}

export function documentCapabilityView(documentFile) {
  return {
    id: documentFile?.id || "",
    attachmentId: documentFile?.attachment_id || "",
    status: documentFile?.processing_status || "pending",
    textReady: Boolean(documentFile?.text_ready_at),
    visualReady: Boolean(documentFile?.visual_ready_at),
    enriched: Boolean(documentFile?.enriched_at),
    progress: Number(documentFile?.metadata?.progress || 0) || 0,
    stage: documentFile?.metadata?.stage || "",
    error: documentFile?.error || null
  };
}

async function sleep(ms, signal) {
  if (signal?.aborted) throw abortError();
  await new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForDocumentCapabilities({
  db,
  userId,
  attachmentIds,
  signal,
  onProgress
}) {
  const ids = [...new Set((attachmentIds || []).filter(Boolean))];
  if (!ids.length) return [];

  let lastProgress = "";
  while (true) {
    if (signal?.aborted) throw abortError();
    const docs = await db.listDocumentFilesByAttachments(userId, ids, { signal });
    const byAttachment = new Map((docs || []).map((doc) => [doc.attachment_id, doc]));
    if (byAttachment.size !== ids.length) {
      throw new HttpError(400, "One of the selected documents is unavailable.");
    }

    const views = ids.map((id) => documentCapabilityView(byAttachment.get(id)));
    const failed = ids
      .map((id) => byAttachment.get(id))
      .find((doc) => doc?.processing_status === "failed" && !documentHasUsableCapability(doc));
    if (failed) {
      throw new HttpError(422, failed.error?.message || "Document processing failed.", failed.error || undefined);
    }
    if (ids.every((id) => documentHasUsableCapability(byAttachment.get(id)))) {
      return ids.map((id) => byAttachment.get(id));
    }

    const serialized = JSON.stringify(views);
    if (serialized !== lastProgress) {
      lastProgress = serialized;
      onProgress?.(views);
    }
    await sleep(DOCUMENT_POLL_MS, signal);
  }
}

export function pendingTurnConnectionId() {
  return `chat-${randomUUID()}`;
}

export function pendingTurnIsOwnedBy(run, claimedBy) {
  return Boolean(
    run?.status === "running"
    && run?.claimed_by === claimedBy
    && run?.claim_token
  );
}

export function startPendingTurnHeartbeat({ db, userId, run, controller }) {
  let stopped = false;
  let inFlight = false;
  let lastRenewedAt = Date.now();
  const abortBeforeExpiryMs = (PENDING_TURN_LEASE_SECONDS * 1000) - PENDING_TURN_HEARTBEAT_MS;

  const heartbeat = async () => {
    if (stopped || inFlight || controller?.signal?.aborted) return;
    inFlight = true;
    try {
      const renewed = await db.heartbeatPendingDocumentTurn({
        userId,
        turnId: run.id,
        claimToken: run.claim_token,
        leaseSeconds: PENDING_TURN_LEASE_SECONDS
      });
      if (!renewed) controller?.abort();
      else lastRenewedAt = Date.now();
    } catch {
      if (Date.now() - lastRenewedAt >= abortBeforeExpiryMs) controller?.abort();
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(heartbeat, PENDING_TURN_HEARTBEAT_MS);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function wrapProviderCallsWithTurnFence({ crofai, db, userId, run }) {
  if (!run?.claim_token) return crofai;
  let startedPromise = null;
  const markStarted = async () => {
    if (!startedPromise) {
      startedPromise = db.markPendingTurnProviderStarted({
        userId,
        turnId: run.id,
        claimToken: run.claim_token
      }).then((started) => {
        if (!started) throw new HttpError(409, "This turn is no longer claimable.");
        return started;
      });
    }
    return startedPromise;
  };

  return {
    ...crofai,
    async chatCompletion(...args) {
      await markStarted();
      return crofai.chatCompletion(...args);
    },
    async streamChatCompletion(...args) {
      await markStarted();
      return crofai.streamChatCompletion(...args);
    }
  };
}

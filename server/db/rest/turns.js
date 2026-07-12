import { single } from "./helpers.js";

export async function submitDocumentTurn(client, {
  userId,
  conversationId,
  clientTurnKey,
  mode,
  userContent,
  messageMetadata = {},
  requestPayload = {},
  attachmentIds = []
}, { signal } = {}) {
  return client.rpc("klui_submit_document_turn", {
    p_user_id: userId,
    p_conversation_id: conversationId,
    p_client_turn_key: clientTurnKey,
    p_mode: mode,
    p_user_content: userContent,
    p_message_metadata: messageMetadata,
    p_request_payload: requestPayload,
    p_attachment_ids: attachmentIds
  }, { signal });
}

export async function getPendingDocumentTurn(client, userId, turnId, { signal } = {}) {
  const rows = await client.request("pending_document_turns", {
    query: {
      id: `eq.${turnId}`,
      user_id: `eq.${userId}`,
      select: "*",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function listPendingDocumentTurns(client, userId, conversationId, { signal } = {}) {
  return client.request("pending_document_turns", {
    query: {
      user_id: `eq.${userId}`,
      conversation_id: `eq.${conversationId}`,
      status: "in.(waiting_documents,running)",
      select: "*",
      order: "created_at.asc"
    },
    signal
  });
}

export async function claimPendingDocumentTurn(client, {
  userId,
  turnId,
  claimedBy,
  leaseSeconds = 120
}, { signal } = {}) {
  return client.rpc("klui_claim_pending_document_turn", {
    p_user_id: userId,
    p_turn_id: turnId,
    p_claimed_by: claimedBy,
    p_lease_seconds: leaseSeconds
  }, { signal });
}

export async function heartbeatPendingDocumentTurn(client, {
  userId,
  turnId,
  claimToken,
  leaseSeconds = 120
}, { signal } = {}) {
  return client.rpc("klui_heartbeat_pending_document_turn", {
    p_user_id: userId,
    p_turn_id: turnId,
    p_claim_token: claimToken,
    p_lease_seconds: leaseSeconds
  }, { signal });
}

export async function releasePendingDocumentTurn(client, {
  userId,
  turnId,
  claimToken
}, { signal } = {}) {
  return client.rpc("klui_release_pending_document_turn", {
    p_user_id: userId,
    p_turn_id: turnId,
    p_claim_token: claimToken
  }, { signal });
}

export async function markPendingTurnProviderStarted(client, {
  userId,
  turnId,
  claimToken
}, { signal } = {}) {
  return client.rpc("klui_mark_pending_turn_provider_started", {
    p_user_id: userId,
    p_turn_id: turnId,
    p_claim_token: claimToken
  }, { signal });
}

export async function finishPendingDocumentTurn(client, {
  userId,
  turnId,
  claimToken,
  status,
  error = null
}, { signal } = {}) {
  return client.rpc("klui_finish_pending_document_turn", {
    p_user_id: userId,
    p_turn_id: turnId,
    p_claim_token: claimToken,
    p_status: status,
    p_error: error
  }, { signal });
}

export async function cancelPendingDocumentTurn(client, userId, turnId, { signal } = {}) {
  return client.rpc("klui_cancel_pending_document_turn", {
    p_user_id: userId,
    p_turn_id: turnId
  }, { signal });
}

export async function upsertTurnOutputMessage(client, message, { signal } = {}) {
  const rows = await client.request("messages", {
    method: "POST",
    query: { on_conflict: "turn_run_id,output_slot" },
    body: message,
    prefer: "resolution=ignore-duplicates,return=representation",
    signal
  });
  const inserted = single(rows);
  if (inserted) return inserted;

  const existing = await client.request("messages", {
    query: {
      user_id: `eq.${message.user_id}`,
      turn_run_id: `eq.${message.turn_run_id}`,
      output_slot: `eq.${message.output_slot}`,
      select: "*",
      limit: "1"
    },
    signal
  });
  return single(existing);
}

export async function updatePendingTurnOutput(client, {
  userId,
  turnId,
  claimToken,
  messageId,
  patch
}, { signal } = {}) {
  return client.rpc("klui_update_pending_turn_output", {
    p_user_id: userId,
    p_turn_id: turnId,
    p_claim_token: claimToken,
    p_message_id: messageId,
    p_patch: patch
  }, { signal });
}

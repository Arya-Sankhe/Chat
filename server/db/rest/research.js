import { single } from "./helpers.js";

export async function createResearchRun(client, run, { signal } = {}) {
  const rows = await client.request("research_runs", {
    method: "POST",
    body: run,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function getResearchRun(client, userId, runId, { signal } = {}) {
  const rows = await client.request("research_runs", {
    query: { id: `eq.${runId}`, user_id: `eq.${userId}`, select: "*", limit: "1" },
    signal
  });
  return single(rows);
}

export async function listActiveResearchRuns(client, userId, { signal } = {}) {
  return client.request("research_runs", {
    query: {
      user_id: `eq.${userId}`,
      status: "in.(queued,running)",
      select: "*",
      order: "created_at.desc",
      limit: "2"
    },
    signal
  });
}

export async function updateResearchRun(client, runId, patch, { userId = "", workerId = "", status = "", signal } = {}) {
  const rows = await client.request("research_runs", {
    method: "PATCH",
    query: {
      id: `eq.${runId}`,
      ...(userId ? { user_id: `eq.${userId}` } : {}),
      ...(workerId ? { worker_id: `eq.${workerId}` } : {}),
      ...(status ? { status: `eq.${status}` } : {}),
    },
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function claimResearchRun(client, workerId, leaseSeconds = 120, { signal } = {}) {
  const rows = await client.rpc("klui_claim_research_run", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds
  }, { signal });
  return single(rows);
}

export async function failExpiredResearchRuns(client, { signal } = {}) {
  return client.request("research_runs", {
    method: "PATCH",
    query: {
      status: "eq.running",
      lease_until: `lt.${new Date().toISOString()}`
    },
    body: {
      status: "failed",
      phase: "failed",
      error: { reason: "worker_stopped", message: "Research stopped before it could finish." },
      finished_at: new Date().toISOString(),
      lease_until: null,
      updated_at: new Date().toISOString()
    },
    prefer: "return=representation",
    signal
  });
}

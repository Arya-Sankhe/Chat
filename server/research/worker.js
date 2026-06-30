import crypto from "node:crypto";
import { loadConfig } from "../config.js";
import { SupabaseRest } from "../db/supabaseRest.js";
import { getCurrentEntitlement } from "../saas/entitlements.js";
import { createCrofaiUsageMeter } from "../saas/usageMeter.js";
import { resolveProvider } from "../providers.js";
import { partialReport, runDeepResearch } from "./engine.js";

const config = loadConfig();
const db = new SupabaseRest(config);
const workerId = `research-${crypto.randomUUID()}`;
let stopping = false;
let lastExpiredCleanupAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leaseUntil() {
  return new Date(Date.now() + config.research.leaseSeconds * 1000).toISOString();
}

async function processRun(run) {
  const controller = new AbortController();
  let snapshot = { findings: "", sources: [] };
  let lastProgressAt = 0;
  let latestProgress = run.progress || {};
  let latestPhase = run.phase || "planning";

  const heartbeat = setInterval(async () => {
    try {
      const current = await db.getResearchRun(run.user_id, run.id);
      if (!current || current.cancel_requested) controller.abort();
      await db.updateResearchRun(run.id, {
        lease_until: leaseUntil(),
        phase: latestPhase,
        progress: latestProgress
      }, { workerId, status: "running" });
    } catch (error) {
      console.error("Research heartbeat failed", run.id, error?.message || error);
    }
  }, Math.max(5000, Math.min(15_000, Math.floor(config.research.leaseSeconds * 500))));

  try {
    const entitlement = await getCurrentEntitlement({
      db,
      userId: run.user_id,
      plans: config.plans,
      access: config.access,
      signal: controller.signal
    });
    if (!entitlement.active || !entitlement.plan) throw new Error("An active Klui plan is required.");

    const provider = resolveProvider(run.provider || "openrouter", config);
    const meter = createCrofaiUsageMeter({
      db,
      userId: run.user_id,
      subscription: entitlement.subscription,
      plan: entitlement.plan,
      signal: controller.signal
    });
    const callModel = ({ model, system, prompt, maxTokens = 2500, temperature = 0.2 }) => meter.chatCompletion({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      providerId: provider.id,
      signal: controller.signal,
      body: {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ],
        temperature,
        max_tokens: maxTokens
      }
    });

    const result = await runDeepResearch({
      run,
      config,
      callModel,
      signal: controller.signal,
      isCancelled: async () => {
        const current = await db.getResearchRun(run.user_id, run.id, { signal: controller.signal });
        return Boolean(current?.cancel_requested);
      },
      onSnapshot: (value) => { snapshot = value; },
      onProgress: async (phase, progress) => {
        latestPhase = phase;
        latestProgress = progress;
        const now = Date.now();
        if (now - lastProgressAt < 1900) return;
        lastProgressAt = now;
        await db.updateResearchRun(run.id, {
          phase,
          progress,
          lease_until: leaseUntil()
        }, { workerId, status: "running", signal: controller.signal });
      }
    });

    const finishedAt = new Date().toISOString();
    await db.updateResearchRun(run.id, {
      status: "succeeded",
      phase: "complete",
      progress: { label: "Research complete", percent: 100, sources: result.sources.length },
      title: result.title,
      summary: result.summary,
      report_markdown: result.report,
      sources: result.sources,
      elapsed_ms: result.elapsedMs,
      finished_at: finishedAt,
      lease_until: null
    }, { workerId, status: "running" });
    await db.updateMessage(run.user_id, run.assistant_message_id, {
      content: result.summary || result.title,
      finish_reason: "stop",
      metadata: {
        research: {
          runId: run.id,
          status: "succeeded",
          title: result.title,
          summary: result.summary,
          sourceCount: result.sources.length,
          elapsedMs: result.elapsedMs
        }
      }
    });
  } catch (error) {
    const current = await db.getResearchRun(run.user_id, run.id).catch(() => null);
    const cancelled = Boolean(current?.cancel_requested);
    const elapsedMs = Date.now() - new Date(run.started_at || run.created_at).getTime();
    const report = snapshot.findings
      ? partialReport(run.query, snapshot.findings, snapshot.sources, error?.message || "Research stopped before completion.")
      : "";
    await db.updateResearchRun(run.id, {
      status: cancelled ? "cancelled" : "failed",
      phase: cancelled ? "cancelled" : "failed",
      progress: { label: cancelled ? "Research cancelled" : "Research stopped", percent: 100 },
      report_markdown: report || null,
      sources: (snapshot.sources || []).map(({ text, ...source }) => source),
      error: cancelled ? null : { reason: error?.status === 429 ? "budget_exhausted" : "research_failed", message: error?.message || "Research failed." },
      elapsed_ms: elapsedMs,
      finished_at: new Date().toISOString(),
      lease_until: null
    }, { workerId, status: "running" }).catch(console.error);
    await db.updateMessage(run.user_id, run.assistant_message_id, {
      content: report ? "A partial research report is available." : "",
      error: cancelled ? "Research cancelled." : (error?.message || "Research failed."),
      finish_reason: cancelled ? "cancelled" : "error",
      metadata: {
        research: {
          runId: run.id,
          status: cancelled ? "cancelled" : "failed",
          partial: Boolean(report),
          sourceCount: snapshot.sources?.length || 0,
          elapsedMs
        }
      }
    }).catch(console.error);
  } finally {
    clearInterval(heartbeat);
  }
}

async function failExpiredRuns() {
  lastExpiredCleanupAt = Date.now();
  const expired = await db.failExpiredResearchRuns().catch((error) => {
    console.error("Expired research cleanup failed", error);
    return [];
  });
  for (const run of expired || []) {
    if (!run.assistant_message_id) continue;
    await db.updateMessage(run.user_id, run.assistant_message_id, {
      error: "Research stopped before it could finish.",
      finish_reason: "error",
      metadata: { research: { runId: run.id, status: "failed" } }
    }).catch(() => {});
  }
}

async function loop() {
  if (!db.configured || !config.research.enabled) {
    console.error("Research worker is not configured.");
    process.exitCode = 1;
    return;
  }
  await failExpiredRuns();
  console.log(`${workerId} started`);
  while (!stopping) {
    if (Date.now() - lastExpiredCleanupAt >= 60_000) await failExpiredRuns();
    const runs = [];
    for (let index = 0; index < config.research.workerConcurrency; index += 1) {
      const run = await db.claimResearchRun(workerId, config.research.leaseSeconds).catch((error) => {
        console.error("Research claim failed", error?.message || error);
        return null;
      });
      if (!run) break;
      runs.push(run);
    }
    if (!runs.length) {
      await sleep(config.research.pollMs);
      continue;
    }
    await Promise.all(runs.map(processRun));
  }
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
loop().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { SupabaseRest } from "../db/supabaseRest.js";
import { fetchOpenRouterGenerationCost } from "./billing.js";

export function startUsageReconciler(config) {
  if (config.desktop?.meteringMode !== "enforce" || !config.supabase?.serviceRoleKey) return () => {};
  const db = new SupabaseRest(config);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const twelveMinutesAgo = new Date(Date.now() - 12 * 60_000).toISOString();
      const submitted = await db.listSubmittedApiUsage({ olderThan: twelveMinutesAgo, limit: 100, signal: AbortSignal.timeout(20_000) });
      for (const event of submitted) {
        if (event.provider !== "openrouter" || !event.generation_id || !config.providers.openrouter.apiKey) continue;
        const cost = await fetchOpenRouterGenerationCost({
          apiKey: config.providers.openrouter.apiKey,
          baseUrl: config.providers.openrouter.baseUrl,
          generationId: event.generation_id,
          signal: AbortSignal.timeout(10_000)
        }).catch(() => null);
        if (cost == null) continue;
        await db.settleApiUsage({
          userId: event.user_id,
          requestId: event.request_id,
          costCredits: cost,
          costSource: "openrouter_generation",
          generationId: event.generation_id
        }, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      }
      const result = await db.reconcileApiUsage({ signal: AbortSignal.timeout(20_000) });
      if (result?.estimated || result?.released) console.warn("usage reconciler recovered stale events", result);
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60_000).toISOString();
      const overdue = await db.listSubmittedApiUsage({ olderThan: fifteenMinutesAgo, limit: 11, signal: AbortSignal.timeout(10_000) });
      if (overdue.length || submitted.length > 10) console.error("usage reconciler alert", { overdue: overdue.length, pending: submitted.length });
    } catch (error) {
      console.error("usage reconciler failed", error?.message || String(error));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), 60_000);
  timer.unref?.();
  void run();
  return () => clearInterval(timer);
}

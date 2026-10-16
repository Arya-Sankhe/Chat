import { SupabaseRest } from "../db/supabaseRest.js";
import { mamoFetch, processMamoPayment } from "./mamo.js";

// Mamo retries webhooks, but a callback can still be lost for good (an outage longer than its
// retries, a deploy at the wrong moment). This sweep re-reads recent Mamo payments and applies
// each one exactly as its webhook would; the database ignores anything already applied.
const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_MS = 4 * DAY_MS;
// A refund can come long after its payment, so deeper sweeps look only for refunds: hourly
// across the last billing month (plus margin), daily across more than a year.
const SWEEPS = [
  { every: 288, lookbackMs: 400 * DAY_MS },
  { every: 12, lookbackMs: 35 * DAY_MS }
];
// Leave a fresh payment to its own webhook before stepping in.
const SETTLE_MS = 5 * 60 * 1000;
const MAX_PAGES = 200;

function parseMamoTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? Date.UTC(match[1], match[2] - 1, match[3], match[4], match[5], match[6]) : NaN;
}

// A payment changes state (captured, then refunded); each state is applied once per process.
function paymentState(row) {
  return `${row.id}:${row.status}:${Number(row.refund_amount) || 0}`;
}

export function createMamoReconciler(config, { db = new SupabaseRest(config), now = () => Date.now() } = {}) {
  const firstSeen = new Map();
  const applied = new Set();
  let running = false;
  let sweeps = 0;

  async function recentPayments(refundLookbackMs, signal) {
    const cutoff = now() - LOOKBACK_MS;
    const refundCutoff = now() - refundLookbackMs;
    const rows = [];
    for (let page = 1; ; page += 1) {
      const result = await mamoFetch(config, `/charges?page=${page}&per_page=50`, { signal });
      if (!Array.isArray(result?.data)) throw new Error("Mamo charge list was malformed.");
      rows.push(...result.data);
      // Newest first. Mamo's timestamps carry no zone, so the cutoff is a day wider than needed.
      if (!result.pagination_meta?.next_page || result.data.some((row) => parseMamoTimestamp(row?.created_date) < refundCutoff)) break;
      if (page === MAX_PAGES) throw new Error("Mamo charge list is longer than the sweep can read.");
    }
    return rows.filter((row) => {
      const created = parseMamoTimestamp(row?.created_date);
      if (!row?.id || !row.payment_link_id || !(created >= refundCutoff)) return false;
      return created >= cutoff || Number(row.refund_amount) > 0;
    });
  }

  async function run() {
    if (running) return { skipped: true };
    running = true;
    const summary = { checked: 0, applied: 0, failed: 0 };
    try {
      const tier = SWEEPS.find(({ every }) => sweeps % every === 0);
      sweeps += 1;
      const signal = AbortSignal.timeout(120_000);
      const rows = await recentPayments(tier?.lookbackMs ?? LOOKBACK_MS, signal);
      // Only the daily sweep sees every payment still worth tracking, so only it forgets the rest.
      if (tier === SWEEPS[0]) {
        const current = new Set(rows.map(paymentState));
        for (const key of firstSeen.keys()) if (!current.has(key)) firstSeen.delete(key);
        for (const key of applied) if (!current.has(key)) applied.delete(key);
      }
      // Oldest first, so a renewal lands after the payment it renews.
      for (const row of rows.reverse()) {
        const key = paymentState(row);
        if (applied.has(key)) continue;
        if (!firstSeen.has(key)) firstSeen.set(key, now());
        if (now() - firstSeen.get(key) < SETTLE_MS) continue;
        summary.checked += 1;
        try {
          const outcome = await processMamoPayment(row.id, { db, plans: config.plans, config, signal: AbortSignal.timeout(30_000) });
          // A coupon another callback is still charging is checked again next sweep.
          if (outcome === "pending") continue;
          applied.add(key);
          summary.applied += 1;
        } catch (error) {
          // Payments made through other Mamo links (not Klui checkouts) are none of our business.
          if (error?.status === 409) { applied.add(key); continue; }
          summary.failed += 1;
          console.error("mamo reconciler could not apply payment", row.id, error?.message || String(error));
          // A payment that can never match its checkout is reported once, not every sweep.
          if (error?.status === 400) applied.add(key);
        }
      }
    } catch (error) {
      summary.failed += 1;
      console.error("mamo reconciler failed", error?.message || String(error));
    } finally {
      running = false;
    }
    return summary;
  }

  return { run };
}

export function startMamoReconciler(config) {
  if (!config.mamo?.apiKey || !config.mamo?.webhookAuth || !config.supabase?.serviceRoleKey) return () => {};
  const reconciler = createMamoReconciler(config);
  const timer = setInterval(() => void reconciler.run(), 5 * 60_000);
  timer.unref?.();
  void reconciler.run();
  return () => clearInterval(timer);
}

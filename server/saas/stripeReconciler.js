import { SupabaseRest } from "../db/supabaseRest.js";
import { reconcileStripe } from "./stripe.js";

export function startStripeReconciler(config) {
  if (!config.stripe?.secretKey) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await reconcileStripe({ db: new SupabaseRest(config), config });
    } catch {
      console.error(
        "Stripe reconciliation failed; retrying on the next interval.",
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 5 * 60 * 1000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

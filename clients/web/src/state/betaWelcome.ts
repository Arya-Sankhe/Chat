/* The beta thank-you from public/js/app.js: once per account, on desktop web,
   right after the account loads. The canvas scene is islands/betaWelcome.js. */
import { session } from "../app/runtime";
import { NATIVE_APP, useApp } from "./app";

const get = useApp.getState;
const set = useApp.setState;

let betaWelcomeTriedFor = "";
let stopBetaWelcome: (() => void) | null = null;

async function markBetaWelcomeSeen() {
  const config = get().config as { supabaseUrl?: string; supabaseAnonKey?: string } | null;
  const token = session.current()?.access_token;
  const response = await fetch(`${String(config?.supabaseUrl || "").replace(/\/+$/, "")}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: config?.supabaseAnonKey || "", ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: JSON.stringify({ data: { beta_welcome_seen: true } })
  });
  if (!response.ok) throw new Error("Could not save the welcome as seen.");
}

export function maybeShowBetaWelcome() {
  const me = get().me as { user?: { id?: string; betaWelcomeSeen?: boolean } } | null;
  const userId = me?.user?.id;
  if (!userId || betaWelcomeTriedFor === userId || !session.current() || NATIVE_APP) return;
  if (me?.user?.betaWelcomeSeen !== false) return;
  if (!matchMedia("(min-width: 721px)").matches || get().overlay) return;
  betaWelcomeTriedFor = userId;
  import("../islands/betaWelcome.js").then(({ mountBetaWelcome }) => {
    if (get().overlay || (get().me as typeof me)?.user?.id !== userId) return;
    markBetaWelcomeSeen().catch(() => {});
    stopBetaWelcome = mountBetaWelcome(document.querySelector("#betaWelcome canvas"));
    set({ betaWelcomeOpen: true, overlay: "welcome" });
  }).catch(() => {});
}

export function closeBetaWelcome() {
  set((s) => ({ betaWelcomeOpen: false, overlay: s.overlay === "welcome" ? "" : s.overlay }));
  const stop = stopBetaWelcome;
  stopBetaWelcome = null;
  // Let the fade-out finish before the scene stops moving.
  if (stop) setTimeout(stop, 300);
}

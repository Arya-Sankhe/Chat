/* The feature tour (islands/featureTour.js): Dojo lecture recording, Compare and Council.
   Shown once per account on the web after the account loads, in place of the beta thank-you.
   Redeeming a Pro pass from a link opens it again with the ticket step first. */
import { session } from "../app/runtime";
import { closeBetaWelcome } from "./betaWelcome";
import { NATIVE_APP, useApp } from "./app";
import { homeModes } from "./homeModes";

const get = useApp.getState;
const set = useApp.setState;
const DAY_MS = 24 * 60 * 60 * 1000;

let tourTriedFor = "";

async function markFeatureTourSeen() {
  const config = get().config as { supabaseUrl?: string; supabaseAnonKey?: string } | null;
  const token = session.current()?.access_token;
  // The tour also stands in for the beta thank-you, so one pop-up greets a new account.
  const response = await fetch(`${String(config?.supabaseUrl || "").replace(/\/+$/, "")}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: config?.supabaseAnonKey || "", ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: JSON.stringify({ data: { feature_tour_seen: true, beta_welcome_seen: true } })
  });
  if (!response.ok) throw new Error("Could not save the feature tour as seen.");
}

/** The Pro pass step's details from a redeemed code and its end date (none for open-ended Pro). */
export function featureTourPass(code: string, currentPeriodEnd?: string | null) {
  const end = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
  const valid = Boolean(end && Number.isFinite(end.getTime()));
  return {
    code,
    until: valid ? end!.toLocaleDateString(undefined, { day: "numeric", month: "long" }) : "",
    days: valid ? Math.max(1, Math.round((end!.getTime() - Date.now()) / DAY_MS)) : 0
  };
}

/** Opens the tour; with `pass` it starts on the ticket. Returns false where it can't show. */
export function openFeatureTour(pass: ReturnType<typeof featureTourPass> | null = null) {
  if (NATIVE_APP || !session.current()) return false;
  const me = get().me as { user?: { id?: string } } | null;
  if (me?.user?.id) tourTriedFor = me.user.id;
  if (get().betaWelcomeOpen) closeBetaWelcome();
  markFeatureTourSeen().catch(() => {});
  set({ featureTourOpen: true, featureTourPass: pass, overlay: "tour" });
  return true;
}

/** True once the tour has opened for this user in this tab, even if saving "seen" failed. */
export function featureTourShownTo(userId: string | undefined) {
  return Boolean(userId) && tourTriedFor === userId;
}

/** loadMe(): the once-per-account showing. Returns true when the tour opened. */
export function maybeShowFeatureTour() {
  const me = get().me as { user?: { id?: string; featureTourSeen?: boolean } } | null;
  const userId = me?.user?.id;
  if (!userId || tourTriedFor === userId || me?.user?.featureTourSeen !== false) return false;
  if (get().featureTourOpen || (get().overlay && get().overlay !== "welcome")) return false;
  return openFeatureTour(null);
}

export function closeFeatureTour() {
  set((s) => ({ featureTourOpen: false, overlay: s.overlay === "tour" ? "" : s.overlay }));
}

/** A step's "Try" button: close the tour and open that feature. */
export function tryFeature(step: string) {
  closeFeatureTour();
  if (step === "dojo") homeModes.selectMode("study");
  else if (step === "compare" || step === "council") homeModes.selectMode(step);
}

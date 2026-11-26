/* The feature tour (islands/featureTour.js): Dojo lecture recording, Compare and Council.
   Shown once to every web visitor: a guest on their first visit (remembered in this browser),
   and an account once (user_metadata.feature_tour_seen), in place of the beta thank-you.
   A guest who saw it and then signs up isn't shown it again. Never in the native app. */
import { session } from "../app/runtime";
import { isEmbedded } from "../islands/platform/index.js";
import { closeBetaWelcome } from "./betaWelcome";
import { NATIVE_APP, openAuthDialog, useApp } from "./app";
import { homeModes } from "./homeModes";

const get = useApp.getState;
const set = useApp.setState;
const SEEN_KEY = "klui.featureTourSeenAsGuest";

let tourTriedFor = "";
let guestTried = false;

// Storage can be blocked; then a guest may see the tour again on a later visit.
function seenInBrowser() {
  try {
    return globalThis.localStorage?.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeenInBrowser() {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY, "1");
  } catch {
    // Nothing to keep it in.
  }
}

const canShow = () => !NATIVE_APP && !isEmbedded();

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

function openFeatureTour() {
  if (!canShow()) return false;
  const me = get().me as { user?: { id?: string } } | null;
  if (session.current() && me?.user?.id) {
    tourTriedFor = me.user.id;
    markFeatureTourSeen().catch(() => {});
  } else {
    // Only a guest's viewing is kept in the browser, so it carries over to the account they
    // sign up with, and never to another account signing in on this browser.
    markSeenInBrowser();
  }
  if (get().betaWelcomeOpen) closeBetaWelcome();
  set({ featureTourOpen: true, overlay: "tour" });
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
  if (!userId || tourTriedFor === userId || me?.user?.featureTourSeen !== false || !canShow()) return false;
  if (seenInBrowser()) {
    // Seen as a guest in this browser before signing up: the account counts it as seen.
    tourTriedFor = userId;
    if (session.current()) markFeatureTourSeen().catch(() => {});
    return false;
  }
  if (get().featureTourOpen || (get().overlay && get().overlay !== "welcome")) return false;
  return openFeatureTour();
}

/** A signed-out visitor's first visit to klui.ai. Returns true when the tour opened. */
export function maybeShowGuestFeatureTour() {
  if (guestTried || get().signedIn || session.current() || seenInBrowser() || !canShow()) return false;
  if (get().featureTourOpen || get().overlay) return false;
  guestTried = true;
  return openFeatureTour();
}

export function closeFeatureTour() {
  set((s) => ({ featureTourOpen: false, overlay: s.overlay === "tour" ? "" : s.overlay }));
}

/** A step's "Try" button: close the tour and open that feature. */
export function tryFeature(step: string) {
  closeFeatureTour();
  // Guests sign up first; the features need an account.
  if (!session.current()) {
    openAuthDialog();
    return;
  }
  if (step === "dojo") homeModes.selectMode("study");
  else if (step === "compare" || step === "council") homeModes.selectMode(step);
}

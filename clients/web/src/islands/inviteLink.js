/* klui.ai/?coupon=CODE (the campus QR code, a shared link): the code is kept in this
   browser until the visitor is signed in, so it survives sign-up and a sign-in redirect.
   billing.ts redeems it (invite mode) or puts it on the pricing screen (paid plans). */

const KEY = "klui.pendingCoupon";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function normalize(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9_-]{1,32}$/.test(code) ? code : "";
}

/** Reads ?coupon= and removes it from the address bar; "" when there is none. */
export function takeCouponFromUrl(win = window) {
  try {
    const params = new URLSearchParams(win.location.search);
    if (!params.has("coupon")) return "";
    const code = normalize(params.get("coupon"));
    params.delete("coupon");
    const query = params.toString();
    win.history.replaceState(win.history.state, "", `${win.location.pathname}${query ? `?${query}` : ""}${win.location.hash}`);
    return code;
  } catch {
    return "";
  }
}

// Reading localStorage itself can throw (blocked site data), so it's read inside each try.
const browserStorage = () => globalThis.localStorage;

export function savePendingCoupon(code, storage = browserStorage, now = Date.now()) {
  const clean = normalize(code);
  if (!clean) return;
  try {
    storage().setItem(KEY, JSON.stringify({ code: clean, savedAt: now }));
  } catch {
    // Private mode or blocked storage: the code still applies in this page.
  }
}

/** The saved code, or "" once it is missing, malformed or a week old. */
export function pendingCoupon(storage = browserStorage, now = Date.now()) {
  try {
    const saved = JSON.parse(storage().getItem(KEY) || "null");
    const code = normalize(saved?.code);
    const age = now - Number(saved?.savedAt);
    if (code && age >= 0 && age < MAX_AGE_MS) return code;
    if (saved) storage().removeItem(KEY);
  } catch {
    clearPendingCoupon(storage);
  }
  return "";
}

export function clearPendingCoupon(storage = browserStorage) {
  try {
    storage().removeItem(KEY);
  } catch {}
}

import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { googleAuthorizeUrl, parseAuthCallback } from "@klui/shared";
import { AUTH_CALLBACK, PARITY_BUILD, loadConfig, session } from "./runtime";
import { openWeb, useShell } from "./shell";
import type { WebSurfaceTarget } from "@klui/shared";

/* Google sign-in, Supabase PKCE. The verifier is in secure storage so the
   callback still works if the system killed the app behind the browser. */
const VERIFIER_KEY = "klui.auth.pkce-verifier";

const base64Url = (value: string) => value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function createVerifier() {
  const bytes = await Crypto.getRandomBytesAsync(48);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return base64Url(btoa(binary));
}

let starting: Promise<void> | null = null;

/* A new attempt or a cancelled one retires what came before. Codes from an older
   attempt also fail at Supabase, since only the newest verifier is kept. */
let attempt = 0;
let exchanging = false;

/* Android's browser result can beat the callback when a sign-in finishes, so a cancel
   waits a moment before it forgets the verifier. */
const CANCEL_GRACE_MS = 1500;

function retireAfterCancel() {
  const cancelled = attempt;
  setTimeout(() => {
    if (cancelled !== attempt || exchanging) return;
    attempt += 1;
    void SecureStore.deleteItemAsync(VERIFIER_KEY);
  }, CANCEL_GRACE_MS);
}

export function signIn(): Promise<void> {
  // Changing account goes through signing out, which clears the last person's data.
  if (session.current()) return Promise.resolve();
  starting ??= (async () => {
    attempt += 1;
    useShell.setState({ signInError: "", signingIn: true });
    try {
      const config = await loadConfig();
      if (!config) throw new Error("Klui could not be reached. Check your connection.");
      const verifier = await createVerifier();
      const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
      await SecureStore.setItemAsync(VERIFIER_KEY, verifier);
      const url = googleAuthorizeUrl({ supabaseUrl: config.supabaseUrl, redirectTo: AUTH_CALLBACK, codeChallenge: base64Url(digest) });
      const result = await WebBrowser.openAuthSessionAsync(url, AUTH_CALLBACK);
      if (result.type === "success") await handleAppUrl(result.url);
      else retireAfterCancel();
    } catch (error) {
      useShell.setState({ signInError: (error as Error)?.message || "Google sign-in failed." });
    } finally {
      useShell.setState({ signingIn: false });
      starting = null;
    }
  })();
  return starting;
}

let exchanged = "";

/** Finishes sign-in if this URL is the app's callback. True when the URL was for sign-in. */
export async function handleAppUrl(url: string): Promise<boolean> {
  if (await handleTestSession(url)) return true;
  const callback = parseAuthCallback(url, AUTH_CALLBACK);
  if (!callback) return false;
  if (session.current()) return true;
  if (callback.error) {
    const message = /redirect/i.test(callback.error)
      ? `Google sign-in redirect is not configured. Add ${AUTH_CALLBACK} to Supabase Auth redirect URLs.`
      : callback.error;
    useShell.setState({ signInError: message });
    return true;
  }
  // Both the browser's result and the deep link deliver the same callback.
  if (!callback.code || callback.code === exchanged) return true;
  exchanged = callback.code;
  const current = attempt;
  exchanging = true;
  try {
    const verifier = await SecureStore.getItemAsync(VERIFIER_KEY);
    if (!verifier) throw new Error("Sign-in expired. Please try again.");
    await loadConfig();
    await session.signInWithPkceCode(callback.code, verifier, () => current === attempt && !session.current());
  } catch (error) {
    useShell.setState({ signInError: (error as Error)?.message || "Google sign-in failed." });
  } finally {
    exchanging = false;
    // A code works once, won or lost; the next try makes a new verifier.
    if (current === attempt) await SecureStore.deleteItemAsync(VERIFIER_KEY);
  }
  return true;
}

export function listenForAppUrls(onOther: (url: string) => void) {
  return Linking.addEventListener("url", ({ url }) => {
    void handleAppUrl(url).then((taken) => { if (!taken) onOther(url); });
  });
}

/* Local test builds sign in with a fixture session, since tests never reach Google. */
async function handleTestSession(url: string) {
  if (!PARITY_BUILD) return false;
  const opener = AUTH_CALLBACK.replace(/auth\/callback$/, "test/open?target=");
  if (url.startsWith(opener)) {
    openWeb(url.slice(opener.length) as WebSurfaceTarget);
    return true;
  }
  const prefix = AUTH_CALLBACK.replace(/auth\/callback$/, "test/session?data=");
  if (!url.startsWith(prefix)) return false;
  await loadConfig();
  await session.save(JSON.parse(decodeURIComponent(url.slice(prefix.length))));
  return true;
}

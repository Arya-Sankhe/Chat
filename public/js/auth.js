import {
  isNative,
  listenForAuthCallback,
  signInWithGoogle as nativeSignInWithGoogle,
  storage
} from "./platform/index.js";

const AUTH_STORAGE_KEY = "klui.auth.v1";
const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";

let googleIdentityPromise = null;

function cleanUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function authHeaders(config, session) {
  return {
    apikey: config.supabaseAnonKey,
    ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {})
  };
}

export async function loadSession() {
  try {
    const session = JSON.parse(await storage.get(AUTH_STORAGE_KEY) || "null");
    return session?.access_token ? session : null;
  } catch {
    return null;
  }
}

export async function saveSession(session) {
  if (!session?.access_token) return clearSession();
  await storage.set(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export async function clearSession() {
  await storage.remove(AUTH_STORAGE_KEY);
}

export function parseSessionFromUrl() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (!accessToken) return null;

  const expiresAt = Number(hash.get("expires_at")) || Math.floor(Date.now() / 1000) + Number(hash.get("expires_in") || 3600);
  const session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    token_type: hash.get("token_type") || "bearer"
  };
  void saveSession(session);
  window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
  return session;
}

export function parseAuthErrorFromUrl() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const error = hash.get("error_description")
    || query.get("error_description")
    || hash.get("error")
    || query.get("error");
  if (!error) return "";
  window.history.replaceState({}, document.title, window.location.pathname);
  return error;
}

export async function refreshSession(config, session, { force = false } = {}) {
  if (!session?.refresh_token) return session;
  if (!force && (session.expires_at || 0) - Math.floor(Date.now() / 1000) > 120) return session;

  const response = await fetch(`${cleanUrl(config.supabaseUrl)}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });

  if (!response.ok) {
    await clearSession();
    return null;
  }

  const refreshed = await response.json();
  const next = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || session.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600),
    token_type: refreshed.token_type || "bearer"
  };
  await saveSession(next);
  return next;
}

function sessionFromAuthPayload(payload, previousSession = null) {
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || previousSession?.refresh_token || null,
    expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600),
    token_type: payload.token_type || "bearer"
  };
}

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (googleIdentityPromise) return googleIdentityPromise;

  googleIdentityPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`);
    const script = existing || document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id);
      else reject(new Error("Google sign-in could not be loaded."));
    };
    script.onerror = () => reject(new Error("Google sign-in could not be loaded."));
    if (!existing) document.head.appendChild(script);
  });

  return googleIdentityPromise;
}

function installedIosPwa() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || "")
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && (window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true);
}

const GOOGLE_MARK_SVG = `<svg class="google-continue-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;

function googleContinueButtonHtml({ decorative = false } = {}) {
  const attrs = decorative
    ? `class="google-continue" type="button" tabindex="-1" aria-hidden="true"`
    : `class="google-continue" type="button"`;
  return `<button ${attrs}>${GOOGLE_MARK_SVG}<span>Continue with Google</span></button>`;
}

function appearanceIsDark() {
  return document.body?.dataset?.mode === "dark";
}

function renderRedirectGoogleButton(config, element, { branded = false } = {}) {
  element.innerHTML = branded
    ? googleContinueButtonHtml()
    : `<button class="native-google-button" type="button">Continue with Google</button>`;
  element.querySelector("button")?.addEventListener("click", () => {
    const redirectTo = `${window.location.origin}/`;
    const url = new URL(`${cleanUrl(config.supabaseUrl)}/auth/v1/authorize`);
    url.searchParams.set("provider", "google");
    url.searchParams.set("redirect_to", redirectTo);
    window.location.assign(url.toString());
  });
}

export async function signInWithGoogleIdToken(config, credential) {
  if (!credential) throw new Error("Google did not return a sign-in token.");

  const response = await fetch(`${cleanUrl(config.supabaseUrl)}/auth/v1/token?grant_type=id_token`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      provider: "google",
      id_token: credential
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error_description || payload.msg || payload.message || "Google sign-in failed.");
  }

  const payload = await response.json();
  const session = sessionFromAuthPayload(payload);
  await saveSession(session);
  return session;
}

export async function renderGoogleSignInButton(config, element, { onSession, onError, branded = false } = {}) {
  if (!element) return;
  if (isNative()) {
    element.innerHTML = googleContinueButtonHtml();
    element.querySelector(".google-continue")?.addEventListener("click", () => {
      nativeSignInWithGoogle(config).catch((error) => onError?.(error));
    });
    return;
  }
  const clientId = config?.auth?.googleClientId;
  if (!clientId) throw new Error("Google sign-in needs GOOGLE_CLIENT_ID.");

  let googleId;
  try {
    googleId = await loadGoogleIdentityServices();
  } catch (error) {
    if (installedIosPwa()) {
      renderRedirectGoogleButton(config, element, { branded });
      return;
    }
    throw error;
  }
  googleId.initialize({
    client_id: clientId,
    callback: async (response) => {
      try {
        const session = await signInWithGoogleIdToken(config, response?.credential);
        onSession?.(session);
      } catch (err) {
        onError?.(err);
      }
    }
  });

  const button = {
    theme: appearanceIsDark() ? "filled_black" : "outline",
    size: "large",
    type: "standard",
    shape: "rectangular",
    text: "continue_with",
    locale: "en",
    logo_alignment: "left",
    width: Math.max(240, Math.min(400, element.clientWidth || 320))
  };
  if (branded) {
    element.innerHTML = `${googleContinueButtonHtml({ decorative: true })}<div class="google-continue-gis"></div>`;
    googleId.renderButton(element.querySelector(".google-continue-gis"), button);
    return;
  }
  element.innerHTML = "";
  googleId.renderButton(element, button);
}

export async function signOut(config, session) {
  if (session?.access_token) {
    await fetch(`${cleanUrl(config.supabaseUrl)}/auth/v1/logout`, {
      method: "POST",
      headers: authHeaders(config, session)
    }).catch(() => {});
  }
  await clearSession();
}

export function listenForNativeAuth(config, handlers) {
  return listenForAuthCallback(config, handlers);
}

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

export function loadSession() {
  try {
    const session = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
    return session?.access_token ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  if (!session?.access_token) return clearSession();
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
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
  saveSession(session);
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
    clearSession();
    return null;
  }

  const refreshed = await response.json();
  const next = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || session.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600),
    token_type: refreshed.token_type || "bearer"
  };
  saveSession(next);
  return next;
}

export async function sendMagicLink(config, email) {
  const response = await fetch(`${cleanUrl(config.supabaseUrl)}/auth/v1/otp`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email,
      type: "magiclink",
      create_user: true,
      options: {
        email_redirect_to: window.location.origin,
        emailRedirectTo: window.location.origin
      }
    })
  });

  if (!response.ok) throw new Error("Could not send the magic link.");
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
  saveSession(session);
  return session;
}

export async function renderGoogleSignInButton(config, element, { onSession, onError } = {}) {
  if (!element) return;
  const clientId = config?.auth?.googleClientId;
  if (!clientId) throw new Error("Google sign-in needs GOOGLE_CLIENT_ID.");

  const googleId = await loadGoogleIdentityServices();
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

  element.innerHTML = "";
  googleId.renderButton(element, {
    theme: "outline",
    size: "large",
    type: "standard",
    shape: "rectangular",
    text: "continue_with",
    logo_alignment: "left",
    width: Math.max(240, Math.min(400, element.clientWidth || 320))
  });
}

export async function signOut(config, session) {
  if (session?.access_token) {
    await fetch(`${cleanUrl(config.supabaseUrl)}/auth/v1/logout`, {
      method: "POST",
      headers: authHeaders(config, session)
    }).catch(() => {});
  }
  clearSession();
}

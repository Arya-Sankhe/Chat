const AUTH_STORAGE_KEY = "smartyfy.auth.v1";

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

export async function refreshSession(config, session) {
  if (!session?.refresh_token) return session;
  if ((session.expires_at || 0) - Math.floor(Date.now() / 1000) > 120) return session;

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

export function googleSignInUrl(config) {
  const url = new URL(`${cleanUrl(config.supabaseUrl)}/auth/v1/authorize`);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", window.location.origin);
  return url.toString();
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

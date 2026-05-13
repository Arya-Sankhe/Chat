import { HttpError } from "../http/responses.js";

function clean(value) {
  return String(value || "").trim();
}

export function extractBearerToken(headers) {
  const raw = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;
  const match = /^Bearer\s+(.+)$/i.exec(clean(raw));
  return match ? match[1].trim() : "";
}

export function requireSupabaseConfig(config) {
  if (!config.supabase.url || !config.supabase.anonKey || !config.supabase.serviceRoleKey) {
    throw new HttpError(503, "Supabase is not configured.");
  }
}

export async function requireUser(req, config) {
  requireSupabaseConfig(config);

  const token = extractBearerToken(req.headers);
  if (!token) {
    throw new HttpError(401, "Sign in to continue.");
  }

  const response = await fetch(`${config.supabase.url}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: config.supabase.anonKey,
      authorization: `Bearer ${token}`
    },
    signal: req.signal
  });

  if (response.status === 401 || response.status === 403) {
    throw new HttpError(401, "Your session has expired. Sign in again.");
  }

  if (!response.ok) {
    throw new HttpError(502, "Could not verify your session.");
  }

  const user = await response.json();
  if (!user?.id) {
    throw new HttpError(401, "Your session has expired. Sign in again.");
  }

  return {
    id: user.id,
    email: user.email || user.user_metadata?.email || "",
    raw: user
  };
}

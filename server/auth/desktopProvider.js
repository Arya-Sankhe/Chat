import { HttpError } from "../http/responses.js";
import { requireUser } from "./supabase.js";

function decodedClaims(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); }
  catch { return {}; }
}

function supabaseAdapter(config) {
  async function authRequest(path, { method = "GET", token, body, form } = {}) {
    const response = await fetch(`${config.supabase.url}/auth/v1${path}`, {
      method,
      headers: {
        ...(token ? { apikey: config.supabase.anonKey, authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...(form ? { "content-type": "application/x-www-form-urlencoded", accept: "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : form,
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }

  return Object.freeze({
    name: "supabase",

    beginAuthorization(client, parameters) {
      const target = new URL(`${config.supabase.url}/auth/v1/oauth/authorize`);
      target.searchParams.set("client_id", client.providerClientId);
      target.searchParams.set("redirect_uri", client.redirectUri);
      target.searchParams.set("response_type", "code");
      target.searchParams.set("code_challenge", parameters.codeChallenge);
      target.searchParams.set("code_challenge_method", "S256");
      target.searchParams.set("state", parameters.state);
      if (parameters.scope) target.searchParams.set("scope", parameters.scope);
      if (parameters.prompt === "consent") target.searchParams.set("prompt", "consent");
      return target;
    },

    exchangeCode(form) {
      return authRequest("/oauth/token", { method: "POST", form });
    },

    refreshAccessToken(form) {
      return authRequest("/oauth/token", { method: "POST", form });
    },

    async verifyAccessToken(req, token) {
      const user = await requireUser(req, config);
      return { user, claims: decodedClaims(token) };
    },

    async getAuthorizationDetails(token, authorizationId) {
      const { response, payload } = await authRequest(`/oauth/authorizations/${encodeURIComponent(authorizationId)}`, { token });
      if (!response.ok) throw new HttpError(response.status === 401 ? 401 : 502, "OAuth provider request failed.");
      return payload;
    },

    async submitAuthorizationDecision(token, authorizationId, decision) {
      const { response, payload } = await authRequest(`/oauth/authorizations/${encodeURIComponent(authorizationId)}/consent`, {
        method: "POST", token, body: { action: decision }
      });
      if (!response.ok) throw new HttpError(response.status === 401 ? 401 : 502, "OAuth provider request failed.");
      return payload;
    },

    async logoutSession(token) {
      return authRequest("/logout?scope=local", { method: "POST", token });
    },

    async revokeClientGrant(token, providerClientId) {
      const query = new URLSearchParams({ client_id: providerClientId });
      const { response, payload } = await authRequest(`/user/oauth/grants?${query}`, { method: "DELETE", token });
      if (!response.ok) throw new HttpError(502, "OAuth grant revocation failed.");
      return true;
    }
  });
}

export function desktopAuthProvider(config) {
  // The facade owns this selection. A Clerk adapter implements the same object
  // without changing any desktop URI, endpoint, or token response shape.
  return supabaseAdapter(config);
}

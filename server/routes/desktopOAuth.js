import { desktopClientByLogicalId, desktopClientByProviderId, requireDesktopFeature } from "../auth/desktop.js";
import { extractBearerToken } from "../auth/supabase.js";
import { desktopAuthProvider } from "../auth/desktopProvider.js";
import { HttpError, parseJsonBody, readRawBody, sendJson } from "../http/responses.js";
import { authContext } from "./context.js";
import { enforceRateLimit } from "../http/rateLimit.js";

const PKCE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const CODE_PATTERN = /^[\x21-\x7e]{1,4096}$/;

function oauthError(res, status, error, description) {
  sendJson(res, status, { error, error_description: description });
}

function exactRedirect(client, value) {
  if (value !== client.redirectUri) throw new HttpError(400, "The desktop redirect URI is not registered.");
}

function checkedRedirectUrl(config, value, expectedClient) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new HttpError(502, "The authorization provider returned an invalid redirect."); }
  const candidate = parsed.host
    ? `${parsed.protocol}//${parsed.host}${parsed.pathname}`
    : `${parsed.protocol}${parsed.pathname}`;
  if (candidate !== expectedClient.redirectUri) throw new HttpError(502, "The authorization provider returned an unexpected redirect.");
  return parsed.toString();
}

export async function handleDesktopOAuthFacade(req, res, url, config) {
  try {
    requireDesktopFeature(config, "oauthEnabled");
    enforceRateLimit(req, url.pathname, url.pathname.endsWith("/token") ? 30 : 60);
    if (url.pathname === "/oauth/desktop/authorize") {
      if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
      const client = desktopClientByLogicalId(config, url.searchParams.get("client_id"));
      if (!client) throw new HttpError(400, "Unknown desktop client.");
      exactRedirect(client, url.searchParams.get("redirect_uri"));
      if (url.searchParams.get("response_type") !== "code") throw new HttpError(400, "Only authorization code flow is supported.");
      if (url.searchParams.get("code_challenge_method") !== "S256") throw new HttpError(400, "PKCE S256 is required.");
      if (!PKCE_PATTERN.test(url.searchParams.get("code_challenge") || "")) throw new HttpError(400, "Invalid PKCE challenge.");
      const state = url.searchParams.get("state") || "";
      if (state.length < 20 || state.length > 512) throw new HttpError(400, "Invalid OAuth state.");

      const scope = String(url.searchParams.get("scope") || "email").trim();
      if (scope && !/^[a-z0-9:_ -]{1,128}$/i.test(scope)) throw new HttpError(400, "Invalid OAuth scope.");
      const target = desktopAuthProvider(config).beginAuthorization(client, {
        codeChallenge: url.searchParams.get("code_challenge"), state, scope,
        prompt: url.searchParams.get("prompt")
      });
      res.writeHead(302, { location: target.toString(), "cache-control": "no-store" });
      res.end();
      return;
    }

    if (url.pathname === "/oauth/desktop/token") {
      if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
      const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
      if (contentType !== "application/x-www-form-urlencoded") throw new HttpError(415, "OAuth token requests must be form encoded.");
      const form = new URLSearchParams((await readRawBody(req, 16 * 1024)).toString("utf8"));
      const client = desktopClientByLogicalId(config, form.get("client_id"));
      if (!client) throw new HttpError(400, "Unknown desktop client.");
      const grantType = form.get("grant_type");
      if (!new Set(["authorization_code", "refresh_token"]).has(grantType)) throw new HttpError(400, "Unsupported OAuth grant type.");
      if (grantType === "authorization_code") {
        exactRedirect(client, form.get("redirect_uri"));
        if (!PKCE_PATTERN.test(form.get("code_verifier") || "") || !CODE_PATTERN.test(form.get("code") || "")) {
          throw new HttpError(400, "Invalid authorization code exchange.");
        }
      } else if (!CODE_PATTERN.test(form.get("refresh_token") || "")) {
        throw new HttpError(400, "Invalid refresh token.");
      }

      form.set("client_id", client.providerClientId);
      const provider = desktopAuthProvider(config);
      const { response, payload } = grantType === "authorization_code"
        ? await provider.exchangeCode(form)
        : await provider.refreshAccessToken(form);
      if (!response.ok) {
        const providerUnavailable = response.status >= 500;
        const code = providerUnavailable
          ? "temporarily_unavailable"
          : grantType === "refresh_token" ? "invalid_grant" : payload.error || "invalid_grant";
        oauthError(
          res,
          providerUnavailable ? 502 : 400,
          code,
          providerUnavailable ? "The authorization provider is unavailable." : "The authorization grant is invalid."
        );
        return;
      }
      if (!payload.access_token || !payload.refresh_token || !(Number(payload.expires_in) > 0)) {
        throw new HttpError(502, "The authorization provider returned an incomplete token response.");
      }
      sendJson(res, 200, {
        access_token: String(payload.access_token),
        refresh_token: String(payload.refresh_token),
        expires_in: Number(payload.expires_in),
        token_type: "Bearer",
        ...(payload.scope ? { scope: String(payload.scope) } : {})
      });
      return;
    }
    throw new HttpError(404, "OAuth route not found.");
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    oauthError(res, status, "invalid_request", status < 500 ? error.message : "OAuth request failed.");
  }
}

export async function handleDesktopAuthorizationDetails(req, res, url, config) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  requireDesktopFeature(config, "oauthEnabled");
  const authorizationId = String(url.searchParams.get("authorization_id") || "");
  if (!CODE_PATTERN.test(authorizationId)) throw new HttpError(400, "Invalid authorization request.");
  const context = await authContext(req, config);
  const details = await desktopAuthProvider(config).getAuthorizationDetails(extractBearerToken(req.headers), authorizationId);
  if (details.redirect_url) {
    for (const [logicalId, candidate] of Object.entries(config.desktop.clients || {})) {
      if (candidate.reserved || !candidate.providerClientId) continue;
      try {
        const redirectUrl = checkedRedirectUrl(config, details.redirect_url, { logicalId, ...candidate });
        sendJson(res, 200, { redirectUrl });
        return;
      } catch { /* try the next configured desktop client */ }
    }
    throw new HttpError(502, "The provider returned an unregistered redirect.");
  }
  const client = desktopClientByProviderId(config, details?.client?.id || details?.client?.client_id);
  if (!client) throw new HttpError(400, "This OAuth application is not a Klui desktop client.");
  exactRedirect(client, details.redirect_uri);
  await context.db.resolveAccountIdentity({ provider: "supabase", providerSubject: context.user.id, accountId: context.profile.id }, { signal: req.signal });
  const consent = await context.db.getDesktopPrivacyConsent({
    accountId: context.profile.id,
    oauthClientId: client.logicalId,
    policyVersion: config.desktop.privacyPolicyVersion
  }, { signal: req.signal });
  sendJson(res, 200, {
    authorizationId,
    client: { id: client.logicalId, name: "Klui Anything" },
    email: context.user.email,
    scope: details.scope || "email",
    privacy: { version: config.desktop.privacyPolicyVersion, accepted: Boolean(consent) }
  });
}

export async function handleDesktopAuthorizationDecision(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  requireDesktopFeature(config, "oauthEnabled");
  const context = await authContext(req, config);
  const body = await parseJsonBody(req, 16 * 1024);
  const authorizationId = String(body.authorizationId || "");
  const decision = body.decision === "deny" ? "deny" : body.decision === "approve" ? "approve" : "";
  if (!CODE_PATTERN.test(authorizationId) || !decision) throw new HttpError(400, "Invalid authorization decision.");

  const provider = desktopAuthProvider(config);
  const details = await provider.getAuthorizationDetails(extractBearerToken(req.headers), authorizationId);
  const client = desktopClientByProviderId(config, details?.client?.id || details?.client?.client_id);
  if (!client) throw new HttpError(400, "This OAuth application is not a Klui desktop client.");
  exactRedirect(client, details.redirect_uri);
  if (decision === "approve") {
    if (body.privacyConsent !== true) throw new HttpError(400, "Desktop privacy consent is required.");
    await context.db.resolveAccountIdentity({ provider: "supabase", providerSubject: context.user.id, accountId: context.profile.id }, { signal: req.signal });
    await context.db.acceptDesktopPrivacy({
      accountId: context.profile.id,
      oauthClientId: client.logicalId,
      policyVersion: config.desktop.privacyPolicyVersion
    }, { signal: req.signal });
  }
  const result = await provider.submitAuthorizationDecision(extractBearerToken(req.headers), authorizationId, decision);
  sendJson(res, 200, { redirectUrl: checkedRedirectUrl(config, result.redirect_url, client) });
}

import { HttpError } from "../http/responses.js";
import { extractBearerToken } from "./supabase.js";
import { desktopAuthProvider } from "./desktopProvider.js";

export function desktopClientByLogicalId(config, logicalId) {
  const client = config.desktop?.clients?.[logicalId];
  if (!client || client.reserved || !client.providerClientId) return null;
  return { logicalId, ...client };
}

export function desktopClientByProviderId(config, providerClientId) {
  for (const [logicalId, client] of Object.entries(config.desktop?.clients || {})) {
    if (!client.reserved && client.providerClientId && client.providerClientId === providerClientId) {
      return { logicalId, ...client };
    }
  }
  return null;
}

export async function requireDesktopUser(req, config) {
  const token = extractBearerToken(req.headers);
  const provider = desktopAuthProvider(config);
  const { user, claims } = await provider.verifyAccessToken(req, token);
  // Client identity is read only after the provider has cryptographically verified the token.
  const client = desktopClientByProviderId(config, String(claims.client_id || ""));
  if (!client) throw new HttpError(401, "A Klui desktop session is required.");
  return {
    ...user,
    identityProvider: provider.name,
    oauthClientId: client.logicalId,
    providerClientId: client.providerClientId,
    surface: client.surface
  };
}

export function requireDesktopFeature(config, feature) {
  if (!config.desktop?.[feature]) throw new HttpError(503, "This Klui desktop feature is temporarily unavailable.");
  if (feature !== "oauthEnabled" && config.desktop?.meteringMode !== "enforce") {
    throw new HttpError(503, "Desktop usage metering is not ready.");
  }
  if (feature === "chatEnabled" && !(config.desktop?.chatReservationCredits > 0)) {
    throw new HttpError(503, "Desktop chat reservation pricing is not configured.");
  }
  if (feature === "sttEnabled" && !config.providers?.openrouter?.apiKey) {
    throw new HttpError(503, "Desktop voice is not configured.");
  }
}

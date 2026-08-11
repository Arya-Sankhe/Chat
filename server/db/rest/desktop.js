import { single } from "./helpers.js";

export async function getAccountIdentity(client, { provider, providerSubject }, { signal } = {}) {
  const rows = await client.request("account_identities", {
    query: {
      provider: `eq.${provider}`,
      provider_subject: `eq.${providerSubject}`,
      select: "account_id,provider,provider_subject,last_seen_at",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function resolveAccountIdentity(client, { provider, providerSubject, accountId }, { signal } = {}) {
  await client.request("account_identities", {
    method: "POST",
    query: { on_conflict: "provider,provider_subject" },
    body: { account_id: accountId, provider, provider_subject: providerSubject },
    prefer: "resolution=ignore-duplicates,return=minimal",
    signal
  });
  const existing = await getAccountIdentity(client, { provider, providerSubject }, { signal });
  if (!existing || existing.account_id !== accountId) {
    const error = new Error("This login is mapped to a different Klui account.");
    error.status = 409;
    throw error;
  }
  await client.request("account_identities", {
    method: "PATCH",
    query: { provider: `eq.${provider}`, provider_subject: `eq.${providerSubject}` },
    body: { last_seen_at: new Date().toISOString() },
    prefer: "return=minimal",
    signal
  });
  return accountId;
}

export async function acceptDesktopPrivacy(client, { accountId, oauthClientId, policyVersion }, { signal } = {}) {
  return client.request("desktop_privacy_consents", {
    method: "POST",
    query: { on_conflict: "account_id,oauth_client_id,policy_version" },
    body: {
      account_id: accountId,
      oauth_client_id: oauthClientId,
      policy_version: policyVersion,
      accepted_at: new Date().toISOString()
    },
    prefer: "resolution=merge-duplicates,return=minimal",
    signal
  });
}

export async function getDesktopPrivacyConsent(client, { accountId, oauthClientId, policyVersion }, { signal } = {}) {
  const rows = await client.request("desktop_privacy_consents", {
    query: {
      account_id: `eq.${accountId}`,
      oauth_client_id: `eq.${oauthClientId}`,
      policy_version: `eq.${policyVersion}`,
      select: "accepted_at,policy_version",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

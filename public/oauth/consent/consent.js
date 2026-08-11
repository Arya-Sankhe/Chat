import { loadSession, refreshSession, renderGoogleSignInButton } from "/js/auth.js";

const params = new URLSearchParams(location.search);
const authorizationId = params.get("authorization_id") || "";
const status = document.querySelector("#status");
const approval = document.querySelector("#approval");
const signIn = document.querySelector("#signIn");
const privacy = document.querySelector("#privacy");
const approve = document.querySelector("#approve");
let config;
let session;

function setStatus(message) { status.textContent = message; }

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      authorization: `Bearer ${session.access_token}`
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Authorization failed.");
  return payload;
}

async function showAuthorization() {
  session = await refreshSession(config, session);
  if (!session) {
    signIn.hidden = false;
    approval.hidden = true;
    setStatus("");
    await renderGoogleSignInButton(config, document.querySelector("#googleButton"), {
      onSession: async (next) => { session = next; signIn.hidden = true; await showAuthorization(); },
      onError: (error) => setStatus(error.message)
    });
    return;
  }
  const details = await api(`/api/oauth/desktop/authorization?authorization_id=${encodeURIComponent(authorizationId)}`);
  if (details.redirectUrl) { location.assign(details.redirectUrl); return; }
  document.querySelector("#account").textContent = `Signed in as ${details.email}`;
  privacy.checked = Boolean(details.privacy?.accepted);
  approve.disabled = !privacy.checked;
  approval.hidden = false;
  setStatus("");
}

async function decide(decision) {
  approve.disabled = true;
  document.querySelector("#deny").disabled = true;
  setStatus(decision === "approve" ? "Authorizing…" : "Canceling…");
  try {
    const result = await api("/api/oauth/desktop/decision", {
      method: "POST",
      body: JSON.stringify({ authorizationId, decision, privacyConsent: privacy.checked })
    });
    location.assign(result.redirectUrl);
  } catch (error) {
    setStatus(error.message);
    approve.disabled = !privacy.checked;
    document.querySelector("#deny").disabled = false;
  }
}

privacy.addEventListener("change", () => { approve.disabled = !privacy.checked; });
approve.addEventListener("click", () => void decide("approve"));
document.querySelector("#deny").addEventListener("click", () => void decide("deny"));

try {
  if (!authorizationId) throw new Error("This authorization link is invalid.");
  config = await fetch("/api/config", { cache: "no-store" }).then((response) => response.json());
  session = await loadSession();
  await showAuthorization();
} catch (error) {
  setStatus(error.message || "Authorization failed.");
}

// Google returns here, then this page hands the PKCE code to the Mac app.
// The code is useless without the verifier the app keeps in its Keychain.
(() => {
  const allowed = ["code", "error", "error_description", "error_code"];
  const incoming = new URLSearchParams(window.location.search);
  const forwarded = new URLSearchParams();
  for (const key of allowed) {
    const value = incoming.get(key);
    if (value !== null) forwarded.set(key, value);
  }
  // Keep the code out of history and anything shared from the address bar.
  window.history.replaceState(null, "", "/oauth/macos/");
  const open = document.getElementById("open");
  const showFailed = () => {
    document.getElementById("done").hidden = true;
    document.getElementById("failed").hidden = false;
  };
  if (!forwarded.has("code") && !forwarded.has("error")) {
    showFailed();
    return;
  }
  const target = `tech.klui.anything.macos://oauth/callback?${forwarded.toString()}`;
  open.href = target;
  if (forwarded.has("error")) showFailed();
  window.location.href = target;
})();

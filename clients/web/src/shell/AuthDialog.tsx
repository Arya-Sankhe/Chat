import { useEffect, useRef } from "react";
import { renderGoogleSignInButton } from "../islands/googleButton";
import { useApp } from "../state/app";
import { signInWithGoogleCredential } from "../state/boot";
import { cx } from "./cx";

const NEEDS_CLIENT_ID = "Google sign-in needs GOOGLE_CLIENT_ID in your environment.";

export function AuthDialog() {
  const open = useApp((s) => s.authOpen);
  const artLoaded = useApp((s) => s.authArtLoaded);
  const notice = useApp((s) => s.authNotice);
  const config = useApp((s) => s.config);
  const mode = useApp((s) => s.settings.appearance);
  const systemDark = useApp((s) => s.systemDark);
  const booted = useApp((s) => s.shellRender > 0);
  const button = useRef<HTMLDivElement>(null);
  const auth = (config?.auth || {}) as { googleEnabled?: boolean; googleClientId?: string };
  const googleReady = Boolean(auth.googleEnabled && auth.googleClientId);
  const shownNotice = notice || (auth.googleEnabled && !googleReady ? NEEDS_CLIENT_ID : "");

  // renderAuthOptions(): the Google button renders while the dialog is open,
  // again when its width or the appearance changes.
  useEffect(() => {
    const el = button.current;
    if (!el) return;
    if (!googleReady) {
      el.innerHTML = "";
      return;
    }
    if (!open) return;
    renderGoogleSignInButton(
      { supabaseUrl: String(config?.supabaseUrl || ""), googleClientId: auth.googleClientId! },
      el,
      { onCredential: (credential) => void signInWithGoogleCredential(credential) }
    ).catch((error: Error) => useApp.setState({ authNotice: error?.message || "Google sign-in could not be loaded." }));
  }, [open, googleReady, auth.googleClientId, config?.supabaseUrl, mode, systemDark]);

  return (
    <section className={cx("auth-dialog", { open })} id="authDialog" role="dialog" aria-modal="true" aria-labelledby="authDialogTitle" aria-describedby="authLegal" aria-hidden={open ? "false" : "true"}>
      <div className="auth-dialog-layout">
        <div className="auth-dialog-art">
          <img data-src="/images/auth-login.webp" alt="" width="987" height="1288" decoding="async" src={artLoaded ? "/images/auth-login.webp" : undefined} />
        </div>
        <div className="auth-dialog-panel">
          <h2 id="authDialogTitle" className="auth-dialog-brand">KLUI</h2>
          <div className={cx("auth-google", { hidden: booted && !googleReady })} id="googleButton" ref={button} />
          <p className="auth-notice" id="authNotice">{shownNotice}</p>
          <p className="auth-legal" id="authLegal">
            {"By continuing, you agree to our "}
            <a href="https://home.klui.ai/terms/" target="_blank" rel="noopener">Terms of use</a>
            {" and "}
            <a href="https://home.klui.ai/privacy/" target="_blank" rel="noopener">Privacy policy</a>
            , and confirm you are 18 or older.
          </p>
        </div>
      </div>
    </section>
  );
}

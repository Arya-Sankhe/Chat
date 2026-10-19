export function AuthDialog() {
  return (
    <section className="auth-dialog" id="authDialog" role="dialog" aria-modal="true" aria-labelledby="authDialogTitle" aria-describedby="authLegal" aria-hidden="true">
      <div className="auth-dialog-layout">
        <div className="auth-dialog-art">
          <img data-src="/images/auth-login.webp" alt="" width="987" height="1288" decoding="async" />
        </div>
        <div className="auth-dialog-panel">
          <h2 id="authDialogTitle" className="auth-dialog-brand">KLUI</h2>
          <div className="auth-google" id="googleButton" />
          <p className="auth-notice" id="authNotice" />
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

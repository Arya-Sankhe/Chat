import { useApp } from "../state/app";
import { closeBetaWelcome } from "../state/betaWelcome";

export function BetaWelcome() {
  const open = useApp((s) => s.betaWelcomeOpen);
  return (
    <section className={`welcome-dialog${open ? " open" : ""}`} id="betaWelcome" role="dialog" aria-modal="true" aria-labelledby="betaWelcomeTitle" aria-hidden={open ? "false" : "true"}>
      <div className="welcome-dialog-layout">
        <div className="welcome-dialog-art">
          <canvas aria-label="Klui flies in with a thank-you banner and squashes the beta bugs" />
        </div>
        <div className="welcome-dialog-copy">
          <h2 id="betaWelcomeTitle">Thanks for joining the beta</h2>
          <p>{"We'll keep making it better every week, and we hope you love it."}</p>
        </div>
      </div>
      {" "}
      <button className="welcome-dialog-close" id="betaWelcomeClose" type="button" aria-label="Close" onClick={closeBetaWelcome}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6L6 18" />
          <path d="M6 6l12 12" />
        </svg>
      </button>
    </section>
  );
}

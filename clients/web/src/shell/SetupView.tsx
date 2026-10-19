import { useApp } from "../state/app";
import { cx } from "./cx";

const SERVICES: Record<string, string> = {
  supabase: "Supabase Auth & Postgres",
  access: "Access mode",
  r2: "Cloudflare R2 storage",
  openrouter: "OpenRouter model API",
  documents: "Document tools"
};

export function SetupView() {
  const view = useApp((s) => s.view);
  const services = (useApp((s) => s.config)?.services || {}) as Record<string, unknown>;
  return (
    <section className={cx("fullscreen-view", { hidden: view !== "setup" })} id="setupView">
      <div className="auth-panel">
        <div className="auth-brand">Klui</div>
        <h2>Setup required</h2>
        <p className="auth-sub">Configure all services to launch Klui Chat.</p>
        <div className="service-list" id="serviceList">
          {view === "setup" && Object.entries(SERVICES).map(([key, label]) => (
            <div className="service-row" key={key}>
              <span>{label}</span>
              <span className={services[key] ? "status-ok" : "status-missing"}>{services[key] ? "Ready" : "Missing"}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

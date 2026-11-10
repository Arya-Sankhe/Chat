// Mounts the React Dojo inside the #studyView section and redraws it whenever the engine
// (islands/studyHub.js) renders. The engine fills the island slots right after each commit,
// so every redraw is synchronous.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { DojoApp } from "./DojoApp";
import type { DojoHub } from "./types";
import "./dojo.css";

export function createDojoHost(container: HTMLElement) {
  const mount = document.createElement("div");
  mount.className = "d3";
  container.classList.add("d3-on");
  container.append(mount);
  const root = createRoot(mount);
  let hub: DojoHub | null = null;
  return {
    attach(next: DojoHub) { hub = next; },
    update() {
      if (!hub) return;
      const current = hub;
      const view = current.view();
      flushSync(() => root.render(<DojoApp hub={current} view={view} />));
    }
  };
}

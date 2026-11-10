import { createRoot } from "react-dom/client";
import { AppRoot } from "./shell/AppRoot";
import { runLaunchScript } from "./shell/launch";
import { initDocumentViewerWidth, installBodyState } from "./state/body";
import { bootstrap } from "./state/boot";

// URLs are handled as the current site does (pushState + popstate in the
// state modules), so there is no router. No StrictMode: the greeting and mascot islands are imperative and draw from
// Math.random on mount, so a development double-mount would change what plays.
runLaunchScript();
initDocumentViewerWidth();
installBodyState();
void bootstrap();

createRoot(document.getElementById("app")!).render(
  <AppRoot />
);

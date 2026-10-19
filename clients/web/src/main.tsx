import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AppRoot } from "./shell/AppRoot";
import { runLaunchScript } from "./shell/launch";
import { initDocumentViewerWidth } from "./state/body";
import { bootstrap } from "./state/boot";

// No StrictMode: the greeting and mascot islands are imperative and draw from
// Math.random on mount, so a development double-mount would change what plays.
runLaunchScript();
initDocumentViewerWidth();
void bootstrap();

createRoot(document.getElementById("app")!).render(
  <BrowserRouter>
    <AppRoot />
  </BrowserRouter>
);

import { openAppUpdate } from "../islands/platform/updates.js";
import { closeAppUpdate, useApp } from "../state/app";
import { cx } from "./cx";

/** The packaged app's update dialog (checkAndShowAppUpdate). A required
   update hides Later, and neither Back nor the dimmer close it. */
export function AppUpdateDialog() {
  const update = useApp((s) => s.appUpdate);
  return (
    <section className={cx("app-update-dialog", { hidden: !update })} id="appUpdateDialog" role="dialog" aria-modal="true" aria-labelledby="appUpdateTitle">
      <h2 id="appUpdateTitle">Klui update available</h2>
      <p id="appUpdateBody">{update?.body || "Download the latest Android version."}</p>
      <div className="app-update-actions">
        <button className={cx("app-update-later", { hidden: Boolean(update?.required) })} id="appUpdateLater" type="button" onClick={closeAppUpdate}>Later</button>
        {" "}
        <button className="app-update-download" id="appUpdateDownload" type="button" onClick={() => { if (update) void openAppUpdate(update); }}>Download update</button>
      </div>
    </section>
  );
}

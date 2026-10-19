export function AppUpdateDialog() {
  return (
    <section className="app-update-dialog hidden" id="appUpdateDialog" role="dialog" aria-modal="true" aria-labelledby="appUpdateTitle">
      <h2 id="appUpdateTitle">Klui update available</h2>
      <p id="appUpdateBody">Download the latest Android version.</p>
      <div className="app-update-actions">
        <button className="app-update-later" id="appUpdateLater" type="button">Later</button>
        {" "}
        <button className="app-update-download" id="appUpdateDownload" type="button">Download update</button>
      </div>
    </section>
  );
}

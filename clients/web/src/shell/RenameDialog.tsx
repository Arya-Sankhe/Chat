export function RenameDialog() {
  return (
    <section className="rename-dialog" id="renameDialog" role="dialog" aria-modal="true" aria-labelledby="renameTitle" aria-hidden="true">
      <div className="rename-copy">
        <h2 id="renameTitle">Rename chat</h2>
      </div>
      <div className="field-group rename-field">
        <label htmlFor="renameChatInput">Title</label>
        {" "}
        <input id="renameChatInput" type="text" maxLength={120} autoComplete="off" spellCheck="false" />
      </div>
      <div className="rename-actions">
        <button className="rename-cancel" id="renameCancelButton" type="button">Cancel</button>
        {" "}
        <button className="rename-save" id="renameSaveButton" type="button">Save</button>
      </div>
    </section>
  );
}

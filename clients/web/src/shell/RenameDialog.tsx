import { useEffect, useRef } from "react";
import { api } from "../app/runtime";
import { closeRenameDialog, saveRenameDialog, useApp } from "../state/app";
import { cx } from "./cx";

export function RenameDialog() {
  const rename = useApp((s) => s.rename);
  const input = useRef<HTMLInputElement>(null);
  // The value is set when the dialog opens and is the user's to edit after.
  useEffect(() => {
    const el = input.current;
    if (!rename || !el) return;
    el.value = rename.value;
    const frame = requestAnimationFrame(() => {
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [rename]);
  const save = () => void saveRenameDialog(input.current?.value || "", (id, title) => api.renameConversation(id, title));
  return (
    <section className={cx("rename-dialog", { open: rename })} id="renameDialog" role="dialog" aria-modal="true" aria-labelledby="renameTitle" aria-hidden={rename ? "false" : "true"}>
      <div className="rename-copy">
        <h2 id="renameTitle">{rename?.title || "Rename chat"}</h2>
      </div>
      <div className="field-group rename-field">
        <label htmlFor="renameChatInput">Title</label>
        {" "}
        <input
          id="renameChatInput"
          type="text"
          maxLength={120}
          autoComplete="off"
          spellCheck="false"
          ref={input}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            save();
          }}
        />
      </div>
      <div className="rename-actions">
        <button className="rename-cancel" id="renameCancelButton" type="button" onClick={closeRenameDialog}>Cancel</button>
        {" "}
        <button className="rename-save" id="renameSaveButton" type="button" onClick={save}>Save</button>
      </div>
    </section>
  );
}

import { useEffect, useRef } from "react";
import { closeConfirmDialog, confirmPendingDelete, useApp } from "../state/app";
import { removeConversation } from "../state/chat";
import { cx } from "./cx";

export function ConfirmDialog() {
  const confirm = useApp((s) => s.confirm);
  const deleteButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) deleteButton.current?.focus();
  }, [confirm]);
  return (
    <section className={cx("confirm-dialog", { open: confirm })} id="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmBody" aria-hidden={confirm ? "false" : "true"}>
      <button className="confirm-close" id="confirmCloseButton" type="button" aria-label="Close" onClick={closeConfirmDialog}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </svg>
      </button>
      {" "}
      <div className="confirm-copy">
        {/* The last title and body stay in place while the dialog fades out. */}
        <h2 id="confirmTitle">{useLastValue(confirm?.title, "Delete chat?")}</h2>
        <p id="confirmBody">{useLastValue(confirm?.body, "This conversation will be removed from your account.")}</p>
      </div>
      {" "}
      <div className="confirm-actions">
        <button className="confirm-cancel" id="confirmCancelButton" type="button" onClick={closeConfirmDialog}>Cancel</button>
        {" "}
        <button className="confirm-danger" id="confirmDeleteButton" type="button" ref={deleteButton} onClick={() => void confirmPendingDelete(removeConversation)}>
          {confirm?.confirmLabel || "Delete"}
        </button>
      </div>
    </section>
  );
}

/** The old dialogs left their last text in the DOM after closing. */
function useLastValue(value: string | undefined, initial: string) {
  const last = useRef(initial);
  if (value !== undefined) last.current = value;
  return last.current;
}

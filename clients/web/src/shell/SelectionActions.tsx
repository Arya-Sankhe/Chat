export function SelectionActions() {
  return (
    <div className="selection-actions hidden" id="selectionActions" role="toolbar" aria-label="Selected text actions">
      <button type="button" id="selectionAddToChat">Add to Chat</button>
      {" "}
      <button type="button" id="selectionAskSideChat">Ask in Side Chat</button>
    </div>
  );
}

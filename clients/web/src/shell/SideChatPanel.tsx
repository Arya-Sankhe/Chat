export function SideChatPanel() {
  return (
    <aside className="side-chat-panel hidden" id="sideChatPanel" role="dialog" aria-label="Temporary side chat">
      <header className="side-chat-header" id="sideChatHeader">
        <div>
          <strong id="sideChatTitle">Side chat</strong>
          {" "}
          <span>Temporary</span>
        </div>
        {" "}
        <button type="button" id="sideChatClose" aria-label="Close side chat" title="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>
      {" "}
      <button className="side-chat-context" id="sideChatContext" type="button" aria-label="View selected context" />
      {" "}
      <div className="side-chat-messages" id="sideChatMessages" aria-live="polite" />
      {" "}
      <div className="side-chat-suggest hidden" id="sideChatSuggest" aria-label="Suggested questions" />
      {" "}
      <div className="side-chat-composer">
        <textarea id="sideChatInput" rows={1} placeholder="Ask about this" spellCheck="true" />
        {" "}
        <button type="button" id="sideChatSend" aria-label="Send side chat message">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
          </svg>
        </button>
      </div>
    </aside>
  );
}

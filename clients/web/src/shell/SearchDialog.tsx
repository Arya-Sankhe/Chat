import { useEffect, useRef, useState, Fragment } from "react";
import type { ChatSearchHit } from "@klui/shared";
import { api } from "../app/runtime";
import { closeSearchDialog, formatChatAge, sortedConversations, useApp } from "../state/app";
import { cx } from "./cx";
import { handleConversationListClick } from "./Sidebar";

const CHAT_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;
const ChatIcon = () => <span className="search-result-icon" dangerouslySetInnerHTML={{ __html: CHAT_ICON_SVG }} />;

type BodyStatus = "idle" | "pending" | "ready" | "error";

/** renderSearchResults() and the message-body search behind it. */
export function SearchDialog() {
  const open = useApp((s) => s.searchOpen);
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeConversationId);
  const signedIn = useApp((s) => s.signedIn);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [body, setBody] = useState<{ query: string; status: BodyStatus; hits: ChatSearchHit[] }>({ query: "", status: "idle", hits: [] });
  const request = useRef(0);

  useEffect(() => {
    if (!open) {
      // cancelSearchBody() and the cleared input.
      request.current += 1;
      setQuery("");
      setBody({ query: "", status: "idle", hits: [] });
      if (input.current) input.current.value = "";
      return;
    }
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // scheduleSearchBody(): two or more characters search message bodies, 250 ms after typing stops.
  useEffect(() => {
    const trimmed = query.trim();
    const id = ++request.current;
    if (trimmed.length < 2 || !signedIn) {
      setBody({ query: "", status: "idle", hits: [] });
      return;
    }
    setBody({ query: trimmed, status: "pending", hits: [] });
    const timer = setTimeout(() => {
      api.searchChats(trimmed)
        .then((payload) => { if (id === request.current) setBody({ query: trimmed, status: "ready", hits: Array.isArray(payload?.results) ? payload.results : [] }); })
        .catch(() => { if (id === request.current) setBody({ query: trimmed, status: "error", hits: [] }); });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, signedIn]);

  const needle = query.trim().toLowerCase();
  const matches = open ? sortedConversations(conversations).filter((c) => !needle || String(c.title || "New chat").toLowerCase().includes(needle)) : [];
  const titleIds = new Set(matches.map((c) => c.id));
  const bodyHits = query.trim().length >= 2 && body.query === query.trim() ? body.hits.filter((hit) => hit?.conversation_id && !titleIds.has(hit.conversation_id)) : [];
  const bodyStatus = query.trim() === body.query ? body.status : "idle";
  const emptyStatus = !matches.length && !bodyHits.length ? (needle ? "No chats found." : "No chats yet.") : "";
  const statusText = bodyStatus === "pending" ? "Searching messages…" : bodyStatus === "error" ? "Message search is unavailable. Try again." : emptyStatus;
  const statusRow = bodyStatus === "pending" || bodyStatus === "error" ? <div className="search-dialog-empty">{statusText}</div> : null;

  return (
    <section className={cx("search-dialog", { hidden: !open })} id="searchDialog" role="dialog" aria-modal="true" aria-label="Search chats" aria-hidden={open ? "false" : "true"}>
      <div className="search-dialog-inner">
        <div className="search-dialog-input-wrap">
          <svg className="search-dialog-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          {" "}
          <input id="searchChatInput" type="search" autoComplete="off" spellCheck="false" placeholder="Search chats" ref={input} onInput={(event) => setQuery(event.currentTarget.value)} />
          {" "}
          <button className="search-dialog-close" id="searchDialogClose" type="button" aria-label="Close search" onClick={closeSearchDialog}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="search-dialog-results" id="searchChatResults" onClick={handleConversationListClick}>
          {open && (!matches.length && !bodyHits.length ? statusRow || <div className="search-dialog-empty">{emptyStatus}</div> : (
            <>
              {/* The old template's whitespace between and inside rows is kept: the rows are inline. */}
              {matches.map((c) => (
                <Fragment key={c.id}>
                  {" "}
                  <button className={`search-result-row ${c.id === activeId ? "active" : ""}`} type="button" data-open-chat-id={c.id}>
                    <ChatIcon />
                    {" "}
                    <span className="search-result-copy">
                      <span className="search-result-title">{c.title || "New chat"}</span>
                    </span>
                    {" "}
                    <span className="search-result-meta">{formatChatAge(c.updated_at || c.created_at)}</span>
                  </button>
                </Fragment>
              ))}
              {bodyHits.length > 0 && (
                <>
                  <div className="search-result-section">Message matches</div>
                  {bodyHits.map((hit) => (
                    <Fragment key={`hit-${hit.conversation_id}`}>
                      {" "}
                      <button className={`search-result-row ${hit.conversation_id === activeId ? "active" : ""}`} type="button" data-open-chat-id={hit.conversation_id}>
                        <ChatIcon />
                        {" "}
                        <span className="search-result-copy">
                          <span className="search-result-title">{hit.title || "New chat"}</span>
                          {" "}
                          <span className="search-result-snippet">{hit.snippet || ""}</span>
                        </span>
                        {" "}
                        <span className="search-result-meta">{formatChatAge(hit.matched_at)}</span>
                      </button>
                    </Fragment>
                  ))}
                </>
              )}
              {statusRow}
            </>
          ))}
        </div>
        <div className="sr-only" id="searchChatStatus" aria-live="polite" aria-atomic="true" aria-busy={open ? (bodyStatus === "pending" ? "true" : "false") : undefined}>{open ? statusText : ""}</div>
      </div>
    </section>
  );
}

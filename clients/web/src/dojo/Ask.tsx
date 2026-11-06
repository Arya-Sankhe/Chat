// Course › Ask: the course chat. The messages and the composer are the chat core's own
// nodes; the engine moves them into the slots drawn here.
import { useState } from "react";
import { Icon } from "./brand";
import { Menu } from "./Menu";
import type { DojoHub, DojoView } from "./types";

export function AskTab({ view }: { hub: DojoHub; view: DojoView }) {
  const [query, setQuery] = useState("");
  const chats = view.chats || [];
  const filtered = chats.filter(chat => chat.title.toLowerCase().includes(query.toLowerCase()));
  const current = chats.find((chat) => chat.id === view.chatId);
  return (
    <div className="d3-tabbody d3-ask">
      <div className="d3-toolbar">
        <Menu label="Chat history" align="left" trigger={<span className="d3-chipbtn"><Icon name="history" size={15} />{current ? current.title : "history"}<Icon name="chevD" size={14} /></span>}>
          <input className="d3-history-search" aria-label="Search chat history" placeholder="search chats…" value={query} onChange={event => setQuery(event.target.value)} />
          {filtered.length
            ? filtered.map((chat) => (
              <button key={chat.id} type="button" className={`d3-mi${chat.id === view.chatId ? " is-current" : ""}`} role="menuitem" data-open-chat-id={chat.id}>
                <Icon name="chat" size={16} /><span className="d3-mi-text">{chat.title}</span>
              </button>
            ))
            : <p className="d3-mi-empty">no matching chats</p>}
        </Menu>
        <span className="d3-top-space" />
        {view.hasMessages && <button type="button" className="d3-btn" data-dojo-new-chat=""><Icon name="plus" size={15} />new chat</button>}
      </div>
      <div className="dojo-chat-content d3-chat">
        <div className="dojo-messages-slot" />
        {!view.hasMessages && (
          <div className="d3-chat-welcome">
            <h2>ask {view.course?.name || "this course"} anything</h2>
            <div className="d3-prompts">
              {[["course overview", "Give me an overview of this course"], ["key concepts", "Explain the key concepts"], ["what to revise", "What should I revise first, based on my lectures?"]].map(([label, prompt]) => (
                <button key={label} type="button" data-dojo-prompt={prompt}>{label}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="d3-composer study-composer-slot" />
    </div>
  );
}

import { NavLink, useNavigate } from "react-router";
import { signOut, useAuth } from "../app/auth";
import { chat } from "../app/runtime";
import { useChat } from "../app/useChat";

export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const navigate = useNavigate();
  const conversations = useChat((state) => state.conversations);
  const status = useChat((state) => state.conversationsStatus);
  const error = useChat((state) => state.conversationsError);
  const runs = useChat((state) => state.runs);
  const email = useAuth((state) => state.me?.user?.email ?? "");

  return (
    <nav className="sidebar" aria-label="Chats">
      <button className="new-chat" type="button" onClick={() => { navigate("/"); onNavigate(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        New chat
      </button>
      <div className="conversation-list">
        {status === "loading" && !conversations.length ? <p className="sidebar-note">Loading chats…</p> : null}
        {status === "error" ? (
          <p className="sidebar-note">{error} <button className="link-button" type="button" onClick={() => void chat.loadConversations()}>Retry</button></p>
        ) : null}
        {conversations.map((conversation) => (
          <NavLink key={conversation.id} to={`/c/${conversation.id}`} onClick={onNavigate} className={({ isActive }) => `conversation-link${isActive ? " active" : ""}`}>
            <span className="conversation-title">{conversation.title || "New chat"}</span>
            {runs[conversation.id] && runs[conversation.id]!.status !== "failed" ? <span className="running-dot" aria-label="Replying" /> : null}
          </NavLink>
        ))}
      </div>
      <div className="sidebar-footer">
        <span className="account-email" title={email}>{email}</span>
        <button className="link-button" type="button" onClick={() => void signOut()}>Sign out</button>
      </div>
    </nav>
  );
}

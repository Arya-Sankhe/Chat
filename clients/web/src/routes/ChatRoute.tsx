import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { chat } from "../app/runtime";
import { useChat, useTranscript } from "../app/useChat";
import { Composer } from "../components/Composer";
import { Transcript } from "../components/Transcript";

export function ChatRoute() {
  const { conversationId = null } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = useRef(location.pathname);
  currentPath.current = location.pathname;
  const { thread, run, items } = useTranscript(conversationId);
  const draft = useChat((state) => (conversationId ? state.drafts[conversationId] ?? "" : ""));

  useEffect(() => {
    if (conversationId) void chat.openConversation(conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (draft && conversationId) chat.takeDraft(conversationId);
  }, [draft, conversationId]);

  const busy = Boolean(run && run.status !== "failed");
  const send = async (text: string) => {
    const sentFrom = location.pathname;
    const id = await chat.send({ conversationId, text });
    // Creating the chat takes a request; follow it only if the user is still where they sent from.
    if (id !== conversationId && currentPath.current === sentFrom) navigate(`/c/${id}`, { replace: true });
  };

  return (
    <section className="chat">
      {!conversationId ? (
        <div className="empty-state"><h1>What can I help with?</h1></div>
      ) : thread?.status === "error" && !items.length ? (
        <div className="empty-state">
          <p className="form-error">{thread.error}</p>
          <button className="link-button" type="button" onClick={() => void chat.openConversation(conversationId)}>Try again</button>
        </div>
      ) : thread?.status === "loading" && !items.length ? (
        <div className="empty-state"><p className="message-status shimmer">Loading…</p></div>
      ) : (
        <>
        {thread?.error ? (
          <p className="thread-banner" role="alert">
            {thread.error} <button className="link-button" type="button" onClick={() => void chat.openConversation(conversationId)}>Refresh</button>
          </p>
        ) : null}
        <Transcript
          items={items}
          conversationId={conversationId}
          followKey={run?.assistant.id ?? ""}
          hasMore={Boolean(thread?.page.hasMore)}
          onLoadOlder={() => chat.loadOlder(conversationId)}
        />
        </>
      )}
      <Composer
        busy={busy}
        stopping={run?.status === "stopping"}
        draft={draft}
        autoFocusKey={conversationId ?? "new"}
        onSend={send}
        onStop={() => conversationId && void chat.stop(conversationId)}
      />
    </section>
  );
}

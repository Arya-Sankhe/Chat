import { textFromMessageContent, type DisplayItem, type LiveAssistant } from "@klui/shared";
import { chat } from "../app/runtime";
import { Markdown } from "./Markdown";

function LiveStatus({ message, status }: { message: LiveAssistant; status: string }) {
  if (status === "reconnecting") return <p className="message-status">Reconnecting…</p>;
  if (status === "stopping") return <p className="message-status">Stopping…</p>;
  if (message.content) return null;
  const running = message.toolEvents.findLast((tool) => tool.status === "running");
  const label = message.illustrationStatus
    || (running ? `Searching${running.query ? ` “${running.query}”` : ""}…` : "")
    || message.activity.at(-1)?.text
    || "Thinking…";
  return <p className="message-status shimmer">{label}</p>;
}

export function MessageView({ item, conversationId }: { item: DisplayItem; conversationId: string }) {
  if (item.kind !== "live" && item.message.role === "user") {
    return (
      <div className="message user">
        <div className="user-bubble">{textFromMessageContent(item.message.content)}</div>
      </div>
    );
  }

  if (item.kind === "live") {
    const { message, status } = item;
    const busy = status !== "failed" && !message.error && !message.stopped;
    return (
      <div className="message assistant" aria-busy={busy}>
        {message.content ? <Markdown text={message.content} /> : null}
        {busy ? <LiveStatus message={message} status={status} /> : null}
        {message.stopped ? <p className="message-note">Stopped</p> : null}
        {message.error ? (
          <div className="message-error" role="alert">
            <span>{message.error}</span>
            {status === "failed" ? (
              <button className="link-button" type="button" onClick={() => chat.dismissFailedRun(conversationId)}>Dismiss</button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const { message } = item;
  const text = textFromMessageContent(message.content);
  return (
    <div className="message assistant">
      {text ? <Markdown text={text} /> : null}
      {message.error ? <div className="message-error" role="alert">{message.error}</div> : null}
      {item.kind === "stored" && item.canRetry ? (
        <div className="message-actions">
          <button className="icon-button" type="button" aria-label="Retry" title="Retry" onClick={() => void chat.retry(conversationId, message.id)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
          </button>
          <button className="icon-button" type="button" aria-label="Copy" title="Copy" onClick={() => void navigator.clipboard?.writeText(text)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}

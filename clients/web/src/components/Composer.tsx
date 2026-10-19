import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

export function Composer({ busy, stopping, draft, onSend, onStop, autoFocusKey }: {
  busy: boolean;
  stopping: boolean;
  /** Text handed back after a cancelled turn. */
  draft: string;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
  autoFocusKey: string;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draft) setText(draft);
  }, [draft]);

  useEffect(() => {
    input.current?.focus();
  }, [autoFocusKey]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || sending || !text.trim()) return;
    setSending(true);
    setError("");
    const sent = text;
    setText("");
    try {
      await onSend(sent);
    } catch (err) {
      setText(sent);
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="composer-box">
        <textarea
          ref={input}
          value={text}
          rows={1}
          placeholder="Ask Klui"
          aria-label="Ask Klui"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <button className="send-button" type="button" aria-label="Stop" disabled={stopping} onClick={onStop}>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>
          </button>
        ) : (
          <button className="send-button" type="submit" aria-label="Send" disabled={sending || !text.trim()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        )}
      </div>
    </form>
  );
}

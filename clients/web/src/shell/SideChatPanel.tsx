import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { escapeHtml } from "../islands/escapeHtml.js";
import { hydrateKluiBars } from "../islands/klui.js";
import { renderContent, renderPlainText } from "../islands/render.js";
import { addReplyToCard, closeSideChat, scroll, sendSideChatMessage, setSideChatInput, sideChatHooks, useSideChat, type SideChatMessage } from "../state/sideChat";

/* The temporary side chat. Floating, it opens beside the selection and drags by
   its header; docked (the Dojo's card chat), CSS pins it to the side. */

function distanceFromBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

function messageHtml(message: SideChatMessage, { streaming, addable, added, adding }: { streaming: boolean; addable: boolean; added: boolean; adding: boolean }, index: number) {
  const text = sideChatHooks.rawText(message.content);
  const body = message.role === "assistant" ? renderContent(text) : renderPlainText(text);
  const activity = message.role === "assistant" ? sideChatHooks.activityHtml(message, streaming) : "";
  const add = addable && message.role === "assistant" && !streaming && !message.error && text.trim()
    ? `<button class="side-chat-add-card" type="button" data-add-to-card="${index}"${added || adding ? " disabled" : ""}>${added ? "Added" : adding ? "Adding…" : "Add to this card"}</button>`
    : "";
  return `${activity}${body}${message.error ? `<span class="side-chat-error">${escapeHtml(message.error)}</span>` : ""}${add}`;
}

function Messages() {
  const messages = useSideChat((s) => s.messages);
  useSideChat((s) => s.revision);
  const running = useSideChat((s) => s.running);
  const canAdd = useSideChat((s) => s.canAddToCard);
  const added = useSideChat((s) => s.added);
  const adding = useSideChat((s) => s.adding);
  const ref = useRef<HTMLDivElement>(null);
  const touchY = useRef(0);
  // Read before this render lands: follow the reply only if the reader was at the bottom.
  const pinned = scroll.auto && (!ref.current || distanceFromBottom(ref.current) <= 60);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    hydrateKluiBars(el as unknown as Document);
    if (pinned) el.scrollTop = el.scrollHeight;
  });
  return (
    <div
      className="side-chat-messages"
      id="sideChatMessages"
      aria-live="polite"
      ref={ref}
      onClick={(event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>("[data-add-to-card]");
        if (button && !button.disabled) void addReplyToCard(Number(button.dataset.addToCard));
      }}
      onWheel={(event) => {
        if (event.deltaY < 0) scroll.auto = false;
        else if (event.deltaY > 0 && distanceFromBottom(event.currentTarget) <= 40) scroll.auto = true;
      }}
      onTouchStart={(event) => { touchY.current = event.touches[0]?.clientY ?? 0; }}
      onTouchMove={(event) => {
        const y = event.touches[0]?.clientY ?? touchY.current;
        if (y > touchY.current + 2) scroll.auto = false;
        else if (y < touchY.current - 2 && distanceFromBottom(event.currentTarget) <= 40) scroll.auto = true;
        touchY.current = y;
      }}
    >
      {messages.map((message, index) => {
        const streaming = message.role === "assistant" && running && index === messages.length - 1;
        return (
          <div
            key={index}
            className={`side-chat-message ${message.role}`}
            dangerouslySetInnerHTML={{ __html: messageHtml(message, { streaming, addable: canAdd, added: added.has(index), adding: adding.has(index) }, index) }}
          />
        );
      })}
    </div>
  );
}

/** One-tap prompts: stacked while the chat is empty, then a single scrolling row. */
function Suggestions() {
  const suggestions = useSideChat((s) => s.suggestions);
  const running = useSideChat((s) => s.running);
  const asked = useSideChat((s) => s.messages.length > 0);
  return (
    <div className={`side-chat-suggest${suggestions.length ? "" : " hidden"}${asked ? " is-row" : ""}`} id="sideChatSuggest" aria-label="Suggested questions">
      {suggestions.map(([label, prompt], index) => (
        <button key={index} type="button" data-side-chat-suggest={index} disabled={running} onClick={() => void sendSideChatMessage(prompt)}>{label}</button>
      ))}
    </div>
  );
}

export function SideChatPanel() {
  const open = useSideChat((s) => s.open);
  const session = useSideChat((s) => s.session);
  const title = useSideChat((s) => s.title);
  const context = useSideChat((s) => s.context);
  const docked = useSideChat((s) => s.docked);
  const anchor = useSideChat((s) => s.anchor);
  const input = useSideChat((s) => s.input);
  const flashcard = useSideChat((s) => s.flashcard);
  const running = useSideChat((s) => s.running);
  const focusTick = useSideChat((s) => s.focusTick);
  const panel = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // A floating panel opens beside the selection, inside the window.
  useLayoutEffect(() => {
    if (!open || docked || !panel.current) {
      setPosition(null);
      return;
    }
    const panelWidth = panel.current.offsetWidth || 380;
    const panelHeight = panel.current.offsetHeight || 480;
    const preferredLeft = (anchor?.right || 12) + 14;
    const left = preferredLeft + panelWidth <= window.innerWidth - 12 ? preferredLeft : Math.max(12, (anchor?.left || 12) - panelWidth - 14);
    const top = Math.min(Math.max(12, anchor?.top || 12), window.innerHeight - panelHeight - 12);
    setPosition({ left, top: Math.max(12, top) });
    // Re-placed only when a new chat opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, open, docked]);

  // Only a new focus request moves focus; reopening docked without one leaves it be.
  useEffect(() => {
    if (focusTick && useSideChat.getState().open) inputRef.current?.focus();
  }, [focusTick]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button") || docked || !panel.current) return;
    const rect = panel.current.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const start = drag.current;
    const el = panel.current;
    if (!start || !el) return;
    setPosition({
      left: Math.min(Math.max(8, start.left + event.clientX - start.x), window.innerWidth - el.offsetWidth - 8),
      top: Math.min(Math.max(8, start.top + event.clientY - start.y), window.innerHeight - el.offsetHeight - 8)
    });
  };
  const stopDrag = () => { drag.current = null; };

  return (
    <aside
      ref={panel}
      className={`side-chat-panel${open ? "" : " hidden"}${docked ? " is-docked" : ""}`}
      id="sideChatPanel"
      role="dialog"
      aria-label="Temporary side chat"
      style={position ? { left: `${position.left}px`, top: `${position.top}px` } : undefined}
    >
      <header className="side-chat-header" id="sideChatHeader" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
        <div>
          <strong id="sideChatTitle">{title}</strong>
          {" "}
          <span>Temporary</span>
        </div>
        {" "}
        <button type="button" id="sideChatClose" aria-label="Close side chat" title="Close" onClick={closeSideChat}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </header>
      {" "}
      <button className="side-chat-context" id="sideChatContext" type="button" aria-label="View selected context" onClick={() => sideChatHooks.openPastedText(context)}>
        {context.replace(/\s+/g, " ").slice(0, 180)}
      </button>
      {" "}
      <Messages />
      {" "}
      <Suggestions />
      {" "}
      <div className="side-chat-composer">
        <textarea
          ref={inputRef}
          id="sideChatInput"
          rows={1}
          placeholder={flashcard ? "Ask any doubts." : "Ask about this"}
          spellCheck="true"
          value={input}
          onChange={(event) => setSideChatInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendSideChatMessage();
            }
          }}
        />
        {" "}
        <button type="button" id="sideChatSend" aria-label="Send side chat message" disabled={running || !context} onClick={() => void sendSideChatMessage()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
          </svg>
        </button>
      </div>
    </aside>
  );
}

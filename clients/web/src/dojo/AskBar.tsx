// The ask bar at the bottom of the Dojo. You type right here; only pressing send moves you
// to Ask (or, on a lecture, opens the answer in a small pop-up over the notes).
import { useEffect, useRef, useState } from "react";
import { Icon, Klui } from "./brand";
import { Slot } from "./Slot";

export function AskBar({ placeholder, onSend }: { placeholder: string; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const grow = () => {
    const box = input.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 140)}px`;
  };
  useEffect(grow, [text]);
  const send = () => {
    const question = text.trim();
    if (!question) { input.current?.focus(); return; }
    setText("");
    onSend(question);
  };
  return (
    <form className="d3-askbar is-input" onSubmit={(event) => { event.preventDefault(); send(); }} onClick={(event) => { if (event.target === event.currentTarget) input.current?.focus(); }}>
      <Klui size={24} />
      <textarea
        ref={input}
        rows={1}
        value={text}
        aria-label={placeholder}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
        }}
      />
      <button type="submit" className={`d3-sendbtn${text.trim() ? " is-ready" : ""}`} aria-label="Send" title="Send"><Icon name="send" size={16} /></button>
    </form>
  );
}

// While the answer is being written: the bar shrinks to a tiny pill with three dots.
export function ThinkingPill() {
  return (
    <div className="d3-thinking" role="status" aria-label="klui is answering">
      <Klui size={20} />
      <span className="d3-dots" aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}

// The answer, in a pop-up over the lecture. It is the lecture's own chat (the same one its
// Ask tab shows): the engine moves the chat messages and composer into these slots.
export function LecturePop({ title, open, onClose, onExpand }: { title: string; open: boolean; onClose: () => void; onExpand: () => void }) {
  return (
    <section className={`d3-pop${open ? " is-open" : ""}`} aria-label="Ask about this lecture" aria-hidden={!open} hidden={!open ? true : undefined}>
      <header className="d3-pop-head">
        <Klui size={20} />
        <span className="d3-pop-title"><b>ask</b><small>{title}</small></span>
        <button type="button" className="d3-iconbtn" onClick={onExpand} aria-label="Open in Ask" title="Full screen"><Icon name="expand" size={16} /></button>
        <button type="button" className="d3-iconbtn" onClick={onClose} aria-label="Close" title="Close"><Icon name="x" size={16} /></button>
      </header>
      <div className="dojo-chat-content d3-chat d3-pop-chat"><Slot className="dojo-messages-slot" /></div>
      <Slot className="d3-composer study-composer-slot" />
    </section>
  );
}

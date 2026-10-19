import { useLayoutEffect, useRef } from "react";
import type { DisplayItem } from "@klui/shared";
import { MessageView } from "./MessageView";

const PIN_THRESHOLD = 120;

export function Transcript({ items, conversationId, hasMore, onLoadOlder }: {
  items: DisplayItem[];
  conversationId: string;
  hasMore: boolean;
  onLoadOlder: () => Promise<void>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const restoreFrom = useRef<number | null>(null);

  // Opening a chat lands at its newest message.
  useLayoutEffect(() => {
    pinned.current = true;
  }, [conversationId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restoreFrom.current != null) {
      // Older messages were prepended: keep the reader's place.
      el.scrollTop = el.scrollHeight - restoreFrom.current;
      restoreFrom.current = null;
    } else if (pinned.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
  };

  const loadOlder = async () => {
    const el = scroller.current;
    if (el) restoreFrom.current = el.scrollHeight - el.scrollTop;
    await onLoadOlder().catch(() => { restoreFrom.current = null; });
  };

  return (
    <div className="transcript" ref={scroller} onScroll={onScroll}>
      <div className="transcript-inner">
        {hasMore ? <button className="load-older" type="button" onClick={() => void loadOlder()}>Load earlier messages</button> : null}
        {items.map((item) => <MessageView key={item.key} item={item} conversationId={conversationId} />)}
      </div>
    </div>
  );
}

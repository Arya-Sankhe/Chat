// section#messages. On the empty home it hosts the greeting island exactly as
// renderMessages() did: every renderShell() replaces the greeting markup and
// restarts the typing animation (klui.js), consuming randomness the same way.
// Conversation rendering arrives with the message slice.
import { useLayoutEffect, useRef } from "react";
import { renderHomeGreetingHtml, startHomeGreeting, stopHomeGreeting } from "../islands/klui.js";
import { useApp } from "../state/app";
import { launchGreetingHtml } from "./launch";

export function Messages() {
  const ref = useRef<HTMLElement>(null);
  const shellRender = useApp((s) => s.shellRender);
  const chatEmpty = useApp((s) => s.chatEmpty);
  const signedIn = useApp((s) => s.signedIn);
  const temporaryChat = useApp((s) => s.temporaryChat);

  useLayoutEffect(() => {
    const el = ref.current!;
    if (shellRender === 0) {
      // Before boot: what index.html's script painted on a phone opened at "/".
      el.innerHTML = launchGreetingHtml();
      return;
    }
    stopHomeGreeting();
    if (chatEmpty) {
      const guest = !signedIn;
      el.innerHTML = renderHomeGreetingHtml({ guest, temporary: temporaryChat });
      startHomeGreeting({ guest, temporary: temporaryChat });
    } else {
      el.innerHTML = `<div class="msg-skeleton" aria-hidden="true"><div class="msg-skeleton-bar"></div><div class="msg-skeleton-bar"></div><div class="msg-skeleton-bar"></div></div>`;
    }
  }, [shellRender]);

  return <section className="messages" id="messages" aria-live="polite" ref={ref} style={{ overflowAnchor: "none" }} />;
}

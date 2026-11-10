// section#messages: the chat core (islands/chat.js) owns everything inside it,
// from the boot frame's greeting to the conversation, as renderMessages() did.
export function Messages() {
  return <section className="messages" id="messages" aria-live="polite" style={{ overflowAnchor: "none" }} />;
}

/* The current site's end-of-body script (public/index.html), which runs before
   app.js: on a phone it marks the page as the empty home and, at "/", picks
   the launch greeting. It runs here before React renders, so the pick is the
   page's first Math.random() call, as before. */

/** Phones (and the packaged app) at load; some markup is only added then. */
export const MOBILE_AT_LOAD = window.matchMedia("(max-width: 860px)").matches;

const GREETINGS = [
  "how can i help you?", "what's cooking?", "spill the tea_", "say less, i'm ready",
  "what we working on?", "drop it here", "no pressure, just vibes", "awaiting input...",
  "got something on your mind?", "let's cook"
];

declare global {
  interface Window {
    __kluiLaunchGreeting?: string;
    __kluiLaunchMascot?: string;
  }
}

export function runLaunchScript() {
  if (!MOBILE_AT_LOAD) return;
  document.body.classList.add("capacitor-native", "mobile-ui", "chat-empty");
  if (window.location.pathname === "/") {
    window.__kluiLaunchGreeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
  }
}

/** The greeting markup that script wrote into #messages, byte for byte. */
export function launchGreetingHtml() {
  const greeting = window.__kluiLaunchGreeting;
  if (!MOBILE_AT_LOAD || !greeting) return "";
  return `<div class="empty-state mobile-home-greeting">
            <div class="hero-line${greeting.length > 22 ? " is-long" : ""}">
              <div class="klui" aria-hidden="true">${window.__kluiLaunchMascot}</div>
              <p class="type-line"><span class="type-text">${greeting}</span><span class="caret"></span></p>
            </div>
          </div>`;
}

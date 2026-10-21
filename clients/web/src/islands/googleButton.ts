/* auth.js renderGoogleSignInButton(), web half: our own "Continue with Google"
   shell paints at once, and Google's (invisible) button is laid over it as the
   click target once the Identity script loads. */
const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";

interface GoogleId {
  initialize(options: { client_id: string; callback: (response: { credential?: string }) => void }): void;
  renderButton(element: Element, options: Record<string, unknown>): void;
}

declare global {
  interface Window { google?: { accounts?: { id?: GoogleId } } }
  interface Navigator { standalone?: boolean }
}

let googleIdentityPromise: Promise<GoogleId> | null = null;
// Increments per render so a superseded call can bail after its await.
let googleRenderToken = 0;

function loadGoogleIdentityServices(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (googleIdentityPromise) return googleIdentityPromise;
  googleIdentityPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_URL}"]`);
    const script = existing || document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id);
      else reject(new Error("Google sign-in could not be loaded."));
    };
    script.onerror = () => reject(new Error("Google sign-in could not be loaded."));
    if (!existing) document.head.appendChild(script);
  });
  return googleIdentityPromise;
}

function installedIosPwa() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && (window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true);
}

const GOOGLE_MARK_SVG = `<svg class="google-continue-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`;

export function googleContinueButtonHtml({ decorative = false } = {}) {
  const attrs = decorative ? `class="google-continue" type="button" tabindex="-1" aria-hidden="true"` : `class="google-continue" type="button"`;
  return `<button ${attrs}>${GOOGLE_MARK_SVG}<span>Continue with Google</span></button>`;
}

/** The installed iOS app can't show Google's popup: send it through Supabase's redirect. */
function renderRedirectGoogleButton(supabaseUrl: string, element: HTMLElement) {
  element.innerHTML = googleContinueButtonHtml();
  element.querySelector("button")?.addEventListener("click", () => {
    const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/authorize`);
    url.searchParams.set("provider", "google");
    url.searchParams.set("redirect_to", `${window.location.origin}/`);
    window.location.assign(url.toString());
  });
}

export async function renderGoogleSignInButton(
  config: { supabaseUrl: string; googleClientId: string },
  element: HTMLElement,
  { onCredential }: { onCredential: (credential: string) => void }
) {
  const renderToken = ++googleRenderToken;
  element.innerHTML = `${googleContinueButtonHtml({ decorative: true })}<div class="google-continue-gis"></div>`;
  let googleId: GoogleId;
  try {
    googleId = await loadGoogleIdentityServices();
  } catch (error) {
    if (renderToken !== googleRenderToken) return;
    if (installedIosPwa()) return renderRedirectGoogleButton(config.supabaseUrl, element);
    // Never leave a button that looks clickable when Google never loaded.
    element.innerHTML = "";
    throw error;
  }
  if (renderToken !== googleRenderToken) return;
  googleId.initialize({ client_id: config.googleClientId, callback: (response) => onCredential(response?.credential || "") });
  const slot = element.querySelector(".google-continue-gis");
  if (!slot) return;
  googleId.renderButton(slot, {
    theme: document.body?.dataset?.mode === "dark" ? "filled_black" : "outline",
    size: "large",
    type: "standard",
    shape: "rectangular",
    text: "continue_with",
    locale: "en",
    logo_alignment: "left",
    width: Math.max(240, Math.min(400, element.clientWidth || 320))
  });
}

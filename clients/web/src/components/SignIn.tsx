import { useEffect, useRef, useState } from "react";
import { signInWithGoogleCredential, useAuth } from "../app/auth";

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";

interface GoogleId {
  initialize(options: { client_id: string; callback: (response: { credential?: string }) => void }): void;
  renderButton(element: HTMLElement, options: Record<string, unknown>): void;
}

declare global {
  interface Window { google?: { accounts?: { id?: GoogleId } } }
}

let gisPromise: Promise<GoogleId> | null = null;
function loadGoogleIdentity(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  gisPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("Google sign-in could not be loaded.")));
    script.onerror = () => {
      gisPromise = null;
      reject(new Error("Google sign-in could not be loaded."));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

export function SignIn() {
  const clientId = useAuth((state) => state.config?.auth?.googleClientId ?? "");
  const slot = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) {
      setError("Google sign-in is not configured on this server.");
      return;
    }
    let cancelled = false;
    loadGoogleIdentity().then((google) => {
      if (cancelled || !slot.current) return;
      google.initialize({
        client_id: clientId,
        callback: ({ credential }) => {
          setError("");
          signInWithGoogleCredential(credential ?? "").catch((err: Error) => setError(err.message));
        }
      });
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      google.renderButton(slot.current, { theme: dark ? "filled_black" : "outline", size: "large", text: "continue_with", shape: "rectangular", width: 300 });
    }).catch((err: Error) => setError(err.message));
    return () => { cancelled = true; };
  }, [clientId]);

  return (
    <div className="sign-in">
      <div className="sign-in-card">
        <h1>Klui</h1>
        <p className="sign-in-lede">Sign in to continue.</p>
        <div ref={slot} className="google-slot" />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

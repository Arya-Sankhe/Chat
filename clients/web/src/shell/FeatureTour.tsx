import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/app";
import { closeFeatureTour, tryFeature } from "../state/featureTour";

const PHONE = "(max-width: 720px)";

/* The feature tour's dialog. islands/featureTour.js draws everything inside it. */
export function FeatureTour() {
  const open = useApp((s) => s.featureTourOpen);
  const root = useRef<HTMLElement>(null);
  // A closing tour's stop, still waiting out its fade when a new tour opens.
  const pendingStop = useRef<(() => void) | null>(null);
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);

  useEffect(() => {
    const query = matchMedia(PHONE);
    const update = () => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open || !root.current) return;
    const el = root.current;
    pendingStop.current?.();
    let stop: ((restoreFocus?: boolean) => void) | null = null;
    let cancelled = false;
    import("../islands/featureTour.js").then(({ mountFeatureTour }) => {
      if (cancelled) return;
      stop = mountFeatureTour(el, { onTry: tryFeature, onClose: closeFeatureTour });
    }).catch(() => closeFeatureTour());
    return () => {
      cancelled = true;
      // Replaced by a new tour: stop now, and leave focus to the new one.
      if (useApp.getState().featureTourOpen) {
        stop?.(false);
        return;
      }
      // Closed: let the fade-out finish before the scene stops and empties.
      // A tour opening meanwhile stops this one early, leaving focus to the new tour.
      let done = false;
      const finish = (restoreFocus: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (pendingStop.current === early) pendingStop.current = null;
        stop?.(restoreFocus);
        if (!useApp.getState().featureTourOpen) el.innerHTML = "";
      };
      const early = () => finish(false);
      const timer = setTimeout(() => finish(!useApp.getState().featureTourOpen), 300);
      pendingStop.current = early;
    };
  }, [open]);

  return (
    <section
      ref={root}
      className={`feature-dialog${open ? " open" : ""}${phone ? " is-phone" : ""}`}
      id="featureTour"
      role="dialog"
      aria-modal="true"
      aria-labelledby="featureTourTitle"
      aria-hidden={open ? "false" : "true"}
    />
  );
}

// A place in the React page that the engine fills with a node it owns (the chat composer, the
// messages, the document viewer, the lecture audio, a study tool). When React removes the slot,
// the node inside would leave the page with it and the engine could no longer find it, so the
// node goes back to its home first: the composer beside its anchor, the rest after #studyView.
import { useLayoutEffect, useRef, type HTMLAttributes } from "react";

export function Slot(props: HTMLAttributes<HTMLDivElement> & { "data-dojo-studio-slot"?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = ref.current;
    return () => {
      if (!slot?.isConnected) return;
      const study = slot.closest("#studyView") || document.getElementById("studyView");
      for (const child of [...slot.children]) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.matches(".composer-area")) document.getElementById("composerHomeAnchor")?.after(child);
        else if (child.matches("#messages, #documentViewer, .document-viewer")) study?.after(child);
      }
    };
  }, []);
  return <div ref={ref} {...props} />;
}

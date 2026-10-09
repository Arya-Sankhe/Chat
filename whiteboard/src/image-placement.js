import { mutateElement } from "@excalidraw/excalidraw";
import { fitImageSize } from "./image-size.js";
import { createElement as h, useEffect, useRef, useState } from "react";

export function ImagePlacementPreview({ api }) {
  const [pending, setPending] = useState(null);
  const preview = useRef(null);
  useEffect(() => {
    if (!api) return;
    const sync = () => {
      const state = api.getAppState();
      const element = state.activeTool.type === "image" && api.getSceneElements().find((el) => el.id === state.pendingImageElementId);
      const file = element?.fileId && api.getFiles()[element.fileId];
      setPending(element ? { id: element.id, src: file?.dataURL || "", width: element.width * state.zoom.value, height: element.height * state.zoom.value } : null);
    };
    sync();
    return api.onChange(sync);
  }, [api]);
  useEffect(() => {
    if (!pending) return;
    const move = (event) => {
      if (!preview.current) return;
      const canvas = preview.current.closest(".wb-canvas");
      const overCanvas = canvas?.contains(event.target);
      preview.current.hidden = !overCanvas;
      preview.current.style.left = `${event.clientX}px`;
      preview.current.style.top = `${event.clientY}px`;
    };
    document.addEventListener("pointermove", move);
    return () => document.removeEventListener("pointermove", move);
  }, [pending?.id]);
  function sizeImage(event) {
    const element = api.getSceneElements().find((el) => el.id === pending.id);
    if (!element || api.getAppState().pendingImageElementId !== element.id) return;
    const image = event.currentTarget;
    mutateElement(element, fitImageSize(image.naturalWidth, image.naturalHeight, api.getAppState()));
  }
  return pending ? h("div", { ref: preview, className: "wb-image-placement-preview", "aria-hidden": true, hidden: true },
    pending.src ? h("img", { src: pending.src, alt: "", onLoad: sizeImage, style: { width: pending.width || undefined, height: pending.height || undefined } }) : null) : null;
}

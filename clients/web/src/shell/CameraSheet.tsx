/* The in-app camera sheet; state/camera.ts owns the stream. It ends <body>,
   after the phone sheets' backdrop (BodySheets). */
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { cameraEls, closeCameraSheet, switchCamera, takePhoto, useCamera } from "../state/camera";

function trapKeys(event: KeyboardEvent<HTMLElement>) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeCameraSheet();
  }
  if (event.key === "Tab") {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const edge = event.shiftKey ? buttons[0] : buttons.at(-1);
    if (document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
    }
  }
}

export function CameraSheet() {
  const { open, loading, status, shutterEnabled, selfie } = useCamera();
  const closeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (open) closeButton.current?.focus({ preventScroll: true });
  }, [open]);
  return (
    <section id="mobileCameraSheet" className={loading ? "is-loading" : undefined} hidden={!open} role="dialog" aria-modal="true" aria-label="Camera" onKeyDown={trapKeys}>
      <video ref={(el) => { cameraEls.video = el; }} className={selfie ? "camera-selfie" : undefined} autoPlay muted playsInline />
      <span className="camera-loader" aria-hidden="true">
        <svg viewBox="1 3.5 14 8.5" shapeRendering="crispEdges">
          <path fill="#8fd3fb" d="M3 3.5h10v6H3zM1 5.5h2v2H1zM13 5.5h2v2h-2zM5 9.5h1V12H5zM10 9.5h1V12h-1z" />
          <path fill="#16202e" d="M5 5h1v1.5H5zM10 5h1v1.5h-1z" />
        </svg>
      </span>
      <p className="camera-status" role="status" hidden={!status}>{status}</p>
      <div className="camera-controls">
        <button ref={closeButton} type="button" className="camera-close" aria-label="Close camera" onClick={() => closeCameraSheet()}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m14 6-6 6 6 6" />
          </svg>
        </button>
        <button type="button" className="camera-shutter" aria-label="Take photo" disabled={!shutterEnabled} onClick={() => void takePhoto()} />
        <button type="button" className="camera-switch" aria-label="Switch camera" onClick={switchCamera}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 10a8 8 0 0 1 14-5l2 2M20 14A8 8 0 0 1 6 19l-2-2M20 3v4h-4M4 21v-4h4" />
          </svg>
        </button>
      </div>
    </section>
  );
}

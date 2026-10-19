/* The in-app camera sheet (public/js/cameraSheet.js, unchanged as an island).
   It is created once at startup, after the sheet backdrop, so it ends <body>
   as before. */
import { createCameraSheet } from "../islands/cameraSheet.js";
import { showToast } from "./app";

let sheet: ReturnType<typeof createCameraSheet> | null = null;

export function mountCameraSheet() {
  // Photos join the pending attachments with the attachment slice.
  sheet ||= createCameraSheet({ onPhoto: () => {}, onError: showToast });
}

export const closeCameraSheet = () => sheet?.close() ?? false;
export const openCameraSheet = () => sheet?.open();

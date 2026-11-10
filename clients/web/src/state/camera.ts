/* The in-app camera sheet (public/js/cameraSheet.js, unchanged as an island).
   It is created once at startup, after the sheet backdrop, so it ends <body>
   as before. */
import { createCameraSheet } from "../islands/cameraSheet.js";
import { showToast } from "./app";

let sheet: ReturnType<typeof createCameraSheet> | null = null;
// The chat core takes photos as pending attachments once it mounts.
let onPhoto: (file: File) => void = () => {};

export function mountCameraSheet() {
  sheet ||= createCameraSheet({ onPhoto: (file: File) => onPhoto(file), onError: showToast });
}

export function setCameraPhotoHandler(handler: (file: File) => void) {
  onPhoto = handler;
}

export const closeCameraSheet = () => sheet?.close() ?? false;
export const openCameraSheet = () => sheet?.open();

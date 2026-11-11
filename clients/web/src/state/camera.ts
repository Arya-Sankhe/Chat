/* The in-app camera sheet. The camera (and its permission prompt) starts only
   when the sheet opens, and every dismissal releases it, including a permission
   request that resolves after the sheet has already been closed. The sheet
   (shell/CameraSheet.tsx) renders from this store; the stream itself lives here. */
import { create } from "zustand";
import { showToast } from "./app";

type Facing = "environment" | "user";

type CameraState = {
  open: boolean;
  /** Until the first frame plays, the Klui mascot breathes on the dark sheet. */
  loading: boolean;
  /** Only real failures show a status line. */
  status: string;
  shutterEnabled: boolean;
  facing: Facing;
  /** Mirrors the preview once a front camera stream plays. */
  selfie: boolean;
};

export const useCamera = create<CameraState>(() => ({
  open: false,
  loading: false,
  status: "",
  shutterEnabled: false,
  facing: "environment",
  selfie: false
}));

/** The sheet's elements, registered by the component. */
export const cameraEls: { video: HTMLVideoElement | null } = { video: null };

let stream: MediaStream | null = null;
let generation = 0;
let previousFocus: HTMLElement | null = null;
// The chat core takes photos as pending attachments once it mounts.
let onPhoto: (file: File) => void = () => {};

export function setCameraPhotoHandler(handler: (file: File) => void) {
  onPhoto = handler;
}

function stop() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (cameraEls.video) cameraEls.video.srcObject = null;
}

export function closeCameraSheet() {
  if (!useCamera.getState().open) return false;
  generation++;
  stop();
  useCamera.setState({ open: false, loading: false });
  previousFocus?.focus({ preventScroll: true });
  return true;
}

function failureMessage(error: any) {
  return error?.name === "NotAllowedError"
    ? "Camera access is off. Enable it in Android Settings → Apps → Klui → Permissions."
    : "Camera unavailable. Close this sheet and try again.";
}

async function start() {
  const request = ++generation;
  stop();
  useCamera.setState({ shutterEnabled: false, status: "", loading: true });
  try {
    const { facing } = useCamera.getState();
    const incoming = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing } } });
    const video = cameraEls.video;
    if (!useCamera.getState().open || request !== generation || !video) {
      incoming.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = incoming;
    video.srcObject = stream;
    useCamera.setState({ selfie: facing === "user" });
    await video.play();
    if (request !== generation) return;
    useCamera.setState({ loading: false, status: "", shutterEnabled: true });
  } catch (error) {
    if (request !== generation) return;
    stop();
    useCamera.setState({ loading: false, status: failureMessage(error) });
  }
}

export async function openCameraSheet() {
  if (useCamera.getState().open) return;
  previousFocus = document.getElementById("actionMenuButton") || (document.activeElement as HTMLElement | null);
  // The sheet focuses its close button once it shows.
  useCamera.setState({ open: true, facing: "environment" });
  await start();
}

export function switchCamera() {
  useCamera.setState((s) => ({ facing: s.facing === "environment" ? "user" : "environment" }));
  void start();
}

export async function takePhoto() {
  const video = cameraEls.video;
  if (!useCamera.getState().shutterEnabled || !video?.videoWidth) return;
  useCamera.setState({ shutterEnabled: false });
  const request = generation;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (request !== generation) return;
  if (!blob) {
    useCamera.setState({ shutterEnabled: true });
    showToast("Photo could not be captured. Try again.");
    return;
  }
  closeCameraSheet();
  onPhoto(new File([blob], `Klui-photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
}

let installed = false;
/** A hidden page releases the camera. */
export function mountCameraSheet() {
  if (installed) return;
  installed = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) closeCameraSheet();
  });
}

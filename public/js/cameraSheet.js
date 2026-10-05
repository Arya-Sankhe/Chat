// Camera stays inside the app. Every dismissal releases the camera, including
// a permission request that resolves after the sheet has already been closed.
//
// The sheet opens without a visible "Opening camera…" loader: the status line
// stays hidden unless getUserMedia actually fails, and the stream is pre-warmed
// while the attachment sheet is open so the preview is already live on tap.
export function createCameraSheet({ onPhoto, onError }) {
  const sheet = document.createElement("section");
  sheet.id = "mobileCameraSheet";
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Camera");
  sheet.innerHTML = `<video autoplay muted playsinline></video>
    <p class="camera-status" role="status" hidden></p>
    <div class="camera-controls">
      <button type="button" class="camera-close" aria-label="Close camera"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button>
      <button type="button" class="camera-shutter" aria-label="Take photo" disabled></button>
      <button type="button" class="camera-switch" aria-label="Switch camera"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 10a8 8 0 0 1 14-5l2 2M20 14A8 8 0 0 1 6 19l-2-2M20 3v4h-4M4 21v-4h4"/></svg></button>
    </div>`;
  document.body.append(sheet);
  const video = sheet.querySelector("video");
  const status = sheet.querySelector(".camera-status");
  const shutter = sheet.querySelector(".camera-shutter");
  let stream = null;
  let generation = 0;
  let facing = "environment";
  let previousFocus = null;
  let warmupStream = null;
  let warmupFacing = "";
  let warmupPromise = null;
  const stop = () => {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
  };
  const close = () => {
    if (sheet.hidden) return false;
    generation++;
    stop();
    sheet.hidden = true;
    previousFocus?.focus({ preventScroll: true });
    return true;
  };
  const showError = (error) => {
    status.hidden = false;
    status.textContent = error?.name === "NotAllowedError"
      ? "Camera access is off. Enable it in Android Settings → Apps → Klui → Permissions."
      : "Camera unavailable. Close this sheet and try again.";
  };
  const start = async () => {
    const request = ++generation;
    stop();
    shutter.disabled = true;
    // No loading text: the sheet itself is the preview surface. Errors only.
    status.hidden = true;
    status.textContent = "";
    try {
      let incoming = null;
      if (warmupStream && warmupFacing === facing && warmupStream.active !== false) {
        incoming = warmupStream;
        warmupStream = null;
        warmupFacing = "";
      } else {
        warmupStream = null;
        incoming = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing } } });
      }
      if (sheet.hidden || request !== generation) {
        incoming.getTracks().forEach(track => track.stop());
        return;
      }
      stream = incoming;
      video.srcObject = stream;
      video.classList.toggle("camera-selfie", facing === "user");
      await video.play();
      if (request !== generation) return;
      status.hidden = true;
      shutter.disabled = false;
    } catch (error) {
      if (request !== generation) return;
      stop();
      showError(error);
    }
  };
  // Pre-warm the camera while the attachment sheet is open so tapping
  // Camera shows a live preview instantly with no loader flash.
  const preload = () => {
    if (warmupStream || warmupPromise || (stream && !sheet.hidden)) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    const wanted = facing;
    warmupPromise = navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: wanted } } })
      .then((incoming) => {
        warmupPromise = null;
        if (sheet.hidden === false && stream) {
          incoming.getTracks().forEach(track => track.stop());
          return;
        }
        warmupStream = incoming;
        warmupFacing = wanted;
      })
      .catch(() => { warmupPromise = null; });
  };
  sheet.querySelector(".camera-close").addEventListener("click", close);
  sheet.querySelector(".camera-switch").addEventListener("click", () => {
    facing = facing === "environment" ? "user" : "environment";
    warmupStream?.getTracks().forEach(track => track.stop());
    warmupStream = null;
    void start();
  });
  shutter.addEventListener("click", async () => {
    if (shutter.disabled || !video.videoWidth) return;
    shutter.disabled = true;
    const request = generation;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .92));
    if (request !== generation) return;
    if (!blob) { shutter.disabled = false; onError("Photo could not be captured. Try again."); return; }
    close();
    onPhoto(new File([blob], `Klui-photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) close(); });
  sheet.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      const buttons = [...sheet.querySelectorAll("button:not(:disabled)")];
      const edge = event.shiftKey ? buttons[0] : buttons.at(-1);
      if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? buttons.at(-1) : buttons[0]).focus(); }
    }
  });
  return { close, preload, async open() {
    if (!sheet.hidden) return;
    previousFocus = document.getElementById("actionMenuButton") || document.activeElement;
    facing = "environment";
    sheet.hidden = false;
    sheet.querySelector(".camera-close").focus({ preventScroll: true });
    await start();
  } };
}

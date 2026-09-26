import { createStudySource } from "./api.js";
import { readClipboardText } from "./platform/index.js";
import {
  createLectureRecorder,
  deleteSavedRecording,
  listSavedRecordings,
  loadSavedRecording,
  recordingExtension,
  recordingSupported
} from "./studyRecorder.js";

const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const upload = svg('<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>');
const globe = svg('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>');
const text = svg('<path d="M4 5h16M8 5v15m8-11h5m-5 5h5m-5 5h5M5 20h6"/>');
const paste = svg('<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 5V3H4v14h1"/>');
const mic = svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>');
const wave = svg('<path d="M3 12h2m3-5v10m4-13v16m4-11v6m3-3h2"/>');
const pauseIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/></svg>';
const playIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.9l10-6.4a1 1 0 0 0 0-1.8l-10-6.4A1 1 0 0 0 8 5.6Z"/></svg>';
const stopIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
const LEVEL_BARS = 32;
export const AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.wav,.webm,.ogg,.oga,.opus,.flac,.aac,.aif,.aiff,.caf";

export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(hours ? 2 : 1, "0");
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${minutes}:${secs}` : `${minutes}:${secs}`;
}

function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function createStudySourceDialog({ state, uploadFiles, uploadAudio, busyRecordingIds = () => [], onCreated, showToast }) {
  const dialog = document.createElement("dialog");
  dialog.className = "dojo-source-dialog";
  dialog.setAttribute("aria-label", "Add sources");
  dialog.innerHTML = `
    <header class="dojo-source-dialog-head"><span class="dojo-source-brand">What are we learning today?</span><button type="button" class="study-icon-btn" data-source-close aria-label="Close add sources">${svg('<path d="m6 6 12 12M18 6 6 18"/>')}</button></header>
    <button type="button" class="dojo-source-upload" data-source-files>
      <span class="dojo-upload-symbol">${upload}</span><strong>Drop your files here</strong>
      <span>or <u>choose files</u> to get started</span><small>PDF, Word, slides, spreadsheets, images & audio</small>
    </button>
    <div class="dojo-source-divider"><span>Or add something else</span></div>
    <div class="dojo-source-options">
      <button type="button" data-source-kind="website" aria-expanded="false" aria-controls="dojo-source-website">${globe}<span><strong>Website</strong><small>A page worth keeping</small></span><span aria-hidden="true">↗</span></button>
      <button type="button" data-source-kind="text" aria-expanded="false" aria-controls="dojo-source-text">${text}<span><strong>Paste text</strong><small>Your words, notes, anything</small></span><span aria-hidden="true">+</span></button>
      <button type="button" class="dojo-source-audio-option" data-source-kind="audio" aria-expanded="false" aria-controls="dojo-source-audio">${mic}<span><strong>Audio</strong><small>Record a lecture or upload a recording</small></span><span class="dojo-source-audio-live" data-audio-live hidden><span class="dojo-rec-mini" data-audio-live-bars aria-hidden="true">${"<i></i>".repeat(5)}</span><b data-audio-live-time>0:00</b></span><span aria-hidden="true">+</span></button>
    </div>
    <form data-source-form="website" id="dojo-source-website" class="dojo-source-form" hidden>
      <label for="dojo-source-url">Website link</label>
      <div class="dojo-source-input-row"><input id="dojo-source-url" name="url" placeholder="https://example.com/article" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="4096" required><button type="button" data-source-paste>${paste}<span>Paste</span></button></div>
      <p class="dojo-source-hint">We’ll save the readable content of this page.</p>
      <button class="dojo-source-submit" type="submit">Add website <span aria-hidden="true">↗</span></button>
    </form>
    <form data-source-form="text" id="dojo-source-text" class="dojo-source-form" hidden>
      <label for="dojo-source-name">Title <span class="dojo-source-optional">optional</span></label>
      <input id="dojo-source-name" name="title" placeholder="e.g. Biology lecture notes" maxlength="120">
      <div class="dojo-source-text-label"><label for="dojo-source-content">Your text</label><button type="button" data-source-paste>${paste}<span>Paste</span></button></div>
      <textarea id="dojo-source-content" name="text" placeholder="Paste something you want to learn…" maxlength="200000" rows="4" required></textarea>
      <div class="dojo-source-text-footer"><span data-source-count>0 / 200,000</span><button class="dojo-source-submit" type="submit">Add text <span aria-hidden="true">+</span></button></div>
    </form>
    <section data-source-form="audio" id="dojo-source-audio" class="dojo-source-form dojo-audio-panel" aria-label="Audio" hidden></section>
    <input type="file" data-audio-input accept="${AUDIO_ACCEPT}" multiple hidden>
    <p class="dojo-source-feedback" role="status" aria-live="polite" hidden></p>`;
  document.body.append(dialog);

  // Stays on screen while a recording runs and the dialog is closed.
  const pill = document.createElement("div");
  pill.className = "dojo-rec-pill";
  pill.hidden = true;
  pill.setAttribute("role", "region");
  pill.setAttribute("aria-label", "Recording in progress");
  pill.innerHTML = `
    <button type="button" class="dojo-rec-pill-open" data-pill-open aria-label="Open recorder"><span class="dojo-rec-dot" aria-hidden="true"></span><span class="dojo-rec-pill-copy"><strong data-pill-state>Recording</strong><time data-pill-time>0:00</time></span><span class="dojo-rec-pill-bars" aria-hidden="true">${"<i></i>".repeat(5)}</span></button>
    <button type="button" class="dojo-rec-pill-btn" data-pill-pause aria-label="Pause recording" title="Pause">${pauseIcon}</button>
    <button type="button" class="dojo-rec-pill-btn is-stop" data-pill-stop aria-label="Stop recording" title="Stop">${stopIcon}</button>`;
  document.body.append(pill);

  let courseId = "";
  let busy = false;
  let dragDepth = 0;
  let frame = 0;
  let previewUrl = "";
  let recoverable = [];
  const feedback = dialog.querySelector(".dojo-source-feedback");
  const forms = [...dialog.querySelectorAll("[data-source-form]")];
  const switches = [...dialog.querySelectorAll("[data-source-kind]")];
  const audioPanel = dialog.querySelector("#dojo-source-audio");
  const audioInput = dialog.querySelector("[data-audio-input]");

  const recorder = createLectureRecorder({
    onChange(next) {
      if (recorder.error) message(recorder.error, true);
      renderAudioPanel();
      syncLive();
      if (next === "stopped" && !dialog.open && courseId) openAudio();
    }
  });

  function message(value, error = false) {
    feedback.hidden = !value;
    feedback.textContent = value;
    feedback.classList.toggle("is-error", error);
  }
  function setBusy(value) {
    busy = value;
    state.studyUploading = value;
    dialog.setAttribute("aria-busy", String(value));
    dialog.querySelectorAll("button, input, textarea").forEach(el => { el.disabled = value; });
  }
  function chooseFiles(files) {
    if (busy || !files?.length) return;
    dialog.close();
    void uploadFiles(files);
  }
  function showPanel(kind) {
    switches.forEach(button => button.setAttribute("aria-expanded", String(button.dataset.sourceKind === kind)));
    forms.forEach(form => { form.hidden = form.dataset.sourceForm !== kind; });
    dialog.dataset.panel = kind || "";
  }
  function openAudio() {
    if (!dialog.open) api.open(null, { panel: "audio" });
    else showPanel("audio");
    renderAudioPanel();
  }

  /* ---------- Audio panel ---------- */

  function levelBars() {
    return `<div class="dojo-rec-levels" data-rec-levels aria-hidden="true">${"<i></i>".repeat(LEVEL_BARS)}</div>`;
  }

  function recoveryMarkup() {
    const hidden = new Set(busyRecordingIds());
    const rows = recoverable.filter(row => !hidden.has(row.id) && row.id !== recorder.result?.id);
    if (!rows.length || recorder.active) return "";
    return `<div class="dojo-rec-recover" role="note">${rows.slice(0, 3).map(row => `
      <div class="dojo-rec-recover-row"><span class="dojo-rec-recover-icon">${wave}</span><span class="dojo-rec-recover-copy"><strong>Unsaved recording found</strong><small>${escape(row.title || "Recording")} · ${formatClock(row.durationSeconds)}</small></span>
      <button type="button" class="dojo-rec-ghost" data-rec-forget="${escape(row.id)}">Discard</button><button type="button" class="dojo-rec-soft" data-rec-recover="${escape(row.id)}">Review</button></div>`).join("")}</div>`;
  }

  function renderAudioPanel() {
    if (!audioPanel) return;
    const status = recorder.state;
    if (previewUrl && status !== "stopped") { stopListening(); URL.revokeObjectURL(previewUrl); previewUrl = ""; }
    if (status === "recording" || status === "paused" || status === "requesting" || status === "finishing") {
      const paused = status === "paused";
      audioPanel.innerHTML = `
        <div class="dojo-rec-live${paused ? " is-paused" : ""}${status === "requesting" ? " is-waiting" : ""}">
          <div class="dojo-rec-head"><span class="dojo-rec-dot" aria-hidden="true"></span><span data-rec-label>${status === "requesting" ? "Waiting for microphone…" : paused ? "Paused" : "Recording"}</span></div>
          <time class="dojo-rec-time" data-rec-time aria-live="off">${formatClock(recorder.elapsed)}</time>
          ${levelBars()}
          <div class="dojo-rec-controls">
            <button type="button" class="dojo-rec-btn" data-rec-pause ${status === "requesting" ? "disabled" : ""}>${paused ? playIcon : pauseIcon}<span>${paused ? "Continue" : "Pause"}</span></button>
            <button type="button" class="dojo-rec-btn is-stop" data-rec-stop ${status === "requesting" ? "disabled" : ""}>${stopIcon}<span>Stop &amp; review</span></button>
          </div>
          <p class="dojo-rec-note${recorder.persisted ? "" : " is-warning"}">${recorder.persisted
            ? "Saved on this device as you go. You can close this window — recording keeps running."
            : "This browser couldn’t save a backup, so keep this tab open until the recording is added."}</p>
        </div>`;
      return;
    }
    if (status === "stopped" && recorder.result) {
      const result = recorder.result;
      previewUrl ||= URL.createObjectURL(result.blob);
      const sizeMb = result.blob.size / (1024 * 1024);
      audioPanel.innerHTML = `
        <div class="dojo-rec-review">
          <div class="dojo-rec-review-head"><span class="dojo-rec-review-icon">${wave}</span><span><strong>Recording ready</strong><small>${formatClock(result.durationSeconds)} · ${sizeMb < 1 ? "<1" : sizeMb.toFixed(1)} MB · ${result.persisted === false ? "not backed up — add it before closing this tab" : "kept on this device until it’s added"}</small></span></div>
          <label for="dojo-rec-title">Title</label>
          <input id="dojo-rec-title" data-rec-title maxlength="120" value="${escape(result.title || "")}" placeholder="e.g. Lecture 4 — Cell signalling">
          <div class="dojo-rec-listen"><button type="button" class="dojo-rec-listen-btn" data-rec-listen aria-label="Listen back">${playIcon}</button><span class="dojo-rec-listen-track"><i data-rec-listen-bar></i></span><time data-rec-listen-time>0:00 / ${formatClock(result.durationSeconds)}</time></div>
          <div class="dojo-rec-actions"><button type="button" class="dojo-rec-ghost" data-rec-discard>Discard</button><button type="button" class="dojo-source-submit is-audio" data-rec-transcribe>Add audio <span aria-hidden="true">→</span></button></div>
        </div>`;
      return;
    }
    const supported = recordingSupported();
    audioPanel.innerHTML = `
      ${recoveryMarkup()}
      <div class="dojo-audio-choices">
        <button type="button" class="dojo-audio-choice is-record" data-rec-start ${supported ? "" : "disabled"}><span class="dojo-audio-choice-icon">${mic}</span><strong>Record now</strong><small>${supported ? "Capture a lecture live" : "Not supported in this browser"}</small></button>
        <button type="button" class="dojo-audio-choice" data-audio-pick><span class="dojo-audio-choice-icon">${upload}</span><strong>Upload audio</strong><small>MP3, M4A, WAV, WebM · up to 4 h</small></button>
      </div>
      <p class="dojo-source-hint">English lectures work best. Transcripts get timestamps you can tap to replay.</p>`;
  }

  // Recorded WebM has no duration header, so the native player can't show one; this small
  // player uses the length the recorder measured instead.
  let listen = null;
  function stopListening() {
    if (!listen) return;
    listen.audio.pause();
    cancelAnimationFrame(listen.frame);
    listen = null;
  }
  function toggleListen() {
    const result = recorder.result;
    const button = audioPanel.querySelector("[data-rec-listen]");
    if (!result || !button) return;
    if (listen && !listen.audio.paused) {
      listen.audio.pause();
      button.innerHTML = playIcon;
      button.setAttribute("aria-label", "Listen back");
      return;
    }
    if (!listen) {
      const audio = new Audio(previewUrl);
      listen = { audio, frame: 0 };
      const total = result.durationSeconds || 1;
      const paint = () => {
        if (!listen) return;
        const bar = audioPanel.querySelector("[data-rec-listen-bar]");
        const time = audioPanel.querySelector("[data-rec-listen-time]");
        if (bar) bar.style.transform = `scaleX(${Math.min(1, audio.currentTime / total).toFixed(4)})`;
        if (time) time.textContent = `${formatClock(audio.currentTime)} / ${formatClock(total)}`;
        if (!audio.paused) listen.frame = requestAnimationFrame(paint);
      };
      audio.addEventListener("play", paint);
      audio.addEventListener("ended", () => {
        const btn = audioPanel.querySelector("[data-rec-listen]");
        if (btn) { btn.innerHTML = playIcon; btn.setAttribute("aria-label", "Listen back"); }
        stopListening();
        const bar = audioPanel.querySelector("[data-rec-listen-bar]");
        if (bar) bar.style.transform = "scaleX(0)";
      });
    }
    void listen.audio.play();
    button.innerHTML = pauseIcon;
    button.setAttribute("aria-label", "Pause");
  }

  function paintLevels(root, count) {
    const bars = root?.querySelectorAll("i");
    if (!bars?.length) return;
    // Each bar is a real frequency band from the mic; silence leaves them flat.
    const values = recorder.levels(bars.length);
    const loud = recorder.level();
    bars.forEach((bar, index) => {
      const height = Math.max(0.07, Math.min(1, values[index] * 0.8 + loud * 0.35));
      bar.style.transform = `scaleY(${height.toFixed(3)})`;
    });
    root.classList.toggle("is-hearing", loud > 0.06);
    return count;
  }

  function tick() {
    frame = 0;
    if (!recorder.active) return;
    const time = formatClock(recorder.elapsed);
    if (dialog.open) {
      const node = audioPanel.querySelector("[data-rec-time]");
      if (node && node.textContent !== time) node.textContent = time;
      paintLevels(audioPanel.querySelector("[data-rec-levels]"));
    }
    const live = dialog.querySelector("[data-audio-live-time]");
    if (live && live.textContent !== time) live.textContent = time;
    if (dialog.open) paintLevels(dialog.querySelector("[data-audio-live-bars]"));
    if (!pill.hidden) {
      const node = pill.querySelector("[data-pill-time]");
      if (node.textContent !== time) node.textContent = time;
      paintLevels(pill.querySelector(".dojo-rec-pill-bars"));
    }
    frame = requestAnimationFrame(tick);
  }

  function syncLive() {
    const active = recorder.active || recorder.state === "requesting";
    const live = dialog.querySelector("[data-audio-live]");
    if (live) live.hidden = !recorder.active;
    pill.hidden = !(recorder.active && !dialog.open);
    pill.classList.toggle("is-paused", recorder.state === "paused");
    pill.querySelector("[data-pill-state]").textContent = recorder.state === "paused" ? "Paused" : "Recording";
    const pauseBtn = pill.querySelector("[data-pill-pause]");
    pauseBtn.innerHTML = recorder.state === "paused" ? playIcon : pauseIcon;
    pauseBtn.setAttribute("aria-label", recorder.state === "paused" ? "Continue recording" : "Pause recording");
    pauseBtn.title = recorder.state === "paused" ? "Continue" : "Pause";
    if (active && !frame) frame = requestAnimationFrame(tick);
  }

  async function refreshRecoverable() {
    recoverable = await listSavedRecordings(courseId).catch(() => []);
    if (!recorder.active && recorder.state !== "stopped" && dialog.dataset.panel === "audio") renderAudioPanel();
    // Surface a leftover recording even if the Audio card isn't open yet.
    const hidden = new Set([...busyRecordingIds(), recorder.result?.id].filter(Boolean));
    const option = dialog.querySelector("[data-source-kind=audio]");
    option?.classList.toggle("has-recovery", recoverable.some(row => !hidden.has(row.id)));
  }

  async function transcribeRecording() {
    const result = recorder.result;
    if (!result) return;
    const title = (audioPanel.querySelector("[data-rec-title]")?.value || "").trim() || result.title;
    const file = new File([result.blob], `${title.replace(/[\\/:*?"<>|\x00-\x1f]/g, " ").trim() || "Recording"}.${recordingExtension(result.mimeType)}`, { type: result.mimeType.split(";")[0] });
    const target = result.courseId || courseId;
    // The saved copy stays in IndexedDB until the server confirms it has the file.
    recorder.release(false);
    dialog.close();
    void uploadAudio(file, { title, durationSeconds: result.durationSeconds, source: "recording", recordingId: result.id, backedUp: result.persisted !== false, courseId: target });
  }

  window.addEventListener("beforeunload", event => {
    if (!recorder.active) return;
    event.preventDefault();
    event.returnValue = "";
  });

  pill.addEventListener("click", async event => {
    if (event.target.closest("[data-pill-pause]")) {
      if (recorder.state === "paused") recorder.resume(); else recorder.pause();
      return;
    }
    if (event.target.closest("[data-pill-stop]")) {
      await recorder.stop();
      return;
    }
    if (event.target.closest("[data-pill-open]")) {
      if (!state.activeCourseId || state.activeCourseId !== recorder.courseId) courseId = recorder.courseId;
      openAudio();
    }
  });

  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    syncLive();
    stopListening();
  });
  dialog.addEventListener("keydown", () => { dialog.dataset.motion = "off"; });
  dialog.addEventListener("pointerdown", () => { dialog.dataset.motion = "on"; });
  // Close on a click outside the card (the backdrop). Both press and release must land there,
  // so a text selection dragged out of a field doesn't dismiss the dialog.
  const onBackdrop = event => {
    if (event.target !== dialog) return false;
    const box = dialog.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  };
  let pressedBackdrop = false;
  dialog.addEventListener("pointerdown", event => { pressedBackdrop = onBackdrop(event); });
  dialog.addEventListener("click", async event => {
    if (busy) return;
    if (pressedBackdrop && onBackdrop(event)) return dialog.close();
    if (event.target.closest("[data-source-close]")) return dialog.close();
    if (event.target.closest("[data-source-files]")) {
      // Keep the existing file input, accept list, and upload pipeline.
      document.querySelector("#studyFileInput")?.click();
      return;
    }
    if (event.target.closest("[data-audio-pick]")) { audioInput.click(); return; }
    if (event.target.closest("[data-rec-start]")) { message(""); await recorder.start(courseId); return; }
    if (event.target.closest("[data-rec-pause]")) { if (recorder.state === "paused") recorder.resume(); else recorder.pause(); return; }
    if (event.target.closest("[data-rec-stop]")) { await recorder.stop(); return; }
    if (event.target.closest("[data-rec-discard]")) {
      stopListening();
      await recorder.discard();
      await refreshRecoverable();
      showToast("Recording discarded.");
      return;
    }
    if (event.target.closest("[data-rec-transcribe]")) { stopListening(); await transcribeRecording(); return; }
    if (event.target.closest("[data-rec-listen]")) { toggleListen(); return; }
    const recover = event.target.closest("[data-rec-recover]");
    if (recover) {
      const saved = await loadSavedRecording(recover.dataset.recRecover);
      if (!saved) { message("That recording could not be read. It may have been cleared by the browser.", true); return; }
      recorder.adopt(saved);
      void refreshRecoverable();
      return;
    }
    const forget = event.target.closest("[data-rec-forget]");
    if (forget) {
      await deleteSavedRecording(forget.dataset.recForget);
      await refreshRecoverable();
      return;
    }
    const option = event.target.closest("[data-source-kind]");
    if (option) {
      const kind = option.dataset.sourceKind;
      showPanel(kind);
      message("");
      if (kind === "audio") { renderAudioPanel(); void refreshRecoverable(); return; }
      dialog.querySelector(kind === "text" ? "textarea" : "[name=url]").focus();
      return;
    }
    const button = event.target.closest("[data-source-paste]");
    if (button) {
      const form = button.closest("form");
      const field = form.querySelector(form.dataset.sourceForm === "text" ? "textarea" : "[name=url]");
      button.disabled = true;
      try {
        const value = await readClipboardText();
        if (!dialog.open || busy) return;
        if (!value.trim()) throw new Error("Your clipboard has no text. Paste or type into the field.");
        if (value.length > field.maxLength) throw new Error(`Use ${field.maxLength.toLocaleString()} characters or fewer.`);
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        message("");
      } catch (error) {
        message(error?.name === "NotAllowedError" || error instanceof TypeError ? "Clipboard access is unavailable. Paste directly into the field." : error.message, true);
      } finally {
        button.disabled = busy;
        if (dialog.open && !busy) field.focus({ preventScroll: true });
      }
    }
  });
  audioInput.addEventListener("change", () => {
    const files = [...(audioInput.files || [])];
    audioInput.value = "";
    chooseFiles(files);
  });
  dialog.addEventListener("input", event => {
    if (event.target.name === "text") dialog.querySelector("[data-source-count]").textContent = `${event.target.value.length.toLocaleString()} / 200,000`;
    if (event.target.matches("[data-rec-title]")) recorder.setTitle(event.target.value.trim());
  });
  forms.filter(form => form.tagName === "FORM").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const body = { kind: form.dataset.sourceForm, ...Object.fromEntries(new FormData(form)) };
    const session = state.session;
    setBusy(true);
    message(body.kind === "website" ? "Reading the page and adding your source…" : "Adding your text…");
    try {
      const result = await createStudySource(session, courseId, body);
      dialog.close();
      await onCreated(courseId, result.document);
      showToast("Source added.");
    } catch (error) {
      message(error.message || "This source could not be added. Please try again.", true);
    } finally {
      setBusy(false);
      if (dialog.open) form.querySelector("[type=submit]").focus({ preventScroll: true });
    }
  }));
  dialog.addEventListener("dragover", event => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? "none" : "copy";
  });
  dialog.addEventListener("dragenter", event => {
    if (!event.dataTransfer?.types?.includes("Files") || busy) return;
    event.preventDefault();
    dragDepth++;
    dialog.classList.add("is-dragging");
  });
  dialog.addEventListener("dragleave", () => {
    if (--dragDepth <= 0) { dragDepth = 0; dialog.classList.remove("is-dragging"); }
  });
  dialog.addEventListener("drop", event => {
    event.preventDefault();
    dragDepth = 0;
    dialog.classList.remove("is-dragging");
    chooseFiles(event.dataTransfer?.files);
  });

  const api = {
    open(event, { panel = "" } = {}) {
      if (state.studyUploading) return;
      // A live or unsent recording belongs to the course it was made in.
      const pinned = (recorder.active || recorder.state === "stopped") && recorder.courseId;
      if (!pinned && !state.activeCourseId) return;
      courseId = pinned || state.activeCourseId;
      forms.forEach(form => { if (form.tagName === "FORM") form.reset(); });
      const kind = panel || (recorder.active || recorder.state === "stopped" ? "audio" : "");
      showPanel(kind);
      dialog.querySelector("[data-source-count]").textContent = "0 / 200,000";
      message("");
      dialog.dataset.motion = event?.detail ? "on" : "off";
      dialog.showModal();
      syncLive();
      void refreshRecoverable();
      if (kind === "audio") renderAudioPanel();
    },
    openAudio() { api.open(null, { panel: "audio" }); },
    close() { if (dialog.open) dialog.close(); },
    dismiss() {
      if (!dialog.open) return false;
      if (!busy) dialog.close();
      return true;
    },
    get recording() { return recorder.active; }
  };
  return api;
}

import { createStudySource } from "./api.js";
import { readClipboardText } from "./platform/index.js";

const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const upload = svg('<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>');
const globe = svg('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>');
const text = svg('<path d="M4 5h16M8 5v15m8-11h5m-5 5h5m-5 5h5M5 20h6"/>');
const paste = svg('<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 5V3H4v14h1"/>');

export function createStudySourceDialog({ state, uploadFiles, onCreated, showToast }) {
  const dialog = document.createElement("dialog");
  dialog.className = "dojo-source-dialog";
  dialog.setAttribute("aria-label", "Add sources");
  dialog.innerHTML = `
    <header class="dojo-source-dialog-head"><span class="dojo-source-brand">What are we learning today?</span><button type="button" class="study-icon-btn" data-source-close aria-label="Close add sources">${svg('<path d="m6 6 12 12M18 6 6 18"/>')}</button></header>
    <button type="button" class="dojo-source-upload" data-source-files>
      <span class="dojo-upload-symbol">${upload}</span><strong>Drop your files here</strong>
      <span>or <u>choose files</u> to get started</span><small>PDF, Word, slides, spreadsheets & images</small>
    </button>
    <div class="dojo-source-divider"><span>Or add something else</span></div>
    <div class="dojo-source-options">
      <button type="button" data-source-kind="website" aria-expanded="false" aria-controls="dojo-source-website">${globe}<span><strong>Website</strong><small>A page worth keeping</small></span><span aria-hidden="true">↗</span></button>
      <button type="button" data-source-kind="text" aria-expanded="false" aria-controls="dojo-source-text">${text}<span><strong>Paste text</strong><small>Your words, notes, anything</small></span><span aria-hidden="true">+</span></button>
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
    <p class="dojo-source-feedback" role="status" aria-live="polite" hidden></p>`;
  document.body.append(dialog);
  let courseId = "";
  let busy = false;
  let dragDepth = 0;
  const feedback = dialog.querySelector(".dojo-source-feedback");
  const forms = [...dialog.querySelectorAll("form")];
  const switches = [...dialog.querySelectorAll("[data-source-kind]")];

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
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
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
    const option = event.target.closest("[data-source-kind]");
    if (option) {
      const kind = option.dataset.sourceKind;
      switches.forEach(button => button.setAttribute("aria-expanded", String(button === option)));
      forms.forEach(form => { form.hidden = form.dataset.sourceForm !== kind; });
      message("");
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
  dialog.addEventListener("input", event => {
    if (event.target.name === "text") dialog.querySelector("[data-source-count]").textContent = `${event.target.value.length.toLocaleString()} / 200,000`;
  });
  forms.forEach(form => form.addEventListener("submit", async event => {
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
  return {
    open(event) {
      if (state.studyUploading || !state.activeCourseId) return;
      courseId = state.activeCourseId;
      forms.forEach(form => { form.reset(); form.hidden = true; });
      switches.forEach(button => button.setAttribute("aria-expanded", "false"));
      dialog.querySelector("[data-source-count]").textContent = "0 / 200,000";
      message("");
      dialog.dataset.motion = event?.detail ? "on" : "off";
      dialog.showModal();
    },
    close() { if (dialog.open) dialog.close(); },
    dismiss() {
      if (!dialog.open) return false;
      if (!busy) dialog.close();
      return true;
    }
  };
}

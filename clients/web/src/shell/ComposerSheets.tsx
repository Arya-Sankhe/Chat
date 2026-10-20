/* The composer's popovers. On phones (setupMobileLayout in public/js/app.js)
   the mode picker, the + menu, the styles menu and the slide theme picker move
   to the end of <body> to open as bottom sheets, each with a header; they are
   rendered there through BodySheets and inline otherwise. */
import { createPortal } from "react-dom";
import { normalizeWritingStyle, TOP_BAR_MODE_LABELS, topBarMode, WRITING_STYLE_LABELS } from "@klui/shared";
import { applyNativeTopBarMode, setResearchMode, closeActionMenu, closeMobileModeSheet, closeTopNativeSurface, openActionMenuMore, openActionMenuRoot, openWritingStyleMenu, setWritingStyle, toggleMobileModeSheet, updateSetting, useApp } from "../state/app";
import { openCameraSheet } from "../state/camera";
import { homeModes } from "../state/homeModes";
import { cx } from "./cx";

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mobile-sheet-header">
      <button type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>×</button>
      <strong>{title}</strong>
    </div>
  );
}

export function NativeModeDropdown() {
  const mode = useApp((s) => topBarMode(s.settings));
  const open = useApp((s) => s.modeSheetOpen);
  const close = closeMobileModeSheet;
  return (
        <div className={cx("native-mobile-mode-dropdown", { hidden: !open })} id="nativeMobileModeDropdown" role="listbox" aria-label="Mode">
          <SheetHeader title="Select model" onClose={close} />
          <button className={cx("native-mobile-mode-item", { "is-active": mode === "nitro" })} onClick={() => { applyNativeTopBarMode("nitro"); close(); }} type="button" data-mode="nitro" role="option" aria-selected={mode === "nitro"}>
            <span className="mode-dot mode-dot-nitro" aria-hidden="true" />
            {" "}
            <span>Nitro</span>
          </button>
          {" "}
          <button className={cx("native-mobile-mode-item", { "is-active": mode === "thinking" })} onClick={() => { applyNativeTopBarMode("thinking"); close(); }} type="button" data-mode="thinking" role="option" aria-selected={mode === "thinking"}>
            <span className="mode-dot mode-dot-thinking" aria-hidden="true" />
            {" "}
            <span>Think</span>
          </button>
          {" "}
          <button className={cx("native-mobile-mode-item", { "is-active": mode === "pro" })} onClick={() => { applyNativeTopBarMode("pro"); close(); }} type="button" data-mode="pro" role="option" aria-selected={mode === "pro"}>
            <span className="mode-dot mode-dot-pro" aria-hidden="true" />
            {" "}
            <span>Pro</span>
          </button>
          {" "}
          <button className={cx("native-mobile-mode-item", { "is-active": mode === "compare" })} onClick={() => { applyNativeTopBarMode("compare"); close(); }} type="button" data-mode="compare" role="option" aria-selected={mode === "compare"}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="7" height="16" rx="2" />
              <rect x="14" y="4" width="7" height="16" rx="2" />
            </svg>
            {" "}
            <span>Compare</span>
          </button>
          {" "}
          <button className={cx("native-mobile-mode-item", { "is-active": mode === "council" })} onClick={() => { applyNativeTopBarMode("council"); close(); }} type="button" data-mode="council" role="option" aria-selected={mode === "council"}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 21h7l-1-5a3 3 0 00-3-3H4a3 3 0 00-3 3l-1 5h2" />
              <circle cx="5" cy="7" r="3" />
              <path d="M15 21h7l-1-5a3 3 0 00-3-3h-1a3 3 0 00-3 3l-1 5h2" />
              <circle cx="18" cy="7" r="3" />
              <circle cx="12" cy="3.5" r="2" />
              <path d="M11 12h2v3h-2z" />
            </svg>
            {" "}
            <span>Council</span>
          </button>
        </div>
  );
}

/** The phone top bar's mode button; desktop keeps it in the header, phones in the composer. */
export function NativeModeWrap() {
  const mobile = useApp((s) => s.mobile);
  const mode = useApp((s) => topBarMode(s.settings));
  const open = useApp((s) => s.modeSheetOpen);
  return (
    <div className="native-mobile-mode-wrap">
      <button className="native-mobile-mode-btn" id="nativeMobileModeButton" type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="Choose mode" data-mode={mode} onClick={toggleMobileModeSheet}>
        <span className="native-mobile-mode-label" id="nativeMobileModeLabel">{TOP_BAR_MODE_LABELS[mode]}</span>
        {" "}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {" "}
      {!mobile && <NativeModeDropdown />}
    </div>
  );
}

/* Phones pick photos and documents separately: Photos limits the picker to
   images, and the Files item drops images from it. */
const FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,text/tab-separated-values,.pdf,.docx,.xlsx,.pptx,.csv,.tsv";
const DOCUMENT_ACCEPT = FILE_ACCEPT.split(",").filter((type) => !type.startsWith("image/")).join(",");

function fileInput() {
  return document.getElementById("imageFileInput") as HTMLInputElement | null;
}

function openPhotoPicker(disabled: boolean) {
  const input = fileInput();
  if (disabled || !input) return;
  input.accept = "image/*";
  input.click();
}

export function ActionMenu() {
  const mobile = useApp((s) => s.mobile);
  const open = useApp((s) => s.actionMenu === "root" || s.actionMenu === "more");
  // The style menu opens from More, which stays the (hidden) menu's page.
  const page = useApp((s) => (s.actionMenu === "more" || s.actionMenu === "style" ? "more" : "root"));
  const researchAvailable = useApp((s) => Boolean((s.config as any)?.services?.research));
  const researchMode = useApp((s) => s.researchMode);
  const style = useApp((s) => normalizeWritingStyle(s.settings.writingStyle));
  const running = useApp((s) => s.running);
  // renderWebSearchToggle(), from the first renderShell(): until then the markup's own text.
  const webSearchAvailable = useApp((s) => Boolean((s.config as any)?.services?.websearch));
  const webSearchOn = useApp((s) => s.settings.webSearchMode !== "off");
  const rendered = useApp((s) => s.shellRender > 0);
  const webSearch = !rendered || !webSearchAvailable
    ? { shown: false, pressed: true, label: "Web search auto", title: "Web search: Auto — the model searches the web when needed. Click to turn off." }
    : {
        shown: true,
        pressed: webSearchOn,
        label: webSearchOn ? "Web search auto (on)" : "Web search off",
        title: webSearchOn
          ? "Web search: Auto — the model searches the web when it needs to. Click to disable."
          : "Web search: Off — click to let the model search when needed."
      };
  const imageDisabled = useApp((s) => s.imageToggleDisabled);
  const close = closeActionMenu;
  return (
        <div className={cx("composer-action-menu", { hidden: !open })} id="composerActionMenu" role="menu" aria-label="More actions" data-page={page}>
          <SheetHeader title="Add to chat" onClose={close} />
          <button className="composer-action-menu-item" type="button" id="imageToggle" role="menuitem" data-menu-page="root" disabled={imageDisabled} onClick={() => { const input = fileInput(); if (!input) return; input.accept = mobile ? DOCUMENT_ACCEPT : FILE_ACCEPT; closeActionMenu(); input.click(); }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.49" />
            </svg>
            {" "}
            <span>{mobile ? "Files" : "Add photos & files"}</span>
          </button>
          {" "}
          <button className={cx("composer-action-menu-item mobile-camera-action", { hidden: !mobile })} type="button" id="cameraAction" onClick={() => { closeActionMenu(); void openCameraSheet(); }} role="menuitem" data-menu-page="root">
            <svg width="19" height="19" viewBox="-1 -1 26 26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            {" "}
            <span>Camera</span>
          </button>
          {" "}
          <button className={cx("composer-action-menu-item", { hidden: !researchAvailable, active: researchMode })} type="button" id="deepResearchToggle" role="menuitem" aria-pressed={researchMode} data-menu-page="root" disabled={running || !researchAvailable} onClick={(event) => { event.stopPropagation(); setResearchMode(!researchMode); }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 14.2 16.6 5.6a1.05 1.05 0 0 1 1.48 0l1.15 1.15a1.05 1.05 0 0 1 0 1.48L10.6 16.8z" />
              <path d="M6.2 15.6 8.4 13.4" />
              <path d="M6.5 16.2h11a1 1 0 0 1 1 1V19H5.5v-1.8a1 1 0 0 1 1-1z" />
              <path d="M4.5 19.5h15a1 1 0 0 1 1 1V22H3.5v-1.5a1 1 0 0 1 1-1z" />
            </svg>
            {" "}
            <span>Deep research</span>
          </button>
          {" "}
          <button className="composer-action-menu-item" type="button" id="actionMenuMore" onClick={(event) => { event.stopPropagation(); openActionMenuMore(); }} role="menuitem" aria-haspopup="menu" aria-label="More options" data-menu-page="root">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <circle cx="8" cy="12" r="1.15" fill="currentColor" stroke="none" />
              <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
              <circle cx="16" cy="12" r="1.15" fill="currentColor" stroke="none" />
            </svg>
            {" "}
            <span>More</span>
          </button>
          {" "}
          <button className="composer-action-menu-item" type="button" id="actionMenuBack" onClick={(event) => { event.stopPropagation(); openActionMenuRoot(); }} role="menuitem" aria-label="Back to actions" data-menu-page="more">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            {" "}
            <span>Back</span>
          </button>
          {" "}
          <button className="composer-action-menu-item" type="button" id="writingStyleButton" onClick={openWritingStyleMenu} role="menuitem" aria-haspopup="menu" data-menu-page="more">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
            </svg>
            {" "}
            <span>Styles</span>
            {" "}
            <span className="composer-action-menu-value" id="writingStyleMenuValue">{WRITING_STYLE_LABELS[style]}</span>
            {" "}
            <svg className="composer-action-menu-chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          {" "}
          <button className={cx("composer-action-menu-item web-search-toggle", { hidden: !webSearch.shown })} type="button" id="webSearchToggle" role="menuitem" aria-pressed={webSearch.pressed} aria-label={webSearch.label} title={webSearch.title} data-menu-page="more" onClick={(event) => { event.stopPropagation(); updateSetting("webSearchMode", webSearchOn ? "off" : "auto"); }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            {" "}
            <span>Web search</span>
          </button>
          {" "}
          <button type="button" id="mobilePhotosAction" className="composer-action-menu-item mobile-session-action" data-menu-page="root" role="menuitem" onClick={() => { closeActionMenu(); openPhotoPicker(imageDisabled); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-7 5 6" /></svg><span>Photos</span>
          </button>
          <button type="button" id="mobileSlidesAction" className="composer-action-menu-item mobile-session-action" data-menu-page="root" role="menuitem" onClick={() => { closeActionMenu(); homeModes.selectMode("slides"); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="13" rx="2" /><path d="M12 16v5m-4 0h8M8 7v5m4-3v3m4-5v5" /></svg><span>Slides</span>
          </button>
        </div>
  );
}

export function WritingStyleMenu() {
  const style = useApp((s) => normalizeWritingStyle(s.settings.writingStyle));
  const open = useApp((s) => s.actionMenu === "style");
  return (
        <div className={cx("composer-action-menu composer-style-menu", { hidden: !open })} id="writingStyleMenu" role="menu" aria-label="Writing styles">
          <button className="composer-style-menu-back" type="button" id="writingStyleBack" onClick={openActionMenuMore} aria-label="Back to more actions">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            {" "}
            <span>Styles</span>
          </button>
          {" "}
          <button className="composer-style-option" type="button" data-writing-style="normal" onClick={() => setWritingStyle("normal")} role="menuitemradio" aria-checked={style === "normal"}>
            <span>Normal</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
          </button>
          {" "}
          <button className="composer-style-option" type="button" data-writing-style="learning" onClick={() => setWritingStyle("learning")} role="menuitemradio" aria-checked={style === "learning"}>
            <span>Learning</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
          </button>
          {" "}
          <button className="composer-style-option" type="button" data-writing-style="concise" onClick={() => setWritingStyle("concise")} role="menuitemradio" aria-checked={style === "concise"}>
            <span>Concise</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
          </button>
          {" "}
          <button className="composer-style-option" type="button" data-writing-style="explanatory" onClick={() => setWritingStyle("explanatory")} role="menuitemradio" aria-checked={style === "explanatory"}>
            <span>Explanatory</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
          </button>
          {" "}
          <button className="composer-style-option" type="button" data-writing-style="formal" onClick={() => setWritingStyle("formal")} role="menuitemradio" aria-checked={style === "formal"}>
            <span>Formal</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
          </button>
        </div>
  );
}

/** Filled and shown by the home modes island. */
export function DeckPickerPop() {
  return <div className="deck-picker-pop" id="deckPickerPop" role="dialog" aria-label="Slide themes" hidden onClick={(event) => homeModes.handleGalleryClick(event.nativeEvent)} />;
}

/** The end of <body>: the phone sheets, their shared backdrop and (from an island) the camera sheet. */
export function BodySheets() {
  const mobile = useApp((s) => s.mobile);
  return createPortal(
    <>
      {mobile && (
        <>
          <NativeModeDropdown />
          <ActionMenu />
          <WritingStyleMenu />
          <DeckPickerPop />
        </>
      )}
      <button id="mobileSheetBackdrop" type="button" aria-label="Close sheet" onClick={() => closeTopNativeSurface()} />
    </>,
    document.body
  );
}

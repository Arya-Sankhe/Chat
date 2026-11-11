import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useApp } from "../state/app";
import { categoryLabel, presetById, AUTO_PRESET_ID } from "../state/deckCatalog";
import {
  answerMode,
  closeExplainer,
  closePicker,
  closePresetPreview,
  fillExample,
  openPicker,
  openPresetPreview,
  removeSlides,
  retryCatalog,
  selectPreset,
  selectedPreset,
  setGalleryCategory,
  setGalleryGroup,
  showPresetSlide,
  slidesActive,
  stepPresetSlide,
  syncScroll,
  togglePresetFromPreview,
  useHomeModes,
  visiblePresets,
  homeModes
} from "../state/homeModes";

/* The home mode pills and their panel, the slide theme gallery (on the home
   page or as a popover), the composer's theme card and the theme preview. */

const svgProps = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const CLOSE_ICON = <svg width="14" height="14" viewBox="0 0 24 24" {...svgProps} strokeWidth="2.2"><path d="M18 6 6 18M6 6l12 12" /></svg>;
const CHECK_ICON = <svg width="12" height="12" viewBox="0 0 24 24" {...svgProps} strokeWidth="3"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;

const PILLS: { id: string; label: string; icon: ReactNode }[] = [
  { id: "slides", label: "Slides", icon: <svg viewBox="0 0 24 24" {...svgProps} strokeWidth="1.8"><rect x="2.8" y="3.8" width="18.4" height="12.4" rx="2.6" /><path d="M12 16.2v3.6M8.4 20.2h7.2" /><path d="M7.6 12.6v-2.2M12 12.6V7.6M16.4 12.6V9.4" /></svg> },
  { id: "compare", label: "Compare", icon: <svg viewBox="0 0 24 24" {...svgProps} strokeWidth="1.9"><rect x="3" y="4" width="7" height="16" rx="2" /><rect x="14" y="4" width="7" height="16" rx="2" /></svg> },
  { id: "council", label: "Council", icon: <svg viewBox="0 0 24 24" {...svgProps} strokeWidth="1.8"><circle cx="12" cy="7.4" r="2.35" /><circle cx="5" cy="9" r="1.85" /><circle cx="19" cy="9" r="1.85" /><path d="M7.4 20v-1.5a4.6 4.6 0 0 1 9.2 0V20" /><path d="M2.4 20v-1.1A3.3 3.3 0 0 1 5.9 15.6" /><path d="M21.6 20v-1.1a3.3 3.3 0 0 0-3.5-3.3" /></svg> },
  { id: "study", label: "Study", icon: <svg viewBox="0 0 24 24" {...svgProps} strokeWidth="1.8"><path d="M2.5 9.5 12 5l9.5 4.5L12 14z" /><path d="M6.5 11.6V16c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4.4" /><path d="M21.5 9.5v5.2" /></svg> }
];

const EXPLAINERS: Record<string, { title: string; body: string; examples: string[] }> = {
  compare: {
    title: "Compare",
    body: "One prompt, two different models answer side by side.",
    examples: ["What should I cook for dinner tonight?", "Explain how the internet works.", "Write a birthday message for my best friend.", "How can I sleep better?"]
  },
  council: {
    title: "Council",
    body: "One prompt, 4 different models solve, one final answer.",
    examples: ["Should I rent or buy a home?", "Is coffee good or bad for you?", "What's the best way to learn a new language?", "Plan a relaxing weekend trip."]
  }
};

function AutoCover({ mini = false }: { mini?: boolean }) {
  return <span className={`deck-auto-cover${mini ? " is-mini" : ""}`}><span className="deck-auto-word">Auto</span></span>;
}

/** Shared by the home page and the in-chat popover. */
function Gallery() {
  const catalog = useHomeModes((s) => s.catalog);
  const error = useHomeModes((s) => s.catalogError);
  const group = useHomeModes((s) => s.galleryGroup);
  const category = useHomeModes((s) => s.galleryCategory);
  const selectedId = useHomeModes((s) => s.selectedPresetId);
  if (error) {
    return <div className="home-deck-error"><p>{error}</p><button type="button" className="home-deck-retry" data-deck-retry onClick={retryCatalog}>Retry</button></div>;
  }
  if (!catalog) return <div className="home-deck-loading" role="status"><span />Loading themes…</div>;
  const tabs = [{ id: "all", label: "All" }, ...catalog.groups.map((g) => ({ id: g.id, label: g.label }))];
  const groupCategories = group === "all" ? [] : catalog.groups.find((g) => g.id === group)?.categories || [];
  const chips = groupCategories.length ? [{ id: "", label: "All" }, ...groupCategories] : [];
  return (
    <>
      <div className="home-deck-head">
        <div className="home-deck-tabs" role="tablist" aria-label="Theme groups">
          {tabs.map((tab) => (
            <button key={tab.id} type="button" className={`home-deck-tab${group === tab.id ? " is-active" : ""}`} data-deck-tab={tab.id} role="tab" aria-selected={group === tab.id} onClick={() => setGalleryGroup(tab.id)}>{tab.label}</button>
          ))}
        </div>
        {chips.length > 0 && (
          <div className="home-deck-categories">
            {chips.map((chip) => (
              <button key={chip.id || "all"} type="button" className={`home-deck-category${category === chip.id ? " is-active" : ""}`} data-deck-category={chip.id} onClick={() => setGalleryCategory(chip.id)}>{chip.label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="home-deck-grid">
        <button type="button" className={`home-deck-card home-deck-card-auto${selectedId ? "" : " is-selected"}`} data-deck-card={AUTO_PRESET_ID} aria-pressed={!selectedId} title="Klui picks a theme that fits your topic" onClick={() => selectPreset(AUTO_PRESET_ID)}>
          <span className="home-deck-card-cover">
            <AutoCover />
            <span className="home-deck-card-check">{CHECK_ICON}</span>
          </span>
          <span className="home-deck-card-name">Auto</span>
        </button>
        {visiblePresets().map((preset) => (
          <button key={preset.id} type="button" className={`home-deck-card${preset.id === selectedId ? " is-selected" : ""}`} data-deck-card={preset.id} aria-pressed={preset.id === selectedId} onClick={() => openPresetPreview(preset.id)}>
            <span className="home-deck-card-cover">
              <img src={preset.cover} alt="" loading="lazy" decoding="async" />
              <span className="home-deck-card-check">{CHECK_ICON}</span>
            </span>
            <span className="home-deck-card-name">{preset.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Explainer({ mode }: { mode: string }) {
  const copy = EXPLAINERS[mode]!;
  return (
    <div className="home-mode-explainer" data-explainer={mode}>
      <div className="home-mode-explainer-top">
        <p className="home-mode-explainer-body">{copy.body}</p>
        <button type="button" className="home-mode-explainer-close" data-explainer-close aria-label={`Turn off ${copy.title}`} onClick={closeExplainer}>{CLOSE_ICON}</button>
      </div>
      <div className="home-mode-examples">
        {copy.examples.map((example) => (
          <button key={example} type="button" className="home-mode-example" data-pill-example={example} onClick={() => fillExample(example)}>
            <span>{example}</span>
            <svg width="15" height="15" viewBox="0 0 24 24" {...svgProps} strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Under the composer on the desktop home screen. */
export function HomeModesPanel() {
  const shown = useHomeModes((s) => s.homeShown);
  const explainerOpen = useHomeModes((s) => s.explainerOpen);
  // Re-read on the app changes that move the composer's skills or answer mode.
  useApp((s) => s.composerSkillIds);
  useApp((s) => s.settings.compareEnabled);
  useApp((s) => s.settings.compareMode);
  useApp((s) => s.temporaryChat);
  const slides = slidesActive();
  const mode = answerMode();
  const panel = slides ? "slides" : explainerOpen && mode ? "explainer" : "";
  const active = slides ? "slides" : mode;
  useLayoutEffect(() => { if (shown) syncScroll(); });
  // Built on first show and kept, so covers don't reload when the home screen returns.
  const built = useRef(false);
  if (shown) built.current = true;
  return (
    <div className="home-modes" id="homeModes" hidden={!shown}>
      {built.current && (
        <>
          <div className="home-modes-pills" role="group" aria-label="Modes" hidden={Boolean(panel)}>
            {PILLS.map((pill) => (
              <button key={pill.id} type="button" className={`home-mode-pill${active === pill.id ? " is-active" : ""}`} data-pill-mode={pill.id} onClick={() => homeModes.selectMode(pill.id)}>
                <span className="home-mode-pill-icon" aria-hidden="true">{pill.icon}</span>
                <span>{pill.label}</span>
              </button>
            ))}
          </div>
          <div className="home-modes-panel" hidden={!panel} data-kind={slides ? "slides" : "explainer"}>
            {panel === "slides" ? <Gallery /> : panel === "explainer" ? <Explainer mode={mode} /> : null}
          </div>
        </>
      )}
    </div>
  );
}

/** The Slides skill's theme card in the composer: opens the gallery, or drops Slides. */
export function ComposerDeckThumb() {
  useApp((s) => s.composerSkillIds);
  useHomeModes((s) => s.selectedPresetId);
  useHomeModes((s) => s.catalog);
  const slides = slidesActive();
  const preset = slides ? selectedPreset() : null;
  const label = preset ? `Theme: ${preset.name}. Change theme` : "Theme: Auto. Choose a theme";
  return (
    <div className={`composer-deck-thumb${slides ? "" : " hidden"}`} id="composerDeckThumb" aria-hidden={!slides} data-preset={slides ? preset?.id || AUTO_PRESET_ID : ""}>
      {slides && (
        <>
          <button type="button" className="composer-deck-thumb-card" data-deck-open aria-label={label} title={preset ? preset.name : "Auto: Klui picks the look"} onClick={(event) => { event.stopPropagation(); openPicker(); }}>
            {preset ? <img src={preset.cover} alt="" /> : <AutoCover mini />}
          </button>
          <button type="button" className="composer-deck-thumb-clear" data-deck-clear aria-label="Remove Slides" onClick={(event) => {
            event.stopPropagation();
            removeSlides();
            document.getElementById("promptInput")?.focus();
          }}>{CLOSE_ICON}</button>
        </>
      )}
    </div>
  );
}

/** The gallery as a popover above the composer (in a chat, or on a phone). */
export function DeckPickerPop() {
  const shown = useHomeModes((s) => s.pickerShown);
  // Kept once opened, so a reopened picker holds its scroll and covers.
  const opened = useRef(false);
  if (shown) opened.current = true;
  return (
    <div className="deck-picker-pop" id="deckPickerPop" role="dialog" aria-label="Slide themes" hidden={!shown}>
      {opened.current && (
        <>
          <div className="deck-picker-top">
            <strong>Slide theme</strong>
            <button type="button" className="deck-picker-close" data-deck-picker-close aria-label="Close themes" onClick={closePicker}>{CLOSE_ICON}</button>
          </div>
          <div className="deck-picker-body"><Gallery /></div>
        </>
      )}
    </div>
  );
}

/** A theme's slides, its colors, and Use / Back to Auto. */
export function DeckPresetDialog() {
  const catalog = useHomeModes((s) => s.catalog);
  const presetId = useHomeModes((s) => s.modalPresetId);
  const slideIndex = useHomeModes((s) => s.modalSlide);
  const selectedId = useHomeModes((s) => s.selectedPresetId);
  const dialog = useRef<HTMLDialogElement>(null);
  const preset = catalog && presetId ? presetById(catalog.presets, presetId) : null;
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (preset && !el.open && typeof el.showModal === "function") el.showModal();
    if (!preset && el.open) el.close();
  }, [preset]);
  const slides = preset ? (preset.slides.length ? preset.slides : [preset.cover]) : [];
  const index = Math.max(0, Math.min(slides.length - 1, slideIndex));
  const isSelected = Boolean(preset && selectedId === preset.id);
  return (
    <dialog
      ref={dialog}
      className="deck-preset-dialog"
      id="deckPresetDialog"
      aria-labelledby="deckPresetDialogTitle"
      onClose={closePresetPreview}
      onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); stepPresetSlide(-1); }
        else if (event.key === "ArrowRight") { event.preventDefault(); stepPresetSlide(1); }
      }}
    >
      <button type="button" className="deck-preset-dialog-close" id="deckPresetDialogClose" aria-label="Close preview" onClick={() => dialog.current?.close()}>
        <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps} strokeWidth="2.2"><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>
      </button>
      {" "}
      <div className="deck-preset-dialog-body">
        {/* A double click would otherwise select the slide image behind the arrows. */}
        <div className="deck-preset-viewer" onMouseDown={(event) => { if (event.detail > 1) event.preventDefault(); }}>
          <div className="deck-preset-viewer-stage">
            <img id="deckPresetViewerImage" src={slides[index]} alt={preset ? `${preset.name} — slide ${index + 1} of ${slides.length}` : ""} />
            {" "}
            <button type="button" className="deck-preset-viewer-nav deck-preset-viewer-prev" id="deckPresetPrev" aria-label="Previous slide" onClick={() => stepPresetSlide(-1)}>
              <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps} strokeWidth="2.4"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            {" "}
            <button type="button" className="deck-preset-viewer-nav deck-preset-viewer-next" id="deckPresetNext" aria-label="Next slide" onClick={() => stepPresetSlide(1)}>
              <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps} strokeWidth="2.4"><path d="m9 6 6 6-6 6" /></svg>
            </button>
          </div>
          <div className="deck-preset-viewer-thumbs" id="deckPresetThumbs">
            {slides.map((src, i) => (
              <button key={`${i}:${src}`} type="button" className={`deck-preset-thumb${i === index ? " is-active" : ""}`} data-deck-slide={i} aria-label={`Slide ${i + 1}`} aria-current={i === index} onClick={() => showPresetSlide(i)}>
                <img src={src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
        <div className="deck-preset-info">
          <h2 id="deckPresetDialogTitle">{preset?.name}</h2>
          {" "}
          <p className="deck-preset-info-category" id="deckPresetCategory">{preset ? categoryLabel(catalog, preset) : ""}</p>
          {" "}
          <p className="deck-preset-info-desc" id="deckPresetDesc">{preset?.description}</p>
          {" "}
          <div className="deck-preset-swatches" id="deckPresetSwatches">
            {preset?.swatches.map((hex, i) => <span key={`${i}:${hex}`} className="deck-preset-swatch" style={{ background: `#${hex}` }} />)}
          </div>
          {" "}
          <button type="button" className={`deck-preset-use-btn${isSelected ? " is-selected" : ""}`} id="deckPresetUseBtn" onClick={togglePresetFromPreview}>{isSelected ? "Back to Auto" : "Use this theme"}</button>
        </div>
      </div>
    </dialog>
  );
}

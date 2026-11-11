/* The home mode pills (Slides, Compare, Council, Study), the slide theme gallery
   and the composer's theme card. On the empty new-chat screen the pills sit under
   the composer; Slides lays the theme gallery out below it, Compare and Council
   explain themselves with examples. Elsewhere the Slides skill shows a small theme
   card in the composer that opens the same gallery as a popover.
   shell/HomeModes.tsx draws it all from this store. */
import { create } from "zustand";
import { filterPresets, normalizeDeckCatalog, presetById, type DeckCatalog, type DeckPreset } from "./deckCatalog";
import {
  activateCompareMode,
  cancelCompareMode,
  chatHooks,
  enterCouncilMode,
  isCouncilMode,
  setResearchMode,
  showToast,
  useApp
} from "./app";

export { AUTO_PRESET_ID } from "./deckCatalog";
const CATALOG_URL = "/deck-presets/catalog.json";

type HomeModes = {
  catalog: DeckCatalog | null;
  catalogError: string;
  galleryGroup: string;
  galleryCategory: string;
  /** "" means Auto: Klui picks the theme. */
  selectedPresetId: string;
  /** The theme open in the preview dialog. */
  modalPresetId: string;
  modalSlide: number;
  // Compare/Council explainers only show when the mode was picked from a pill, so a
  // remembered Compare setting doesn't cover the home screen on every visit.
  explainerOpen: boolean;
  pickerOpen: boolean;
  /** The pills and panel under the composer (the desktop home screen). */
  homeShown: boolean;
  /** The gallery popover above the composer (in a chat, or on a phone). */
  pickerShown: boolean;
};

export const useHomeModes = create<HomeModes>(() => ({
  catalog: null,
  catalogError: "",
  galleryGroup: "all",
  galleryCategory: "",
  selectedPresetId: "",
  modalPresetId: "",
  modalSlide: 0,
  explainerOpen: false,
  pickerOpen: false,
  homeShown: false,
  pickerShown: false
}));
const set = useHomeModes.setState;
const get = useHomeModes.getState;

export function mobileLayout() {
  return document.body.classList.contains("capacitor-native") || window.matchMedia("(max-width: 860px)").matches;
}

const skillIds = () => useApp.getState().composerSkillIds || [];
export const slidesActive = () => skillIds().includes("slides");

export function answerMode() {
  const { settings, temporaryChat } = useApp.getState();
  if (!settings?.compareEnabled || temporaryChat) return "";
  return isCouncilMode() ? "council" : "compare";
}

function composerArea() {
  return document.querySelector<HTMLElement>(".composer-area");
}

function isHomeScreen() {
  // Dojo borrows the composer; the home pills and gallery stay out of it.
  return document.body.classList.contains("chat-empty")
    && !document.body.classList.contains("study-open")
    && !composerArea()?.closest(".study-composer-slot");
}

export function selectedPreset(): DeckPreset | null {
  const { catalog, selectedPresetId } = get();
  return catalog ? presetById(catalog.presets, selectedPresetId) : null;
}

let catalogPromise: Promise<void> | null = null;

// A failed load waits for Retry (or another explicit pick) instead of refetching on every render.
function ensureCatalogLoaded() {
  const { catalog, catalogError } = get();
  if (catalog || catalogPromise || catalogError) return;
  catalogPromise = fetch(CATALOG_URL, { cache: "no-cache" })
    .then((res) => {
      if (!res.ok) throw new Error(`catalog ${res.status}`);
      return res.json();
    })
    .then((json) => set({ catalog: normalizeDeckCatalog(json), catalogError: "" }))
    .catch(() => set({ catalog: null, catalogError: "Couldn't load slide themes." }))
    .finally(() => {
      catalogPromise = null;
      render();
    });
}

export function retryCatalog() {
  set({ catalogError: "" });
  ensureCatalogLoaded();
  render();
}

function focusComposer() {
  const input = document.getElementById("promptInput");
  if (!input) return;
  input.focus();
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function removeSlides() {
  chatHooks.setComposerSkillIds(skillIds().filter((id) => id !== "slides"));
}

/** Where the old app re-rendered: syncs what shows with the composer's skills and mode. */
export function render() {
  if (!slidesActive()) set({ selectedPresetId: "", pickerOpen: false });
  else ensureCatalogLoaded();
  const home = isHomeScreen();
  const homeShown = home && !mobileLayout();
  if (!homeShown || !answerMode()) set({ explainerOpen: false });
  set({ homeShown, pickerShown: (!home || mobileLayout()) && get().pickerOpen && slidesActive() });
  setPanelOpen(homeShown && (slidesActive() || (get().explainerOpen && Boolean(answerMode()))));
}

function selectMode(mode: string) {
  if (mode === "study") {
    chatHooks.openStudyHub();
    return;
  }
  if (mode === "slides") {
    if (!useApp.getState().composerSkills.find((skill) => skill.id === "slides")) {
      showToast("Slides isn't available yet.");
      return;
    }
    if (answerMode()) cancelCompareMode();
    if (useApp.getState().researchMode) setResearchMode(false);
    chatHooks.setComposerSkillIds(["slides"]);
    set({ catalogError: "" });
    ensureCatalogLoaded();
  } else {
    if (slidesActive()) removeSlides();
    if (useApp.getState().researchMode) setResearchMode(false);
    if (mode === "compare") activateCompareMode();
    else if (mode === "council" && enterCouncilMode() === false) return;
    set({ explainerOpen: true });
  }
  if (mobileLayout() && mode === "slides") set({ pickerOpen: true });
  render();
  if (!mobileLayout()) focusComposer();
}

// The composer's Compare/Council switch opens the same explainer as the pills.
function showAnswerModeExplainer() {
  if (mobileLayout() || !answerMode() || !isHomeScreen()) {
    render();
    return;
  }
  if (slidesActive()) removeSlides();
  set({ explainerOpen: true });
  render();
}

export function closeExplainer() {
  set({ explainerOpen: false });
  cancelCompareMode();
  render();
  focusComposer();
}

export function fillExample(text: string) {
  chatHooks.fillComposerText(text);
}

export function setGalleryGroup(galleryGroup: string) {
  set({ galleryGroup, galleryCategory: "" });
}

export function setGalleryCategory(galleryCategory: string) {
  set({ galleryCategory });
}

export function visiblePresets() {
  const { catalog, galleryGroup, galleryCategory } = get();
  return catalog ? filterPresets(catalog.presets, { group: galleryGroup, category: galleryCategory }) : [];
}

export function selectPreset(id: string) {
  set({ selectedPresetId: id === "auto" ? "" : id, pickerOpen: false });
  render();
  focusComposer();
}

/** The composer's theme card: on the home screen the gallery is already there, so scroll to it. */
export function openPicker() {
  if (isHomeScreen() && !mobileLayout()) {
    const area = composerArea();
    const panel = document.querySelector("#homeModes .home-modes-panel");
    const wrap = area?.querySelector(".composer-wrap");
    if (area && panel && wrap) {
      const target = area.scrollTop + panel.getBoundingClientRect().top - wrap.getBoundingClientRect().bottom - 16;
      area.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }
    return;
  }
  set({ pickerOpen: !get().pickerOpen });
  ensureCatalogLoaded();
  render();
}

export function closePicker() {
  if (!get().pickerOpen) return false;
  set({ pickerOpen: false });
  render();
  return true;
}

/* ─── The theme preview dialog ─── */

export function openPresetPreview(presetId: string) {
  const { catalog } = get();
  if (!catalog || !presetById(catalog.presets, presetId)) return;
  set({ modalPresetId: presetId, modalSlide: 0 });
}

export function closePresetPreview() {
  set({ modalPresetId: "" });
}

export function showPresetSlide(index: number) {
  set({ modalSlide: index });
}

export function stepPresetSlide(delta: number) {
  const { catalog, modalPresetId, modalSlide } = get();
  const preset = catalog && presetById(catalog.presets, modalPresetId);
  if (!preset) return;
  const count = (preset.slides.length ? preset.slides : [preset.cover]).length;
  set({ modalSlide: (modalSlide + delta + count) % count });
}

/** "Use this theme", or "Back to Auto" when it's already the one. */
export function togglePresetFromPreview() {
  const { catalog, modalPresetId, selectedPresetId } = get();
  const preset = catalog && presetById(catalog.presets, modalPresetId);
  if (!preset) return;
  // Closed right away (not on the next render), so the composer can take focus.
  (document.getElementById("deckPresetDialog") as HTMLDialogElement | null)?.close();
  set({ modalPresetId: "" });
  selectPreset(selectedPresetId === preset.id ? "auto" : preset.id);
}

/* ─── Scrolling home page ───
   With a panel open the composer area itself scrolls. The composer is sticky, so it rides up
   with the gallery until it reaches the top; the gallery then fades out as it slides under
   the composer and the theme tabs. */

function setPanelOpen(open: boolean) {
  const was = document.body.classList.contains("home-panel-open");
  if (was === open) {
    if (open) syncScroll();
    return;
  }
  document.body.classList.toggle("home-panel-open", open);
  const area = composerArea();
  if (area) area.scrollTop = 0;
  syncScroll();
}

let scrollFrame = 0;
export function syncScroll() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    applyScroll();
  });
}

const stickyTop = (el: Element) => parseFloat(getComputedStyle(el).top) || 0;

function applyScroll() {
  const area = composerArea();
  // Phone layouts keep the composer at the bottom and scroll the panel itself instead.
  const open = document.body.classList.contains("home-panel-open") && isHomeScreen()
    && Boolean(area) && getComputedStyle(area!).overflowY === "auto";
  const greeting = document.querySelector<HTMLElement>("#messages .empty-state");
  const scrolled = open && area ? area.scrollTop : 0;
  if (greeting) {
    greeting.style.transform = scrolled ? `translateY(${-scrolled}px)` : "";
    greeting.style.opacity = scrolled ? String(Math.max(0, 1 - scrolled / 160)) : "";
  }
  const root = document.getElementById("homeModes");
  const grid = root?.querySelector<HTMLElement>(".home-deck-grid");
  const head = root?.querySelector<HTMLElement>(".home-deck-head");
  const wrap = area?.querySelector<HTMLElement>(".composer-wrap");
  if (!open || !wrap) {
    grid?.style.removeProperty("--deck-fade");
    return;
  }
  const wrapRect = wrap.getBoundingClientRect();
  if (head) head.style.setProperty("--deck-head-top", `${Math.round(wrap.offsetHeight + stickyTop(wrap) + 14)}px`);
  if (!grid) return;
  const line = Math.max(wrapRect.bottom, head ? head.getBoundingClientRect().bottom : 0) + 6;
  grid.style.setProperty("--deck-fade", `${Math.round(line - grid.getBoundingClientRect().top)}px`);
}

let mounted = false;

/** Once the shell's elements exist: scroll tracking, and closing the popover from outside. */
export function mountHomeModes() {
  if (mounted) return;
  mounted = true;
  composerArea()?.addEventListener("scroll", syncScroll, { passive: true });
  window.addEventListener("resize", syncScroll);
  const composer = document.querySelector(".composer-area .composer");
  if (composer && typeof ResizeObserver === "function") new ResizeObserver(() => syncScroll()).observe(composer);
  // Close the popover on an outside click (the dialog it opens counts as inside).
  document.addEventListener("pointerdown", (event) => {
    if (!get().pickerOpen) return;
    if ((event.target as Element | null)?.closest?.("#deckPickerPop, #composerDeckThumb, #deckPresetDialog")) return;
    closePicker();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !get().modalPresetId && closePicker()) event.stopPropagation();
  }, true);
  render();
}

export const homeModes = {
  render,
  closePicker,
  selectMode,
  showAnswerModeExplainer,
  placeholderOverride: () => (skillIds().includes("docs") ? "Describe the document you want" : ""),
  deckThemeForSend: () => (slidesActive() ? get().selectedPresetId : "")
};

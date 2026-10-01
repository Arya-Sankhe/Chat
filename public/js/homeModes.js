// Home-screen mode pills (Slides, Compare, Council, Study) and the slide-theme picker.
//
// On the empty new-chat screen the pills sit under the composer. Slides puts the composer
// into the Slides skill and lays the theme gallery out below it; Compare and Council switch
// the answer mode and explain it with examples; Study opens the Study hub. While a panel is
// open the pills hide, the composer stays where it is, and the page scrolls: the composer
// rides up with the gallery and then sticks near the top.
//
// Anywhere else, the Slides skill shows a small theme card in the composer; clicking it opens
// the same gallery as a popover above the composer. See public/js/app.js for the integration
// points (search "homeModesController").

import { apiUrl } from "./platform/index.js";
import { escapeHtml } from "./render.js";

const CATALOG_URL = "/deck-presets/catalog.json";
export const AUTO_PRESET_ID = "auto";

const CLOSE_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const CHECK_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

const PILL_ICONS = {
  slides: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.8" y="3.8" width="18.4" height="12.4" rx="2.6"/><path d="M12 16.2v3.6M8.4 20.2h7.2"/><path d="M7.6 12.6v-2.2M12 12.6V7.6M16.4 12.6V9.4"/></svg>',
  compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="2"/><rect x="14" y="4" width="7" height="16" rx="2"/></svg>',
  council: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7.4" r="2.35"/><circle cx="5" cy="9" r="1.85"/><circle cx="19" cy="9" r="1.85"/><path d="M7.4 20v-1.5a4.6 4.6 0 0 1 9.2 0V20"/><path d="M2.4 20v-1.1A3.3 3.3 0 0 1 5.9 15.6"/><path d="M21.6 20v-1.1a3.3 3.3 0 0 0-3.5-3.3"/></svg>',
  study: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 9.5 12 5l9.5 4.5L12 14z"/><path d="M6.5 11.6V16c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4.4"/><path d="M21.5 9.5v5.2"/></svg>'
};

const PILLS = [
  { id: "slides", label: "Slides" },
  { id: "compare", label: "Compare" },
  { id: "council", label: "Council" },
  { id: "study", label: "Study" }
];

const EXPLAINERS = {
  compare: {
    title: "Compare",
    body: "One prompt, two answers side by side.",
    examples: [
      "What should I cook for dinner tonight?",
      "Explain how the internet works.",
      "Write a birthday message for my best friend.",
      "How can I sleep better?"
    ]
  },
  council: {
    title: "Council",
    body: "One prompt, 4 models solve, one final answer.",
    examples: [
      "Should I rent or buy a home?",
      "Is coffee good or bad for you?",
      "What's the best way to learn a new language?",
      "Plan a relaxing weekend trip."
    ]
  }
};

/* Tolerant catalog normalization: never throws, drops malformed entries. */
// resolveUrl maps catalog image paths to where they are served (the API origin in the native app).
export function normalizeDeckCatalog(raw, { resolveUrl = (src) => src } = {}) {
  const groups = (Array.isArray(raw?.groups) ? raw.groups : [])
    .map((group) => ({
      id: String(group?.id || "").trim(),
      label: String(group?.label || group?.id || "").trim(),
      categories: (Array.isArray(group?.categories) ? group.categories : [])
        .map((category) => ({
          id: String(category?.id || "").trim(),
          label: String(category?.label || category?.id || "").trim()
        }))
        .filter((category) => category.id)
    }))
    .filter((group) => group.id);

  const presets = (Array.isArray(raw?.presets) ? raw.presets : [])
    .map((preset) => {
      const slides = (Array.isArray(preset?.slides) ? preset.slides : [])
        .map((src) => String(src || "").trim())
        .filter(Boolean)
        .map(resolveUrl);
      const rawCover = String(preset?.cover || "").trim();
      const cover = rawCover ? resolveUrl(rawCover) : slides[0] || "";
      return {
        id: String(preset?.id || "").trim(),
        name: String(preset?.name || preset?.id || "Untitled").trim(),
        group: String(preset?.group || "").trim(),
        category: String(preset?.category || "").trim(),
        description: String(preset?.description || "").trim(),
        dark: Boolean(preset?.dark),
        swatches: (Array.isArray(preset?.swatches) ? preset.swatches : [])
          .map((hex) => String(hex || "").replace(/^#/, "").trim())
          .filter(Boolean)
          .slice(0, 6),
        cover,
        slides: slides.length ? slides : (cover ? [cover] : [])
      };
    })
    .filter((preset) => preset.id && preset.id !== AUTO_PRESET_ID && preset.cover);

  return { groups, presets };
}

export function filterPresets(presets, { group = "all", category = "" } = {}) {
  return (Array.isArray(presets) ? presets : []).filter((preset) => {
    if (group && group !== "all" && preset.group !== group) return false;
    if (category && preset.category !== category) return false;
    return true;
  });
}

export function presetById(presets, id) {
  if (!id) return null;
  return (Array.isArray(presets) ? presets : []).find((preset) => preset.id === id) || null;
}

function autoCoverMarkup(extraClass = "") {
  return `<span class="deck-auto-cover${extraClass ? ` ${extraClass}` : ""}"><span class="deck-auto-word">Auto</span></span>`;
}

export function createHomeModesController({
  state,
  els,
  composerSkillById,
  setComposerSkillIds,
  fillComposerText,
  focusComposer,
  enterCompareMode,
  enterCouncilMode,
  exitCompareMode,
  isCouncilMode,
  setResearchMode,
  openStudyHub,
  showToast
}) {
  let catalog = null;
  let catalogPromise = null;
  let catalogError = "";
  let galleryFilter = { group: "all", category: "" };
  // "" means Auto: Klui picks the theme.
  let selectedPresetId = "";
  let modalPresetId = "";
  let modalSlideIndex = 0;
  // Compare/Council explainers only show when the mode was picked from a pill, so a remembered
  // Compare setting doesn't cover the home screen on every visit.
  let explainerOpen = false;
  let pickerOpen = false;
  let built = false;
  let lastPanelMarkup = "";
  let lastPickerMarkup = "";

  function skillIds() {
    return Array.isArray(state.composerSkillIds) ? state.composerSkillIds : [];
  }

  function slidesActive() {
    return skillIds().includes("slides");
  }

  function answerMode() {
    if (!state.settings?.compareEnabled || state.temporaryChat) return "";
    return isCouncilMode() ? "council" : "compare";
  }

  function isHomeScreen() {
    // Dojo borrows the composer; the home pills and gallery stay out of it.
    return document.body.classList.contains("chat-empty")
      && !document.body.classList.contains("study-open")
      && !composerArea()?.closest(".study-composer-slot");
  }

  function selectedPreset() {
    return catalog ? presetById(catalog.presets, selectedPresetId) : null;
  }

  function categoryLabel(preset) {
    if (!catalog) return "";
    const group = catalog.groups.find((g) => g.id === preset.group);
    const category = group?.categories.find((c) => c.id === preset.category);
    return [group?.label || preset.group, category?.label || preset.category].filter(Boolean).join(" · ");
  }

  // A failed load waits for Retry (or another explicit pick) instead of refetching on every render.
  function ensureCatalogLoaded() {
    if (catalog || catalogPromise || catalogError) return;
    catalogPromise = fetch(apiUrl(CATALOG_URL), { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`catalog ${res.status}`);
        return res.json();
      })
      .then((json) => {
        catalog = normalizeDeckCatalog(json, { resolveUrl: (src) => (src.startsWith("/") ? apiUrl(src) : src) });
        catalogError = "";
      })
      .catch(() => {
        catalog = null;
        catalogError = "Couldn't load slide themes.";
      })
      .finally(() => {
        catalogPromise = null;
        render();
      });
  }

  function removeSlides() {
    setComposerSkillIds(skillIds().filter((id) => id !== "slides"));
  }

  function handlePillClick(mode) {
    if (mode === "study") {
      openStudyHub();
      return;
    }
    if (mode === "slides") {
      if (!composerSkillById("slides")) {
        showToast?.("Slides isn't available yet.");
        return;
      }
      if (answerMode()) exitCompareMode();
      if (state.researchMode) setResearchMode(false);
      setComposerSkillIds(["slides"]);
      catalogError = "";
      ensureCatalogLoaded();
    } else {
      if (slidesActive()) removeSlides();
      if (state.researchMode) setResearchMode(false);
      if (mode === "compare") enterCompareMode();
      else if (mode === "council" && enterCouncilMode() === false) return;
      explainerOpen = true;
    }
    render();
    focusComposer();
  }

  // The composer's Compare/Council switch opens the same explainer as the pills.
  function showAnswerModeExplainer() {
    if (!answerMode() || !isHomeScreen()) {
      render();
      return;
    }
    if (slidesActive()) removeSlides();
    explainerOpen = true;
    render();
  }

  function closeExplainer() {
    explainerOpen = false;
    exitCompareMode();
    render();
    focusComposer();
  }

  /* ─── Gallery markup (shared by the home page and the in-chat popover) ─── */

  function tabsMarkup() {
    const tabs = [{ id: "all", label: "All" }, ...(catalog?.groups || []).map((g) => ({ id: g.id, label: g.label }))];
    return tabs.map((tab) => `
      <button type="button" class="home-deck-tab${galleryFilter.group === tab.id ? " is-active" : ""}" data-deck-tab="${escapeHtml(tab.id)}" role="tab" aria-selected="${galleryFilter.group === tab.id}">${escapeHtml(tab.label)}</button>
    `).join("");
  }

  function categoryChipsMarkup() {
    if (galleryFilter.group === "all") return "";
    const group = catalog?.groups.find((g) => g.id === galleryFilter.group);
    if (!group?.categories?.length) return "";
    const chips = [{ id: "", label: "All" }, ...group.categories];
    return `<div class="home-deck-categories">${chips.map((chip) => `
      <button type="button" class="home-deck-category${galleryFilter.category === chip.id ? " is-active" : ""}" data-deck-category="${escapeHtml(chip.id)}">${escapeHtml(chip.label)}</button>
    `).join("")}</div>`;
  }

  function autoCardMarkup() {
    const selected = !selectedPresetId;
    return `
      <button type="button" class="home-deck-card home-deck-card-auto${selected ? " is-selected" : ""}" data-deck-card="${AUTO_PRESET_ID}" aria-pressed="${selected}" title="Klui picks a theme that fits your topic">
        <span class="home-deck-card-cover">
          ${autoCoverMarkup()}
          <span class="home-deck-card-check">${CHECK_ICON_SVG}</span>
        </span>
        <span class="home-deck-card-name">Auto</span>
      </button>`;
  }

  function cardMarkup(preset) {
    const selected = preset.id === selectedPresetId;
    return `
      <button type="button" class="home-deck-card${selected ? " is-selected" : ""}" data-deck-card="${escapeHtml(preset.id)}" aria-pressed="${selected}">
        <span class="home-deck-card-cover">
          <img src="${escapeHtml(preset.cover)}" alt="" loading="lazy" decoding="async">
          <span class="home-deck-card-check">${CHECK_ICON_SVG}</span>
        </span>
        <span class="home-deck-card-name">${escapeHtml(preset.name)}</span>
      </button>`;
  }

  function galleryMarkup() {
    if (catalogError) {
      return `<div class="home-deck-error"><p>${escapeHtml(catalogError)}</p><button type="button" class="home-deck-retry" data-deck-retry>Retry</button></div>`;
    }
    if (!catalog) {
      return `<div class="home-deck-loading" role="status"><span></span>Loading themes…</div>`;
    }
    const list = filterPresets(catalog.presets, galleryFilter);
    return `
      <div class="home-deck-head">
        <div class="home-deck-tabs" role="tablist" aria-label="Theme groups">${tabsMarkup()}</div>
        ${categoryChipsMarkup()}
      </div>
      <div class="home-deck-grid">${autoCardMarkup()}${list.map(cardMarkup).join("")}</div>
    `;
  }

  function explainerMarkup(mode) {
    const copy = EXPLAINERS[mode];
    return `
      <div class="home-mode-explainer" data-explainer="${mode}">
        <div class="home-mode-explainer-top">
          <p class="home-mode-explainer-body">${escapeHtml(copy.body)}</p>
          <button type="button" class="home-mode-explainer-close" data-explainer-close aria-label="Turn off ${escapeHtml(copy.title)}">${CLOSE_ICON_SVG}</button>
        </div>
        <div class="home-mode-examples">
          ${copy.examples.map((example) => `<button type="button" class="home-mode-example" data-pill-example="${escapeHtml(example)}"><span>${escapeHtml(example)}</span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`).join("")}
        </div>
      </div>`;
  }

  /* ─── Composer theme card ─── */

  function renderComposerThumb() {
    const thumb = els.composerDeckThumb;
    if (!thumb) return;
    if (!slidesActive()) {
      thumb.classList.add("hidden");
      thumb.innerHTML = "";
      thumb.dataset.preset = "";
      return;
    }
    const preset = selectedPreset();
    const key = preset?.id || AUTO_PRESET_ID;
    thumb.classList.remove("hidden");
    thumb.setAttribute("aria-hidden", "false");
    if (thumb.dataset.preset === key && thumb.childElementCount) return;
    thumb.dataset.preset = key;
    const label = preset ? `Theme: ${preset.name}. Change theme` : "Theme: Auto. Choose a theme";
    thumb.innerHTML = `
      <button type="button" class="composer-deck-thumb-card" data-deck-open aria-label="${escapeHtml(label)}" title="${preset ? escapeHtml(preset.name) : "Auto: Klui picks the look"}">
        ${preset ? `<img src="${escapeHtml(preset.cover)}" alt="">` : autoCoverMarkup("is-mini")}
      </button>
      <button type="button" class="composer-deck-thumb-clear" data-deck-clear aria-label="Remove Slides">${CLOSE_ICON_SVG}</button>
    `;
  }

  /* ─── Home panel ─── */

  function ensureSkeleton() {
    const root = els.homeModes;
    if (!root || built) return;
    root.innerHTML = `
      <div class="home-modes-pills" role="group" aria-label="Modes">
        ${PILLS.map((pill) => `
          <button type="button" class="home-mode-pill" data-pill-mode="${pill.id}">
            <span class="home-mode-pill-icon" aria-hidden="true">${PILL_ICONS[pill.id]}</span>
            <span>${escapeHtml(pill.label)}</span>
          </button>
        `).join("")}
      </div>
      <div class="home-modes-panel" hidden></div>
    `;
    built = true;
    root.addEventListener("click", handleGalleryClick);
  }

  function homePanelMarkup() {
    if (slidesActive()) return galleryMarkup();
    const mode = answerMode();
    if (!mode) explainerOpen = false;
    return explainerOpen && mode ? explainerMarkup(mode) : "";
  }

  function render() {
    if (!slidesActive()) {
      selectedPresetId = "";
      pickerOpen = false;
    } else {
      ensureCatalogLoaded();
    }
    const home = isHomeScreen();
    renderHome(home);
    renderPicker(!home && pickerOpen && slidesActive());
    renderComposerThumb();
  }

  function renderHome(home) {
    const root = els.homeModes;
    if (!root) return;
    root.hidden = !home;
    if (!home) {
      explainerOpen = false;
      setPanelOpen(false);
      return;
    }
    ensureSkeleton();
    const panel = root.querySelector(".home-modes-panel");
    const pills = root.querySelector(".home-modes-pills");
    const markup = homePanelMarkup();
    const open = Boolean(markup);
    const active = slidesActive() ? "slides" : answerMode();
    root.querySelectorAll("[data-pill-mode]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.pillMode === active);
    });
    if (pills) pills.hidden = open;
    if (panel) {
      panel.hidden = !open;
      panel.dataset.kind = slidesActive() ? "slides" : "explainer";
      // render() runs on many unrelated app updates; only swap the markup when it changed so
      // covers don't reload and the scroll position holds.
      if (markup !== lastPanelMarkup) {
        panel.innerHTML = markup;
        lastPanelMarkup = markup;
      }
    }
    setPanelOpen(open);
  }

  function setPanelOpen(open) {
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

  /* ─── Scrolling home page ───
     With a panel open the composer area itself scrolls. The composer is sticky, so it rides up
     with the gallery until it reaches the top; the gallery then fades out as it slides under
     the composer and the theme tabs. */

  function composerArea() {
    return document.querySelector(".composer-area");
  }

  let scrollFrame = 0;
  function syncScroll() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      applyScroll();
    });
  }

  function applyScroll() {
    const area = composerArea();
    // Phone layouts keep the composer at the bottom and scroll the panel itself instead.
    const open = document.body.classList.contains("home-panel-open") && isHomeScreen()
      && Boolean(area) && getComputedStyle(area).overflowY === "auto";
    const greeting = document.querySelector("#messages .empty-state");
    const scrolled = open && area ? area.scrollTop : 0;
    if (greeting) {
      greeting.style.transform = scrolled ? `translateY(${-scrolled}px)` : "";
      greeting.style.opacity = scrolled ? String(Math.max(0, 1 - scrolled / 160)) : "";
    }
    const root = els.homeModes;
    const grid = root?.querySelector(".home-deck-grid");
    const head = root?.querySelector(".home-deck-head");
    const wrap = area?.querySelector(".composer-wrap");
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

  function stickyTop(el) {
    return parseFloat(getComputedStyle(el).top) || 0;
  }

  /* ─── In-chat popover ─── */

  function renderPicker(show) {
    const pop = els.deckPickerPop;
    if (!pop) return;
    if (!show) {
      if (!pop.hidden) pop.hidden = true;
      return;
    }
    const markup = `
      <div class="deck-picker-top">
        <strong>Slide theme</strong>
        <button type="button" class="deck-picker-close" data-deck-picker-close aria-label="Close themes">${CLOSE_ICON_SVG}</button>
      </div>
      <div class="deck-picker-body">${galleryMarkup()}</div>`;
    if (markup !== lastPickerMarkup) {
      const body = pop.querySelector(".deck-picker-body");
      const scrollTop = body?.scrollTop || 0;
      pop.innerHTML = markup;
      const next = pop.querySelector(".deck-picker-body");
      if (next && !pop.hidden) next.scrollTop = scrollTop;
      lastPickerMarkup = markup;
    }
    pop.hidden = false;
  }

  function openPicker() {
    if (isHomeScreen()) {
      // The gallery is already on the page; bring it into view.
      const area = composerArea();
      const panel = els.homeModes?.querySelector(".home-modes-panel");
      const wrap = area?.querySelector(".composer-wrap");
      if (area && panel && wrap) {
        const target = area.scrollTop + panel.getBoundingClientRect().top - wrap.getBoundingClientRect().bottom - 16;
        area.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
      }
      return;
    }
    pickerOpen = !pickerOpen;
    ensureCatalogLoaded();
    render();
  }

  function closePicker() {
    if (!pickerOpen) return false;
    pickerOpen = false;
    render();
    return true;
  }

  /* ─── Events ─── */

  function selectPreset(id) {
    selectedPresetId = id === AUTO_PRESET_ID ? "" : id;
    pickerOpen = false;
    render();
    focusComposer();
  }

  function handleGalleryClick(event) {
    const pillBtn = event.target.closest("[data-pill-mode]");
    if (pillBtn) {
      handlePillClick(pillBtn.dataset.pillMode);
      return;
    }
    if (event.target.closest("[data-explainer-close]")) {
      closeExplainer();
      return;
    }
    const exampleBtn = event.target.closest("[data-pill-example]");
    if (exampleBtn) {
      fillComposerText(exampleBtn.dataset.pillExample);
      return;
    }
    if (event.target.closest("[data-deck-picker-close]")) {
      closePicker();
      return;
    }
    const tabBtn = event.target.closest("[data-deck-tab]");
    if (tabBtn) {
      galleryFilter = { group: tabBtn.dataset.deckTab, category: "" };
      render();
      return;
    }
    const categoryBtn = event.target.closest("[data-deck-category]");
    if (categoryBtn) {
      galleryFilter = { ...galleryFilter, category: categoryBtn.dataset.deckCategory };
      render();
      return;
    }
    if (event.target.closest("[data-deck-retry]")) {
      catalogError = "";
      ensureCatalogLoaded();
      render();
      return;
    }
    const cardBtn = event.target.closest("[data-deck-card]");
    if (cardBtn) {
      if (cardBtn.dataset.deckCard === AUTO_PRESET_ID) selectPreset(AUTO_PRESET_ID);
      else openModal(cardBtn.dataset.deckCard);
    }
  }

  function renderModal() {
    const preset = catalog && presetById(catalog.presets, modalPresetId);
    if (!preset || !els.deckPresetDialog) return;
    const slides = preset.slides.length ? preset.slides : [preset.cover];
    modalSlideIndex = Math.max(0, Math.min(slides.length - 1, modalSlideIndex));
    const img = els.deckPresetViewerImage;
    if (img) {
      img.src = slides[modalSlideIndex];
      img.alt = `${preset.name} — slide ${modalSlideIndex + 1} of ${slides.length}`;
    }
    if (els.deckPresetThumbs) {
      els.deckPresetThumbs.innerHTML = slides.map((src, index) => `
        <button type="button" class="deck-preset-thumb${index === modalSlideIndex ? " is-active" : ""}" data-deck-slide="${index}" aria-label="Slide ${index + 1}" aria-current="${index === modalSlideIndex}">
          <img src="${escapeHtml(src)}" alt="" loading="lazy">
        </button>
      `).join("");
    }
    if (els.deckPresetDialogTitle) els.deckPresetDialogTitle.textContent = preset.name;
    if (els.deckPresetCategory) els.deckPresetCategory.textContent = categoryLabel(preset);
    if (els.deckPresetDesc) els.deckPresetDesc.textContent = preset.description;
    if (els.deckPresetSwatches) {
      els.deckPresetSwatches.innerHTML = preset.swatches
        .map((hex) => `<span class="deck-preset-swatch" style="background:#${escapeHtml(hex)}"></span>`)
        .join("");
    }
    if (els.deckPresetUseBtn) {
      const isSelected = selectedPresetId === preset.id;
      els.deckPresetUseBtn.textContent = isSelected ? "Back to Auto" : "Use this theme";
      els.deckPresetUseBtn.classList.toggle("is-selected", isSelected);
    }
  }

  function openModal(presetId) {
    if (!catalog) return;
    const preset = presetById(catalog.presets, presetId);
    if (!preset) return;
    modalPresetId = presetId;
    modalSlideIndex = 0;
    renderModal();
    if (els.deckPresetDialog && typeof els.deckPresetDialog.showModal === "function" && !els.deckPresetDialog.open) {
      els.deckPresetDialog.showModal();
    }
  }

  function stepModal(delta) {
    const preset = catalog && presetById(catalog.presets, modalPresetId);
    if (!preset) return;
    const slides = preset.slides.length ? preset.slides : [preset.cover];
    modalSlideIndex = (modalSlideIndex + delta + slides.length) % slides.length;
    renderModal();
  }

  function toggleSelectedFromModal() {
    const preset = catalog && presetById(catalog.presets, modalPresetId);
    if (!preset) return;
    els.deckPresetDialog?.close();
    selectPreset(selectedPresetId === preset.id ? AUTO_PRESET_ID : preset.id);
  }

  function bindDialogEvents() {
    const dialog = els.deckPresetDialog;
    if (!dialog) return;
    els.deckPresetDialogClose?.addEventListener("click", () => dialog.close());
    els.deckPresetPrev?.addEventListener("click", () => stepModal(-1));
    els.deckPresetNext?.addEventListener("click", () => stepModal(1));
    els.deckPresetUseBtn?.addEventListener("click", () => toggleSelectedFromModal());
    els.deckPresetThumbs?.addEventListener("click", (event) => {
      const thumb = event.target.closest("[data-deck-slide]");
      if (!thumb) return;
      modalSlideIndex = Number(thumb.dataset.deckSlide) || 0;
      renderModal();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepModal(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepModal(1);
      }
    });
  }

  function bindComposerThumbEvents() {
    els.composerDeckThumb?.addEventListener("click", (event) => {
      if (event.target.closest("[data-deck-clear]")) {
        event.stopPropagation();
        removeSlides();
        focusComposer();
        return;
      }
      if (event.target.closest("[data-deck-open]")) {
        event.stopPropagation();
        openPicker();
      }
    });
  }

  function init() {
    bindDialogEvents();
    bindComposerThumbEvents();
    els.deckPickerPop?.addEventListener("click", handleGalleryClick);
    composerArea()?.addEventListener("scroll", syncScroll, { passive: true });
    window.addEventListener("resize", syncScroll);
    const composer = document.querySelector(".composer-area .composer");
    if (composer && typeof ResizeObserver === "function") new ResizeObserver(() => syncScroll()).observe(composer);
    // Close the popover on an outside click (the dialog it opens counts as inside).
    document.addEventListener("pointerdown", (event) => {
      if (!pickerOpen) return;
      if (event.target.closest("#deckPickerPop, #composerDeckThumb, #deckPresetDialog")) return;
      closePicker();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.deckPresetDialog?.open && closePicker()) event.stopPropagation();
    }, true);
    render();
  }

  function placeholderOverride() {
    if (skillIds().includes("docs")) return "Describe the document you want";
    return "";
  }

  function deckThemeForSend() {
    return slidesActive() ? selectedPresetId : "";
  }

  return {
    init,
    render,
    placeholderOverride,
    deckThemeForSend,
    showAnswerModeExplainer
  };
}

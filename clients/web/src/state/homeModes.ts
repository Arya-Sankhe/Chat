/* The home mode pills, slide theme gallery and composer theme card
   (public/js/homeModes.js, kept as an island). It reads the UI state through
   the getters below and finds its elements by id, as the old `els` did. */
import { createHomeModesController } from "../islands/homeModes.js";
import {
  activateCompareMode,
  cancelCompareMode,
  enterCouncilMode,
  isCouncilMode,
  setResearchMode,
  showToast,
  useApp
} from "./app";

const els = new Proxy({} as Record<string, HTMLElement | null>, {
  get: (_target, key) => (typeof key === "string" ? document.getElementById(key) : undefined)
});

const state = {
  get settings() { return useApp.getState().settings; },
  get temporaryChat() { return useApp.getState().temporaryChat; },
  get researchMode() { return useApp.getState().researchMode; },
  get composerSkillIds() { return useApp.getState().composerSkillIds; }
};

function focusComposerEnd() {
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

let controller: ReturnType<typeof createHomeModesController> | null = null;

/** homeModesController.init(): called once the shell's elements exist. */
export function mountHomeModes() {
  if (controller) return;
  controller = createHomeModesController({
    state,
    els,
    composerSkillById: (id: string) => useApp.getState().composerSkills.find((skill) => skill.id === id) || null,
    // The prompt's skill marks follow these ids with the composer input slice.
    setComposerSkillIds: (ids: string[]) => useApp.setState({ composerSkillIds: [...new Set(ids)] }),
    fillComposerText: (text: string) => {
      const input = document.getElementById("promptInput");
      if (!input) return;
      input.textContent = text;
      input.classList.toggle("is-placeholder", !text);
      input.focus();
    },
    focusComposer: focusComposerEnd,
    enterCompareMode: activateCompareMode,
    enterCouncilMode,
    exitCompareMode: cancelCompareMode,
    isCouncilMode,
    setResearchMode,
    // The Study hub arrives with the study slice.
    openStudyHub: () => {},
    showToast
  });
  controller.init();
}

export const homeModes = {
  render: () => controller?.render(),
  closePicker: () => controller?.closePicker() ?? false,
  selectMode: (mode: string) => controller?.selectMode(mode),
  handleGalleryClick: (event: Event) => controller?.handleGalleryClick(event),
  showAnswerModeExplainer: () => controller?.showAnswerModeExplainer()
};

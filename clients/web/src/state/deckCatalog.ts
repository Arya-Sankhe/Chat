/* The slide theme catalog (public/deck-presets/catalog.json): tolerant parsing,
   filtering, and lookup. Pure functions; the home modes store loads it. */

export const AUTO_PRESET_ID = "auto";

export type DeckCategory = { id: string; label: string };
export type DeckGroup = { id: string; label: string; categories: DeckCategory[] };
export type DeckPreset = {
  id: string;
  name: string;
  group: string;
  category: string;
  description: string;
  dark: boolean;
  swatches: string[];
  cover: string;
  slides: string[];
};
export type DeckCatalog = { groups: DeckGroup[]; presets: DeckPreset[] };

const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);

/** Never throws; drops malformed entries. An optional resolver maps image paths to another origin. */
export function normalizeDeckCatalog(raw: any, { resolveUrl = (src: string) => src } = {}): DeckCatalog {
  const groups = list(raw?.groups)
    .map((group) => ({
      id: String(group?.id || "").trim(),
      label: String(group?.label || group?.id || "").trim(),
      categories: list(group?.categories)
        .map((category) => ({ id: String(category?.id || "").trim(), label: String(category?.label || category?.id || "").trim() }))
        .filter((category) => category.id)
    }))
    .filter((group) => group.id);

  const presets = list(raw?.presets)
    .map((preset) => {
      const slides = list(preset?.slides).map((src) => String(src || "").trim()).filter(Boolean).map(resolveUrl);
      const rawCover = String(preset?.cover || "").trim();
      const cover = rawCover ? resolveUrl(rawCover) : slides[0] || "";
      return {
        id: String(preset?.id || "").trim(),
        name: String(preset?.name || preset?.id || "Untitled").trim(),
        group: String(preset?.group || "").trim(),
        category: String(preset?.category || "").trim(),
        description: String(preset?.description || "").trim(),
        dark: Boolean(preset?.dark),
        swatches: list(preset?.swatches).map((hex) => String(hex || "").replace(/^#/, "").trim()).filter(Boolean).slice(0, 6),
        cover,
        slides: slides.length ? slides : (cover ? [cover] : [])
      };
    })
    .filter((preset) => preset.id && preset.id !== AUTO_PRESET_ID && preset.cover);

  return { groups, presets };
}

export function filterPresets(presets: DeckPreset[], { group = "all", category = "" } = {}) {
  return presets.filter((preset) => {
    if (group && group !== "all" && preset.group !== group) return false;
    if (category && preset.category !== category) return false;
    return true;
  });
}

export function presetById(presets: DeckPreset[], id: string) {
  if (!id) return null;
  return presets.find((preset) => preset.id === id) || null;
}

/** "Group · Category" for the preview dialog. */
export function categoryLabel(catalog: DeckCatalog | null, preset: DeckPreset) {
  if (!catalog) return "";
  const group = catalog.groups.find((g) => g.id === preset.group);
  const category = group?.categories.find((c) => c.id === preset.category);
  return [group?.label || preset.group, category?.label || preset.category].filter(Boolean).join(" · ");
}

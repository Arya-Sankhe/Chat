export function serializeGuestDraft(draft = {}) {
  return {
    text: String(draft.text || ""),
    skillIds: Array.isArray(draft.skillIds) ? draft.skillIds : [],
    skillMarks: Array.isArray(draft.skillMarks) ? draft.skillMarks : [],
    researchMode: Boolean(draft.researchMode)
  };
}

export function guestDraftHasPreview(draft) {
  if (!draft || typeof draft !== "object") return false;
  if (String(draft.text || "").trim()) return true;
  if (Array.isArray(draft.skillIds) && draft.skillIds.length) return true;
  if (Array.isArray(draft.images) && draft.images.length) return true;
  return false;
}

export function liveGuestImages(images) {
  return (Array.isArray(images) ? images : []).filter((img) => (
    img?.file
    && typeof img.file === "object"
    && Number.isFinite(Number(img.file.size))
  ));
}

export function guestPreviewContent(draft = {}) {
  const text = String(draft.text || "");
  const parts = (Array.isArray(draft.images) ? draft.images : []).map((img) => img.category === "image" && img.previewUrl
    ? { type: "image_url", image_url: { url: img.previewUrl } }
    : { type: "file", file: { file_name: img.file?.name || img.fileName || "file", content_type: img.file?.type || "" } });
  if (!parts.length) return text;
  return [...(text ? [{ type: "text", text }] : []), ...parts];
}

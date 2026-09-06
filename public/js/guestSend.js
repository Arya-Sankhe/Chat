function persistablePreviewUrl(url) {
  const value = String(url || "");
  return value && !value.startsWith("blob:") ? value : "";
}

export function serializeGuestDraft(draft = {}) {
  const images = Array.isArray(draft.images) ? draft.images : [];
  const attachments = images.length
    ? images.map((img) => ({
      name: img.file?.name || img.fileName || "file",
      category: img.category === "document" ? "document" : "image",
      type: img.file?.type || img.contentType || "",
      previewUrl: persistablePreviewUrl(img.previewUrl)
    }))
    : (Array.isArray(draft.attachments) ? draft.attachments : []);
  return {
    text: String(draft.text || ""),
    skillIds: Array.isArray(draft.skillIds) ? draft.skillIds : [],
    skillMarks: Array.isArray(draft.skillMarks) ? draft.skillMarks : [],
    researchMode: Boolean(draft.researchMode),
    attachments
  };
}

export function guestDraftHasPreview(draft) {
  if (!draft || typeof draft !== "object") return false;
  if (String(draft.text || "").trim()) return true;
  if (Array.isArray(draft.skillIds) && draft.skillIds.length) return true;
  if (Array.isArray(draft.attachments) && draft.attachments.length) return true;
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
  const live = Array.isArray(draft.images) ? draft.images : [];
  const parts = live.length
    ? live.map((img) => img.category === "image" && img.previewUrl
      ? { type: "image_url", image_url: { url: img.previewUrl } }
      : { type: "file", file: { file_name: img.file?.name || img.fileName || "file", content_type: img.file?.type || "" } })
    : serializeGuestDraft(draft).attachments.map((att) => att.category === "image" && att.previewUrl
      ? { type: "image_url", image_url: { url: att.previewUrl } }
      : { type: "file", file: { file_name: att.name || "file", content_type: att.type || "" } });
  if (!parts.length) return text;
  return [...(text ? [{ type: "text", text }] : []), ...parts];
}

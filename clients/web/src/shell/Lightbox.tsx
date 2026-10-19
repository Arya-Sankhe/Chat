export function Lightbox() {
  return (
    <div className="lightbox hidden" id="lightbox" role="dialog" aria-label="Image preview">
      <button className="lightbox-close" id="lightboxClose" type="button" aria-label="Close preview">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      {" "}
      <div className="lightbox-stage">
        {/* An empty src, as in the old markup; React drops src="" so it is set directly. */}
        <img id="lightboxImg" ref={(img) => { if (img && !img.hasAttribute("src")) img.setAttribute("src", ""); }} alt="Expanded image preview" />
        {" "}
        <p className="lightbox-caption" id="lightboxCaption" hidden />
      </div>
    </div>
  );
}

export function DeckPresetDialog() {
  return (
    <dialog className="deck-preset-dialog" id="deckPresetDialog" aria-labelledby="deckPresetDialogTitle">
      <button type="button" className="deck-preset-dialog-close" id="deckPresetDialogClose" aria-label="Close preview">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6 6 18" />
          <path d="M6 6l12 12" />
        </svg>
      </button>
      {" "}
      <div className="deck-preset-dialog-body">
        <div className="deck-preset-viewer">
          <div className="deck-preset-viewer-stage">
            <img id="deckPresetViewerImage" alt="" />
            {" "}
            <button type="button" className="deck-preset-viewer-nav deck-preset-viewer-prev" id="deckPresetPrev" aria-label="Previous slide">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            {" "}
            <button type="button" className="deck-preset-viewer-nav deck-preset-viewer-next" id="deckPresetNext" aria-label="Next slide">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </div>
          <div className="deck-preset-viewer-thumbs" id="deckPresetThumbs" />
        </div>
        <div className="deck-preset-info">
          <h2 id="deckPresetDialogTitle" />
          {" "}
          <p className="deck-preset-info-category" id="deckPresetCategory" />
          {" "}
          <p className="deck-preset-info-desc" id="deckPresetDesc" />
          {" "}
          <div className="deck-preset-swatches" id="deckPresetSwatches" />
          {" "}
          <button type="button" className="deck-preset-use-btn" id="deckPresetUseBtn">Use</button>
        </div>
      </div>
    </dialog>
  );
}

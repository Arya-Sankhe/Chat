const NBSP = "\u00A0";
const graphemeSegmenter = Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;
/** Split text into user-perceived characters, with code-point fallback. */
export function segmentTextIntoGraphemes(text) {
    if (!graphemeSegmenter)
        return Array.from(text);
    return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
}
/** Preserve regular spaces inside individually measured glyph cells. */
export function getVisibleSegmentText(segment) {
    return segment === " " ? NBSP : segment;
}

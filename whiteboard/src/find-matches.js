// Use Excalidraw's own wrapped-text and font measurements for every occurrence.
export function findMatches(elements, query, getMatchedLines) {
  const needle = query.trim();
  if (!needle) return [];
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return elements.flatMap((element) => {
    if (element.isDeleted || element.type !== "text") return [];
    const text = element.originalText ?? element.text;
    const matchedLines = [...text.matchAll(pattern)].flatMap((match) => getMatchedLines(element, needle, match.index));
    return matchedLines.length ? [{ element, id: element.id, focus: false, matchedLines }] : [];
  });
}

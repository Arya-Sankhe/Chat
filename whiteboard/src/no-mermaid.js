// Boards have no text-to-diagram dialog, so Excalidraw's Mermaid converter (and the ~5 MB of
// diagram libraries behind it) is left out of the build.
export async function parseMermaidToExcalidraw() {
  throw new Error("Mermaid diagrams are not available on Dojo boards.");
}

// Copies the fonts Excalidraw loads at runtime next to the whiteboard bundle, so boards never
// fetch fonts from a CDN. Xiaolai (CJK, ~12 MB) is left out; those glyphs fall back to esm.sh.
import { cp, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const fonts = path.join(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const out = path.join(root, "public/vendor/whiteboard/fonts");
for (const family of await readdir(fonts)) {
  if (family === "Xiaolai") continue;
  await cp(path.join(fonts, family), path.join(out, family), { recursive: true });
}
await cp(path.join(root, "whiteboard/LICENSE-excalidraw"), path.join(root, "public/vendor/whiteboard/LICENSE-excalidraw"));
await writeFile(path.join(out, "README.txt"), [
  "Fonts shipped with Excalidraw 0.18.1, each under the SIL Open Font License 1.1 (https://openfontlicense.org):",
  "Excalifont (Excalidraw; Your Own Font Foundry; Ján Filípek / DizajnDesign), Virgil (Your Own Font Foundry),",
  "Nunito, Lilita One, Comic Shanns, Cascadia Code, Liberation Sans, Assistant.",
  ""
].join("\n"));
console.log("whiteboard fonts copied");

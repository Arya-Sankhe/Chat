import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Builds the whiteboard editor island (whiteboard/src) into public/vendor/whiteboard.
// Run `npm run whiteboard:build` after changing whiteboard/src or the Excalidraw version.
// Excalidraw falls back to esm.sh for fonts it cannot find locally (the CJK face we don't ship).
// Point that fallback at our own copy too, so boards never load anything from a CDN; missing
// glyphs use the system font instead.
const CDN_FALLBACK = "`https://esm.sh/${M.PKG_NAME?`${M.PKG_NAME}@${M.PKG_VERSION}`:\"@excalidraw/excalidraw\"}/dist/prod/`";
const noCdnFonts = {
  name: "klui-no-cdn-fonts",
  transform(code, id) {
    if (!id.includes("@excalidraw/excalidraw/dist/prod/") || !code.includes("ASSETS_FALLBACK_URL")) return null;
    if (!code.includes(CDN_FALLBACK)) throw new Error("Excalidraw's CDN font fallback moved; update vite.whiteboard.config.js.");
    // It is used as a URL base, so it must be absolute.
    return { code: code.replace(CDN_FALLBACK, '`${window.location.origin}/vendor/whiteboard/`'), map: null };
  }
};

// The pinned package keeps its search measurement helper private. Expose that same helper
// to our compact Find UI; the canvas still renders the native searchMatches highlights.
const nativeFind = {
  name: "klui-native-find",
  transform(code, id) {
    if (!id.includes("@excalidraw/excalidraw/dist/prod/index.js")) return null;
    const helper = code.match(/([\w$]+)=\(e,o,t\)=>\{let n=[\w$]+\(e\.text,e\.originalText\)/)?.[1];
    if (!helper || !code.includes('"rgba(99, 52, 0, 0.4)"')) throw new Error("Excalidraw's native search moved; update the Find build adapter.");
    return {
      code: code.replace('"rgba(99, 52, 0, 0.4)"', '"rgba(255, 226, 0, 0.4)"') + `\nexport { ${helper} as nativeGetMatchedLines };`,
      map: null
    };
  }
};

// The native help list is static; omit shortcuts for features disabled by this board.
const boardHelp = {
  name: "klui-board-help",
  transform(code, id) {
    if (!id.includes("@excalidraw/excalidraw/dist/prod/index.js")) return null;
    for (const row of [
      'B(U,{label:g("toolBar.frame"),shortcuts:[y.F]})',
      'B(U,{label:g("labels.toggleTheme"),shortcuts:[A("Alt+Shift+D")]})'
    ]) {
      if (code.split(row).length !== 2) throw new Error("Excalidraw's help shortcuts moved; update the board help adapter.");
      code = code.replace(row, "null");
    }
    return { code, map: null };
  }
};

const imageSizing = {
  name: "klui-image-sizing",
  transform(code, id) {
    if (!id.includes("@excalidraw/excalidraw/dist/prod/index.js")) return null;
    const nativeSize = "let i=Math.max(this.state.height-120,160),a=Math.min(i,Math.floor(this.state.height*.5)/this.state.zoom.value),l=Math.min(n.naturalHeight,a),s=l*(n.naturalWidth/n.naturalHeight),c=";
    if (!code.includes(nativeSize)) throw new Error("Excalidraw's image sizing moved; update the image sizing adapter.");
    const helper = fileURLToPath(new URL("whiteboard/src/image-size.js", import.meta.url));
    return { code: `import { fitImageSize as kluiFitImageSize } from ${JSON.stringify(helper)};\n` + code.replace(nativeSize, "let {height:l,width:s}=kluiFitImageSize(n.naturalWidth,n.naturalHeight,this.state),c="), map: null };
  }
};

export default defineConfig({
  plugins: [noCdnFonts, nativeFind, imageSizing, boardHelp],
  publicDir: false,
  resolve: { alias: { "@excalidraw/mermaid-to-excalidraw": fileURLToPath(new URL("whiteboard/src/no-mermaid.js", import.meta.url)) } },
  base: "/vendor/whiteboard/",
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "process.env.IS_PREACT": JSON.stringify("false") },
  build: {
    outDir: "public/vendor/whiteboard",
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: "whiteboard/src/island.js",
      formats: ["es"],
      fileName: () => "board.js",
      cssFileName: "board"
    },
    rollupOptions: {
      output: { chunkFileNames: "chunks/[name]-[hash].js", assetFileNames: "[name][extname]" }
    }
  }
});

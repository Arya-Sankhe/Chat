import { defineConfig } from "vite";

export default defineConfig({
  root: "public",
  publicDir: false,
  base: "/",
  build: {
    outDir: "../dist-mobile",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: "public/index.html"
    }
  }
});

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/* The dev server proxies /api to a Klui backend so requests stay same-origin,
   exactly like the production site. KLUI_API_TARGET picks the backend. */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "KLUI_");
  const target = env.KLUI_API_TARGET || "http://localhost:3000";
  return {
    plugins: [react()],
    server: {
      port: 5180,
      strictPort: true,
      proxy: { "/api": { target, changeOrigin: true } }
    },
    build: { outDir: "dist", sourcemap: true, target: "es2022" }
  };
});

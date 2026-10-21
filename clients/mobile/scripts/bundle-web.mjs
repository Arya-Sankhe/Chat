// Builds the web client into the native host's APK assets (served in the app
// at https://localhost). The website's marketing pages (home/) stay out.
//   node scripts/bundle-web.mjs
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobile = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(mobile, "..", "web");
const out = path.join(mobile, "modules", "klui-host", "android", "src", "main", "assets", "web");

execFileSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir", "--sourcemap", "false"], { cwd: web, stdio: "inherit" });
await rm(path.join(out, "home"), { recursive: true, force: true });
console.log(`Web client bundled into ${path.relative(mobile, out)}`);

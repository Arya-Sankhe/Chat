// Builds the web client into the native host's APK assets (served in the app
// at https://localhost). The website's marketing pages (home/) stay out.
//   node scripts/bundle-web.mjs          Android assets (runs from Gradle)
//   node scripts/bundle-web.mjs --ios    iOS resources (runs when pods install)
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobile = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(mobile, "..", "web");
const host = path.join(mobile, "modules", "klui-host");
const out = process.argv.includes("--ios")
  ? path.join(host, "ios", "web")
  : path.join(host, "android", "src", "main", "assets", "web");

execFileSync("npx", ["vite", "build", "--outDir", out, "--emptyOutDir", "--sourcemap", "false"], { cwd: web, stdio: "inherit" });
await rm(path.join(out, "home"), { recursive: true, force: true });
console.log(`Web client bundled into ${path.relative(mobile, out)}`);

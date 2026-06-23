import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "public");
const destination = path.join(root, "dist-mobile");

await mkdir(destination, { recursive: true });
for (const entry of ["img", "icons", "favicon.svg", "manifest.webmanifest", "offline.html"]) {
  await cp(path.join(source, entry), path.join(destination, entry), { recursive: true });
}

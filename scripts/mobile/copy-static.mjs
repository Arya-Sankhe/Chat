import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "public");
const destination = path.join(root, "dist-mobile");

await mkdir(destination, { recursive: true });

const mobileIndex = await readFile(path.join(destination, "index.html"), "utf8");
if (!mobileIndex.includes('id="deepResearchToggle"')) {
  throw new Error("Mobile build is missing the Deep Research control.");
}

for (const entry of ["img", "icons", "favicon.svg", "manifest.webmanifest", "offline.html"]) {
  await cp(path.join(source, entry), path.join(destination, entry), { recursive: true });
}

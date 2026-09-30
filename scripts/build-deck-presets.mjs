// Build the slide-preset gallery: render every deck theme with a sample deck, convert the
// slides to images in the document worker container (LibreOffice + pdftoppm), and write
// public/deck-presets/<theme>/NN.webp plus public/deck-presets/catalog.json.
//
// usage: node scripts/build-deck-presets.mjs [theme ...]
//   DECK_PRESET_CONTAINER  worker container with soffice/pdftoppm/Pillow (default chat-document-worker-1)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderDeck } from "../worker/deck/render.js";
import { THEMES, THEME_GROUPS } from "../worker/deck/themes.js";
import { SAMPLES, SAMPLE_FOR_CATEGORY } from "./deck-presets/samples.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "deck-presets");
const container = process.env.DECK_PRESET_CONTAINER || "chat-document-worker-1";
const only = process.argv.slice(2);
const names = Object.keys(THEMES).filter((name) => !only.length || only.includes(name));

const work = mkdtempSync(join(tmpdir(), "deck-presets-"));
const remote = `/tmp/deck-presets-${process.pid}`;
const docker = (...args) => execFileSync("docker", args, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 }).toString();

try {
  mkdirSync(join(work, "pptx"), { recursive: true });
  for (const name of names) {
    const meta = THEMES[name].meta;
    const sample = structuredClone(SAMPLES[SAMPLE_FOR_CATEGORY[meta.category]]);
    const { warnings } = await renderDeck({ ...sample, theme: name }, join(work, "pptx", `${name}.pptx`));
    if (warnings.length) console.warn(`${name}: ${warnings.join("; ")}`);
  }

  // Convert in the container: PPTX -> PDF -> PNG (1920 px) -> webp (960 px slides, 640 px cover).
  const script = `
import glob, os, subprocess
from PIL import Image
os.chdir("${remote}")
subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", "pdf"] + sorted(glob.glob("pptx/*.pptx")), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for pdf in sorted(glob.glob("pdf/*.pdf")):
    name = os.path.basename(pdf)[:-4]
    os.makedirs(f"out/{name}", exist_ok=True)
    subprocess.run(["pdftoppm", "-r", "144", "-png", pdf, f"png/{name}"], check=True)
    pages = sorted(glob.glob(f"png/{name}-*.png"))
    for index, page in enumerate(pages, 1):
        image = Image.open(page).convert("RGB")
        image.resize((960, 540), Image.LANCZOS).save(f"out/{name}/{index:02d}.webp", "WEBP", quality=80, method=6)
        if index == 1:
            image.resize((640, 360), Image.LANCZOS).save(f"out/{name}/cover.webp", "WEBP", quality=82, method=6)
`;
  writeFileSync(join(work, "convert.py"), script);
  mkdirSync(join(work, "pdf"));
  mkdirSync(join(work, "png"));
  mkdirSync(join(work, "out"));
  docker("exec", container, "rm", "-rf", remote);
  docker("cp", work, `${container}:${remote}`);
  docker("exec", container, "python", `${remote}/convert.py`);
  rmSync(join(work, "out"), { recursive: true, force: true });
  docker("cp", `${container}:${remote}/out`, join(work, "out"));
  docker("exec", container, "rm", "-rf", remote);

  mkdirSync(outDir, { recursive: true });
  for (const name of names) {
    const target = join(outDir, name);
    rmSync(target, { recursive: true, force: true });
    execFileSync("cp", ["-R", join(work, "out", name), target]);
  }

  // The catalog always lists every theme, in gallery order (students first, then work).
  const order = THEME_GROUPS.flatMap((group) => group.categories.map((category) => category.id));
  const presets = Object.values(THEMES)
    .filter((theme) => theme.meta && existsSync(join(outDir, theme.name)))
    .sort((a, b) => order.indexOf(a.meta.category) - order.indexOf(b.meta.category))
    .map((theme) => {
      const slides = readdirSync(join(outDir, theme.name)).filter((file) => /^\d+\.webp$/.test(file)).sort();
      return {
        id: theme.name,
        name: theme.label,
        group: theme.meta.group,
        category: theme.meta.category,
        description: theme.meta.description,
        dark: Boolean(theme.dark),
        swatches: [theme.colors.bg, theme.colors.accent, theme.colors.accent2, theme.colors.accent3],
        cover: `/deck-presets/${theme.name}/cover.webp`,
        slides: slides.map((file) => `/deck-presets/${theme.name}/${file}`)
      };
    });
  writeFileSync(join(outDir, "catalog.json"), `${JSON.stringify({ version: 1, groups: THEME_GROUPS, presets }, null, 2)}\n`);
  console.log(`${names.length} theme(s) rendered; catalog lists ${presets.length} presets.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

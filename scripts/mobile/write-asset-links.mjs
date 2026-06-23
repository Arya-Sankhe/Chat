import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const fingerprint = String(process.env.KLUI_ANDROID_SHA256 || "").trim().toUpperCase();
if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint)) {
  console.error("Set KLUI_ANDROID_SHA256 to the release certificate SHA-256 fingerprint.");
  process.exit(1);
}

const output = path.join(process.cwd(), "public", ".well-known", "assetlinks.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify([{
  relation: ["delegate_permission/common.handle_all_urls"],
  target: {
    namespace: "android_app",
    package_name: "tech.klui.app",
    sha256_cert_fingerprints: [fingerprint]
  }
}], null, 2)}\n`);
console.log(`Wrote ${output}`);

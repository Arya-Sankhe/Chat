import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const [apkArgument, versionName = "1.0.0", versionCodeArgument = "1", ...notes] = process.argv.slice(2);
if (!apkArgument) {
  console.error("Usage: npm run mobile:release:publish -- <apk-path> <version-name> <version-code> [release notes...]");
  process.exit(1);
}

const versionCode = Number.parseInt(versionCodeArgument, 10);
if (!Number.isInteger(versionCode) || versionCode < 1) {
  console.error("version-code must be a positive integer.");
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(versionName)) {
  console.error("version-name must be a valid release version such as 1.0.0.");
  process.exit(1);
}

const root = process.cwd();
const source = path.resolve(root, apkArgument);
if (source.toLowerCase().includes("unsigned")) {
  console.error("Refusing to publish an unsigned APK.");
  process.exit(1);
}
const expectedCertificate = String(process.env.KLUI_ANDROID_SHA256 || "")
  .replace(/[^0-9a-f]/gi, "")
  .toLowerCase();
if (!/^[0-9a-f]{64}$/.test(expectedCertificate)) {
  console.error("Set KLUI_ANDROID_SHA256 to the production signing certificate SHA-256 fingerprint.");
  process.exit(1);
}

async function executable(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (!candidate.includes(path.sep)) {
      const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
      if (!result.error) return candidate;
      continue;
    }
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next known Android SDK location.
    }
  }
  return "";
}

function sdkCandidates(relativePath) {
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), "Library", "Android", "sdk"),
    "/opt/homebrew/share/android-commandlinetools"
  ].filter(Boolean);
  return sdkRoots.map((sdkRoot) => path.join(sdkRoot, relativePath));
}

const apksigner = await executable([
  "apksigner",
  ...sdkCandidates("build-tools/36.0.0/apksigner"),
  ...sdkCandidates("build-tools/35.0.0/apksigner")
]);
if (!apksigner) {
  console.error("Could not find apksigner. Add Android SDK build-tools to PATH.");
  process.exit(1);
}
const signatureCheck = spawnSync(
  apksigner,
  ["verify", "--verbose", "--print-certs", source],
  { encoding: "utf8" }
);
if (signatureCheck.status !== 0) {
  console.error(signatureCheck.stderr.trim() || "APK signature verification failed.");
  process.exit(1);
}
const certificateMatch = signatureCheck.stdout.match(/certificate SHA-256 digest:\s*([0-9a-f]+)/i);
const actualCertificate = certificateMatch?.[1]?.toLowerCase() || "";
if (actualCertificate !== expectedCertificate) {
  console.error("APK is not signed with the configured production certificate.");
  process.exit(1);
}

const apkanalyzer = await executable([
  "apkanalyzer",
  ...sdkCandidates("cmdline-tools/latest/bin/apkanalyzer")
]);
if (!apkanalyzer) {
  console.error("Could not find apkanalyzer. Add Android SDK command-line tools to PATH.");
  process.exit(1);
}
function manifestValue(field) {
  const result = spawnSync(apkanalyzer, ["manifest", field, source], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr.trim() || `Could not read APK ${field}.`);
    process.exit(1);
  }
  return result.stdout.trim();
}

const applicationId = manifestValue("application-id");
const builtVersionName = manifestValue("version-name");
const builtVersionCode = Number.parseInt(manifestValue("version-code"), 10);
if (applicationId !== "tech.klui.app") {
  console.error(`Unexpected application ID: ${applicationId}`);
  process.exit(1);
}
if (builtVersionName !== versionName || builtVersionCode !== versionCode) {
  console.error(
    `APK version ${builtVersionName} (${builtVersionCode}) does not match requested metadata ${versionName} (${versionCode}).`
  );
  process.exit(1);
}

const outputDirectory = path.join(root, "public", "downloads", "android");
const fileName = `klui-${versionName}.apk`;
const destination = path.join(outputDirectory, fileName);
await mkdir(outputDirectory, { recursive: true });
await copyFile(source, destination);

const bytes = await readFile(destination);
const file = await stat(destination);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const metadata = {
  published: true,
  versionName,
  versionCode,
  minimumVersionCode: 1,
  apkUrl: `https://klui.tech/downloads/android/${fileName}`,
  releaseNotes: notes,
  sizeBytes: file.size,
  sha256,
  releasedAt: new Date().toISOString()
};

await writeFile(
  path.join(outputDirectory, "latest.json"),
  `${JSON.stringify(metadata, null, 2)}\n`
);
console.log(`Published ${fileName}`);
console.log(`SHA-256 ${sha256}`);

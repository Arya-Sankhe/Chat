import { appVersion, isNative, openExternal, storage } from "./index.js";

const UPDATE_URL = "https://klui.tech/downloads/android/latest.json";
const LAST_CHECK_KEY = "klui.mobile.last-update-check.v1";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function compareVersionCodes(installed, available) {
  const current = Number.parseInt(installed, 10);
  const latest = Number.parseInt(available, 10);
  if (!Number.isInteger(current) || !Number.isInteger(latest)) return 0;
  return Math.sign(latest - current);
}

export async function checkForAppUpdate({ force = false } = {}) {
  if (!isNative()) return null;
  const now = Date.now();
  const previous = Number.parseInt(await storage.get(LAST_CHECK_KEY) || "0", 10);
  if (!force && previous && now - previous < CHECK_INTERVAL_MS) return null;
  await storage.set(LAST_CHECK_KEY, String(now));
  const response = await fetch(`${UPDATE_URL}?t=${now}`, {
    cache: "no-store",
    signal: AbortSignal.timeout?.(5000)
  });
  if (!response.ok) return null;
  const metadata = await response.json();
  if (!metadata?.published) return null;
  const installed = await appVersion();
  if (compareVersionCodes(installed.build, metadata.versionCode) <= 0) return null;
  return {
    ...metadata,
    required: Number(installed.build) < Number(metadata.minimumVersionCode || 0)
  };
}

export function openAppUpdate(metadata) {
  return openExternal(metadata?.apkUrl || "https://klui.tech/download/android");
}

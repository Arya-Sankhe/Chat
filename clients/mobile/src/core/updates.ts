import * as Application from "expo-application";
import { Platform } from "react-native";
import { create } from "zustand";
import { prefs } from "./prefs";
import { PARITY_BUILD } from "./runtime";

/* The Android app's own update feed; iOS updates through the store. */
const UPDATE_URL = PARITY_BUILD ? "http://localhost:55433/latest.json" : "https://klui.ai/downloads/android/latest.json";
const LAST_CHECK_KEY = "klui.mobile.last-update-check.v1";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type AppUpdate = { apkUrl?: string; body?: string; required: boolean };

export const useAppUpdate = create<{ update: AppUpdate | null }>(() => ({ update: null }));

/** At launch and every resume. A required update stays up until it's installed. */
export async function checkForUpdate() {
  if (Platform.OS !== "android") return;
  const now = Date.now();
  const previous = Number(prefs.get(LAST_CHECK_KEY) || 0);
  if (!PARITY_BUILD && previous && now - previous < CHECK_INTERVAL_MS) return;
  prefs.set(LAST_CHECK_KEY, String(now));
  try {
    const response = await fetch(`${UPDATE_URL}?t=${now}`, { cache: "no-store", signal: AbortSignal.timeout?.(5000) });
    if (!response.ok) return;
    const metadata = await response.json() as { published?: boolean; versionCode?: number | string; minimumVersionCode?: number | string; apkUrl?: string; body?: string };
    const installed = Number(Application.nativeBuildVersion);
    const latest = Number(metadata?.versionCode);
    if (!metadata?.published || !Number.isInteger(installed) || !Number.isInteger(latest) || latest <= installed) return;
    useAppUpdate.setState({ update: { ...metadata, required: installed < Number(metadata.minimumVersionCode || 0) } });
  } catch {
    // Offline or a bad feed never gets in the way.
  }
}

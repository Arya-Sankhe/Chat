import type { ExpoConfig } from "expo/config";

/* Release builds keep the Capacitor app's identity (tech.klui.app) so they can
   update it in place. Development builds install side by side under .dev. */
const variant = process.env.APP_VARIANT === "production" ? "production" : "development";
const production = variant === "production";
// Parity builds run against the local backend (plain http on localhost) and
// let the test harness attach to the WebView. Never set for a release.
const parity = !production && process.env.KLUI_PARITY_BUILD === "1";
// A parity build may take another package (KLUI_PARITY_APP_ID) to install over
// a Capacitor test build and check the upgrade path.
const appId = production ? "tech.klui.app" : (parity && process.env.KLUI_PARITY_APP_ID) || "tech.klui.app.dev";

const config: ExpoConfig = {
  name: production ? "Klui" : "Klui Dev",
  slug: "klui",
  scheme: appId,
  // Release builds take their version from the same variables the Capacitor
  // build read, so an update installs over it (a higher versionCode).
  version: process.env.KLUI_VERSION_NAME || "1.2.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  backgroundColor: "#020611",
  ios: {
    bundleIdentifier: appId,
    supportsTablet: true,
    config: { usesNonExemptEncryption: false }
  },
  android: {
    package: appId,
    versionCode: Number.parseInt(process.env.KLUI_VERSION_CODE || "1", 10),
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#020611" },
    // As the Capacitor app: the page avoids the keyboard itself (the host
    // forwards its animated height), and chat links open in the app.
    softwareKeyboardLayoutMode: "resize",
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        category: ["BROWSABLE", "DEFAULT"],
        data: [
          { scheme: "https", host: "klui.ai", pathPrefix: "/c/" },
          { scheme: "https", host: "klui.tech", pathPrefix: "/c/" }
        ]
      }
    ]
  },
  plugins: [
    "expo-secure-store",
    "expo-web-browser",
    ["expo-splash-screen", { backgroundColor: "#020611", image: "./assets/splash-icon.png", imageWidth: 160 }],
    // usesCleartextTraffic is always written, so a non-clean production prebuild
    // after a parity one turns plain http back off.
    ["expo-build-properties", { android: { minSdkVersion: 29, usesCleartextTraffic: parity } }],
    ["./plugins/withKluiRelease", { requireSigning: production }]
  ],
  extra: {
    apiOrigin: process.env.EXPO_PUBLIC_KLUI_API_ORIGIN || "https://klui.ai",
    authCallback: `${appId}://auth/callback`,
    webDebugging: parity
  }
};

export default config;

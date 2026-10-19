import type { ExpoConfig } from "expo/config";

/* Release builds keep the Capacitor app's identity (tech.klui.app) so they can
   update it in place. Development builds install side by side under .dev. */
const variant = process.env.APP_VARIANT === "production" ? "production" : "development";
const production = variant === "production";
const appId = production ? "tech.klui.app" : "tech.klui.app.dev";

const config: ExpoConfig = {
  name: production ? "Klui" : "Klui Dev",
  slug: "klui",
  scheme: appId,
  version: "1.2.0",
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
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#020611" }
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    ["expo-splash-screen", { backgroundColor: "#020611", image: "./assets/splash-icon.png", imageWidth: 160 }],
    ["expo-build-properties", { android: { minSdkVersion: 29 } }]
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiOrigin: process.env.EXPO_PUBLIC_KLUI_API_ORIGIN || "https://klui.ai",
    authCallback: `${appId}://auth/callback`
  }
};

export default config;

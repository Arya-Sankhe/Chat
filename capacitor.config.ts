import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "tech.klui.app",
  appName: "Klui",
  webDir: "dist-mobile",
  server: {
    hostname: "localhost",
    iosScheme: "capacitor",
    androidScheme: "https",
    cleartext: false
  },
  android: {
    webContentsDebuggingEnabled: false,
    buildOptions: {
      releaseType: "APK",
      signingType: "apksigner"
    }
  },
  ios: {
    preferredContentMode: "mobile"
  },
  plugins: {
    App: {
      disableBackButtonHandler: false
    },
    Keyboard: {
      resize: "none",
      resizeOnFullScreen: false
    },
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: "#020611",
      showSpinner: false
    },
    StatusBar: {
      overlaysWebView: true,
      backgroundColor: "#00000000"
    },
    SystemBars: {
      // The Android plugin otherwise pads the WebView below the hidden status bar.
      insetsHandling: "disable"
    }
  }
};

export default config;

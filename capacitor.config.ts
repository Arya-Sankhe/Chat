import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "tech.klui.app",
  appName: "Klui",
  webDir: "dist-mobile",
  server: {
    hostname: "localhost",
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
  plugins: {
    App: {
      disableBackButtonHandler: true
    },
    Keyboard: {
      resize: "native"
    },
    SplashScreen: {
      launchShowDuration: 700,
      backgroundColor: "#ffffff",
      showSpinner: false
    },
    StatusBar: {
      overlaysWebView: true,
      backgroundColor: "#ffffff"
    }
  }
};

export default config;

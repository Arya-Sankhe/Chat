import Constants from "expo-constants";
import { useEffect, useMemo } from "react";
import { AppState, BackHandler, Linking, StyleSheet } from "react-native";
import type { NativeHostInfo } from "@klui/shared";
import { KluiHost, KluiWebView } from "../../modules/klui-host";
import { emit, handleMessage, hostInfo } from "./bridge";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiOrigin?: string; authCallback?: string; webDebugging?: boolean };

/** The whole app: the web client in one WebView, as the Capacitor app was. */
export function WebClient() {
  const script = useMemo(() => {
    const info: NativeHostInfo = {
      platform: "android",
      apiOrigin: (extra.apiOrigin || "https://klui.ai").replace(/\/+$/, ""),
      authCallback: KluiHost.applicationId ? `${KluiHost.applicationId}://auth/callback` : extra.authCallback || "tech.klui.app://auth/callback",
      ...hostInfo()
    };
    return `window.__kluiNative=${JSON.stringify(info)};`;
  }, []);

  useEffect(() => {
    const url = Linking.addEventListener("url", ({ url }) => emit({ type: "appUrlOpen", url }));
    const state = AppState.addEventListener("change", (next) => emit({ type: "appStateChange", isActive: next === "active" }));
    // The page decides what Back closes, and exits the app itself (App.exitApp).
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      emit({ type: "backButton" });
      return true;
    });
    const voiceEnd = KluiHost.addListener("onVoiceEnd", () => emit({ type: "voiceEnd" }));
    return () => {
      voiceEnd.remove();
      url.remove();
      state.remove();
      back.remove();
    };
  }, []);

  return (
    <KluiWebView
      style={StyleSheet.absoluteFill}
      startPath="/"
      documentStartScript={script}
      debuggingEnabled={__DEV__ || Boolean(extra.webDebugging)}
      onMessage={(event: { nativeEvent: { data: string } }) => void handleMessage(event.nativeEvent.data)}
    />
  );
}

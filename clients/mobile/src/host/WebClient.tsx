import Constants from "expo-constants";
import { useEffect, useMemo, useRef } from "react";
import { AppState, Platform, StyleSheet } from "react-native";
import type { NativeHostInfo, WebSurfaceTarget } from "@klui/shared";
import { useShell } from "../core/shell";
import { KluiHost, KluiWebView } from "../../modules/klui-host";
import { emit, handleMessage, hostInfo } from "./bridge";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiOrigin?: string; authCallback?: string; webDebugging?: boolean };

/** The web client as one surface of the app: what isn't native yet, or shouldn't be. */
export function WebClient({ target }: { target: WebSurfaceTarget }) {
  const script = useMemo(() => {
    const info: NativeHostInfo = {
      platform: Platform.OS === "ios" ? "ios" : "android",
      apiOrigin: (extra.apiOrigin || "https://klui.ai").replace(/\/+$/, ""),
      authCallback: KluiHost.applicationId ? `${KluiHost.applicationId}://auth/callback` : extra.authCallback || "tech.klui.app://auth/callback",
      embedded: true,
      startTarget: target,
      ...hostInfo()
    };
    return `window.__kluiNative=${JSON.stringify(info)};`;
    // The document's start script is read once; later targets go by event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In use means the app is in front and this surface is showing.
  const visible = useShell((state) => state.webVisible);
  const sendActive = useRef(() => {});
  sendActive.current = () => emit({ type: "appStateChange", isActive: AppState.currentState === "active" && useShell.getState().webVisible });
  const shown = useRef(visible);
  useEffect(() => {
    if (shown.current === visible) return;
    shown.current = visible;
    emit({ type: "surfaceVisibility", visible });
    sendActive.current();
    if (!visible) KluiHost.hideKeyboard();
  }, [visible]);

  const request = useShell((state) => state.webRequest);
  const seen = useRef(request);
  useEffect(() => {
    if (seen.current === request) return;
    seen.current = request;
    emit({ type: "openTarget", target });
  }, [request, target]);

  useEffect(() => {
    const state = AppState.addEventListener("change", () => sendActive.current());
    const voiceEnd = KluiHost.addListener("onVoiceEnd", () => emit({ type: "voiceEnd" }));
    return () => {
      voiceEnd.remove();
      state.remove();
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

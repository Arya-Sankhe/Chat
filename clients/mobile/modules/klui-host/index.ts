import { requireNativeModule, requireNativeView } from "expo";
import type { ViewProps } from "react-native";

export type KluiWebViewProps = ViewProps & {
  /** The route the page opens on, e.g. "/" or "/c/<id>". Read once, on first load. */
  startPath: string;
  /** Runs before the page's own scripts on every https://localhost document. */
  documentStartScript: string;
  textZoom?: number;
  debuggingEnabled?: boolean;
  onMessage?: (event: { nativeEvent: { data: string } }) => void;
  onLoadEnd?: (event: { nativeEvent: { url: string } }) => void;
};

export const KluiWebView = requireNativeView<KluiWebViewProps>("KluiHost");

type KluiHostModule = {
  readonly applicationId: string;
  evaluate(script: string): void;
  showKeyboard(): void;
  hideKeyboard(): void;
  syncSystemBarInsets(): void;
  setTextZoom(percent: number): Promise<number>;
  setSystemBarStyle(dark: boolean): void;
  composeEmail(app: string, to: string, subject: string, body: string): void;
  voiceStart(): Promise<{ running: boolean }>;
  voiceStop(): void;
  readLegacyStorage(): Promise<{ secure: Record<string, string>; prefs: Record<string, string> }>;
  clearLegacyStorage(secureKeys: string[], prefKeys: string[]): Promise<void>;
  addListener(event: "onVoiceEnd", listener: () => void): { remove(): void };
};

export const KluiHost = requireNativeModule<KluiHostModule>("KluiHost");

import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { migrateLegacyStorage } from "./host/bridge";
import { WebClient } from "./host/WebClient";

void SplashScreen.preventAutoHideAsync();

export function App() {
  // The page reads its session at boot, so the Capacitor app's is carried over first.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void migrateLegacyStorage().finally(() => setReady(true));
  }, []);
  // The page paints its own launch screen; hand over once it is up.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void SplashScreen.hideAsync(), 400);
    return () => clearTimeout(timer);
  }, [ready]);
  return (
    <View style={{ flex: 1, backgroundColor: "#020611" }}>
      {ready ? <WebClient /> : null}
    </View>
  );
}

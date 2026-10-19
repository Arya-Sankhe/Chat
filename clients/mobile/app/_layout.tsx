import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { boot, useAuth } from "../src/lib/auth";
import { chat } from "../src/lib/runtime";
import { useTheme } from "../src/lib/theme";

void SplashScreen.preventAutoHideAsync();
void boot();

// Back from the background: a stream that went quiet is reattached.
AppState.addEventListener("change", (state) => {
  if (state === "active") chat.onAppResumed();
});

export default function RootLayout() {
  const status = useAuth((state) => state.status);
  const error = useAuth((state) => state.error);
  const colors = useTheme();

  useEffect(() => {
    if (status !== "booting") void SplashScreen.hideAsync();
  }, [status]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <StatusBar style="auto" />
          {status === "booting" ? (
            <View style={[styles.center, { backgroundColor: colors.bg }]}><ActivityIndicator color={colors.textSecondary} /></View>
          ) : status === "error" ? (
            <View style={[styles.center, { backgroundColor: colors.bg }]}>
              <Text style={{ color: colors.danger, textAlign: "center", padding: 24 }}>{error}</Text>
              <Text style={{ color: colors.text, textDecorationLine: "underline" }} onPress={() => void boot()}>Try again</Text>
            </View>
          ) : (
            <Stack screenOptions={{ headerShadowVisible: false, headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
              <Stack.Protected guard={status === "signedIn"}>
                <Stack.Screen name="index" options={{ title: "Klui" }} />
                <Stack.Screen name="chat/[id]" options={{ title: "" }} />
              </Stack.Protected>
              <Stack.Protected guard={status === "signedOut"}>
                <Stack.Screen name="sign-in" options={{ headerShown: false }} />
              </Stack.Protected>
              <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
            </Stack>
          )}
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 } });

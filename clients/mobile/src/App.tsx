import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AppState, BackHandler, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { handleAppUrl, listenForAppUrls } from "./core/auth";
import { applyAppearance, clearAccount, loadAccount } from "./core/account";
import { chat } from "./core/chat";
import { hostedSessionState, loadConfig, session } from "./core/runtime";
import { openWeb, useShell } from "./core/shell";
import { deliverLink, emit, hasPendingLink, migrateLegacyStorage, pageGone } from "./host/bridge";
import { WebClient } from "./host/WebClient";
import { ChatListScreen } from "./screens/ChatListScreen";
import type { RootStack } from "./screens/navigation";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ThreadScreen } from "./screens/ThreadScreen";
import { SignInScreen } from "./screens/SignInScreen";

void SplashScreen.preventAutoHideAsync();

const Stack = createNativeStackNavigator<RootStack>();

async function start() {
  // The old app's session comes over before the first read.
  await migrateLegacyStorage();
  await session.load();
  await loadConfig();
  applyAppearance();
  useShell.setState({ phase: session.current() ? "signedIn" : "signedOut" });
  if (session.current()) void loadAccount();
  const launch = await Linking.getInitialURL();
  if (launch && !(await handleAppUrl(launch))) openLink(launch);
}

/* A klui.ai/c/<id> link. Waits through sign-in; the page opens it when it's ready. */
function openLink(url: string) {
  if (!/^https:\/\/(www\.)?klui\.(ai|tech)\//i.test(url)) return;
  deliverLink(url);
  if (useShell.getState().phase === "signedIn") openWeb("chat");
}

function watchSession() {
  return session.subscribe((next) => {
    const shell = useShell.getState();
    if (shell.phase === "starting") return;
    const signingIn = next && shell.phase === "signedOut";
    if (next && shell.phase === "signedIn") {
      emit({ type: "sessionChanged", ...hostedSessionState() });
      return;
    }
    if (signingIn) void loadAccount();
    else {
      chat.reset();
      clearAccount();
    }
    // A guest's open page carries on signed in, sending what they wrote.
    if (signingIn && shell.webVisible) {
      useShell.setState({ phase: "signedIn", signInError: "" });
      emit({ type: "sessionChanged", ...hostedSessionState() });
      return;
    }
    // Anything else starts the page over: ending a session must not leave one behind.
    pageGone();
    useShell.setState((state) => ({
      phase: next ? "signedIn" : "signedOut",
      signInError: next ? "" : state.signInError,
      webVisible: false,
      webTarget: null,
      webGeneration: state.webGeneration + 1
    }));
    if (signingIn && hasPendingLink()) openWeb("chat");
  });
}

export function App() {
  const phase = useShell((state) => state.phase);
  const webTarget = useShell((state) => state.webTarget);
  const webVisible = useShell((state) => state.webVisible);
  const generation = useShell((state) => state.webGeneration);

  useEffect(() => {
    const unwatch = watchSession();
    const links = listenForAppUrls(openLink);
    void start()
      .catch((error) => {
        console.warn("Start failed", error);
        useShell.setState({ phase: "signedOut" });
      })
      .finally(() => void SplashScreen.hideAsync());
    return () => {
      unwatch();
      links.remove();
    };
  }, []);

  // Back in front after a while: dropped streams reattach.
  useEffect(() => {
    const state = AppState.addEventListener("change", (next) => { if (next === "active") chat.onAppResumed(); });
    return () => state.remove();
  }, []);

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!useShell.getState().webVisible) return false;
      // The page decides what Back closes; at its root it calls app.exit, which closes the surface.
      emit({ type: "backButton" });
      return true;
    });
    return () => back.remove();
  }, []);

  if (phase === "starting") return <View style={styles.root} />;
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {/* Under an open web surface these screens are covered: screen readers must skip them too. */}
        <View style={styles.root} collapsable={false} accessibilityElementsHidden={webVisible}
          importantForAccessibility={webVisible ? "no-hide-descendants" : "auto"}>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              {phase === "signedIn" ? (
                <>
                  <Stack.Screen name="Chats" component={ChatListScreen} />
                  <Stack.Screen name="Thread" component={ThreadScreen} />
                  <Stack.Screen name="Settings" component={SettingsScreen} />
                </>
              ) : <Stack.Screen name="SignIn" component={SignInScreen} />}
            </Stack.Navigator>
          </NavigationContainer>
        </View>
        {webTarget ? (
          <View testID="webSurface" collapsable={false} pointerEvents={webVisible ? "auto" : "none"}
            accessibilityElementsHidden={!webVisible}
            importantForAccessibility={webVisible ? "auto" : "no-hide-descendants"}
            style={[StyleSheet.absoluteFill, webVisible ? styles.shown : styles.hidden]}>
            <WebClient key={generation} target={webTarget} />
          </View>
        ) : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#020611" },
  shown: { opacity: 1 },
  hidden: { opacity: 0 }
});

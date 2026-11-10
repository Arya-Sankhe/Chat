import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AppState, BackHandler, Platform, Pressable, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { handleAppUrl, listenForAppUrls } from "./core/auth";
import { applyAppearance, clearAccount, loadAccount } from "./core/account";
import { chat, forgetChatList, showSavedChatList } from "./core/chat";
import { checkForUpdate } from "./core/updates";
import { hostedSessionState, loadConfig, session } from "./core/runtime";
import { closeWebSurface, openWeb, useShell } from "./core/shell";
import { deliverLink, emit, hasPendingLink, migrateLegacyStorage, pageGone, pageIsListening, pageSystemBarDark } from "./host/bridge";
import { WebClient } from "./host/WebClient";
import { KluiHost } from "../modules/klui-host";
import { useTheme } from "./theme";
import { ChatListScreen } from "./screens/ChatListScreen";
import type { RootStack } from "./screens/navigation";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ThreadScreen } from "./screens/ThreadScreen";
import { SignInScreen } from "./screens/SignInScreen";
import { Icon } from "./ui/Icon";
import { Toast } from "./ui/Toast";
import { UpdateDialog } from "./ui/UpdateDialog";

void SplashScreen.preventAutoHideAsync();

const Stack = createNativeStackNavigator<RootStack>();

async function start() {
  // The old app's session comes over before the first read.
  await migrateLegacyStorage();
  await session.load();
  await loadConfig();
  applyAppearance();
  useShell.setState({ phase: session.current() ? "signedIn" : "signedOut" });
  if (session.current()) {
    showSavedChatList();
    void loadAccount();
  } else forgetChatList();
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
      forgetChatList();
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

/* The page decides what Back closes, and at its root it calls app.exit, which closes the surface.
   A page still starting can't answer, so Back closes the surface itself. */
function goBackFromWeb() {
  if (pageIsListening()) emit({ type: "backButton" });
  else closeWebSurface();
}

/* iPhones have no Back button, so the surface needs one of its own. */
function IosWebBar() {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: colors.bg }}>
      <Pressable testID="webBack" accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} onPress={goBackFromWeb} style={styles.webBack}>
        <Icon name="back" color={colors.text} />
      </Pressable>
    </SafeAreaView>
  );
}

export function App() {
  const phase = useShell((state) => state.phase);
  const webTarget = useShell((state) => state.webTarget);
  const webVisible = useShell((state) => state.webVisible);
  const generation = useShell((state) => state.webGeneration);
  const { dark } = useTheme();

  // System bar icons follow what is on screen: the native screens' theme, or, while the web
  // surface shows, the page's own (chrome.configure, reapplied here each time it opens).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const page = pageSystemBarDark();
    if (!webVisible) KluiHost.setSystemBarStyle(dark);
    else if (page !== null) KluiHost.setSystemBarStyle(page);
  }, [dark, webVisible]);

  useEffect(() => {
    const unwatch = watchSession();
    const links = listenForAppUrls(openLink);
    void start()
      .catch((error) => {
        console.warn("Start failed", error);
        useShell.setState({ phase: "signedOut" });
      })
      .finally(() => {
        void SplashScreen.hideAsync();
        void checkForUpdate();
      });
    return () => {
      unwatch();
      links.remove();
    };
  }, []);

  // Back in front after a while: dropped streams reattach.
  useEffect(() => {
    const state = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      chat.onAppResumed();
      void checkForUpdate();
    });
    return () => state.remove();
  }, []);

  // Added as the surface opens, so it runs before the navigator's handler: the newest goes first,
  // and otherwise Back would pop the screen hidden underneath.
  useEffect(() => {
    if (!webVisible) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      goBackFromWeb();
      return true;
    });
    return () => back.remove();
  }, [webVisible]);

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
            {Platform.OS === "ios" ? <IosWebBar /> : null}
            <View style={styles.root}>
              <WebClient key={generation} target={webTarget} />
            </View>
          </View>
        ) : null}
        <Toast />
        <UpdateDialog />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#020611" },
  webBack: { width: 44, height: 44, marginLeft: 8, alignItems: "center", justifyContent: "center" },
  shown: { opacity: 1 },
  hidden: { opacity: 0 }
});

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { signIn } from "../core/auth";
import { openWeb, useShell } from "../core/shell";
import { useTheme } from "../theme";

export function SignInScreen() {
  const { colors } = useTheme();
  const error = useShell((state) => state.signInError);
  const busy = useShell((state) => state.signingIn);
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>Klui</Text>
        <Pressable testID="signIn" accessibilityRole="button" disabled={busy} onPress={() => void signIn()}
          style={[styles.button, { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }]}>
          {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={[styles.label, { color: colors.accentContrast }]}>Continue with Google</Text>}
        </Pressable>
        <Pressable testID="continueAsGuest" accessibilityRole="button" onPress={() => openWeb("chat")} style={styles.guest}>
          <Text style={[styles.guestLabel, { color: colors.textSecondary }]}>Continue without an account</Text>
        </Pressable>
        {error ? <Text testID="signInError" style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 24 },
  title: { fontSize: 34, fontWeight: "600" },
  button: { minHeight: 48, alignSelf: "stretch", borderRadius: 24, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 16, fontWeight: "600" },
  guest: { minHeight: 48, justifyContent: "center", paddingHorizontal: 16 },
  guestLabel: { fontSize: 15 },
  error: { fontSize: 14, textAlign: "center" }
});

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fontSize, radius, space } from "@klui/shared";
import { signInWithGoogle, useAuth } from "../src/lib/auth";
import { useTheme } from "../src/lib/theme";

export default function SignInScreen() {
  const colors = useTheme();
  const error = useAuth((state) => state.error);
  const signingIn = useAuth((state) => state.signingIn);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>Klui</Text>
        <Text style={{ color: colors.textSecondary, fontSize: fontSize.md }}>Sign in to continue.</Text>
        <Pressable
          accessibilityRole="button"
          disabled={signingIn}
          onPress={() => void signInWithGoogle()}
          style={({ pressed }) => [styles.button, { backgroundColor: colors.accent, opacity: pressed || signingIn ? 0.7 : 1 }]}
        >
          {signingIn ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={[styles.buttonText, { color: colors.accentContrast }]}>Continue with Google</Text>}
        </Pressable>
        {error ? <Text style={[styles.error, { color: colors.danger }]} accessibilityRole="alert">{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  title: { fontSize: 34, fontWeight: "700" },
  button: { marginTop: space.lg, minWidth: 260, height: 50, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: fontSize.md, fontWeight: "600" },
  error: { textAlign: "center", fontSize: fontSize.sm }
});

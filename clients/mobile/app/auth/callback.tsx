import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { completeSignIn, useAuth } from "../../src/lib/auth";
import { useTheme } from "../../src/lib/theme";

/* The OAuth redirect opens this route when the browser hands the URL to the
   app rather than back to openAuthSessionAsync (Android, cold starts). */
export default function AuthCallback() {
  const url = Linking.useLinkingURL();
  const colors = useTheme();

  useEffect(() => {
    if (!url) return;
    completeSignIn(url)
      .catch((error: Error) => useAuth.setState({ error: error.message }))
      .finally(() => router.replace("/"));
  }, [url]);

  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}><ActivityIndicator color={colors.textSecondary} /></View>;
}

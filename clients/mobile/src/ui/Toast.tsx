import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShell } from "../core/shell";
import { useTheme } from "../theme";

/* A short message over whatever is showing, native or web. */
export function Toast() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const message = useShell((state) => state.toast);
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 24 }]}>
      <Text testID="toast" accessibilityLiveRegion="polite" style={[styles.text, { backgroundColor: colors.text, color: colors.bg }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 24, right: 24, alignItems: "center" },
  text: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, fontSize: 14, overflow: "hidden" }
});

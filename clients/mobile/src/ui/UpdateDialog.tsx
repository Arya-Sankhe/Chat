import { Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useAppUpdate } from "../core/updates";
import { useTheme } from "../theme";

const DOWNLOAD_URL = "https://klui.ai/download/android";

/* A required update hides Later, and Back doesn't close it. */
export function UpdateDialog() {
  const { colors } = useTheme();
  const update = useAppUpdate((state) => state.update);
  const later = () => useAppUpdate.setState({ update: null });
  return (
    <Modal visible={Boolean(update)} transparent animationType="fade" onRequestClose={() => { if (!update?.required) later(); }}>
      <View style={styles.dim}>
        <View testID="updateDialog" accessibilityViewIsModal style={[styles.box, { backgroundColor: colors.bg }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Klui update available</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{update?.body || "Download the latest Android version."}</Text>
          <View style={styles.actions}>
            {update?.required ? null : (
              <Pressable testID="updateLater" accessibilityRole="button" onPress={later} style={styles.button}>
                <Text style={[styles.label, { color: colors.text }]}>Later</Text>
              </Pressable>
            )}
            <Pressable testID="updateDownload" accessibilityRole="button" onPress={() => void Linking.openURL(update?.apkUrl || DOWNLOAD_URL)}
              style={[styles.button, { backgroundColor: colors.accent }]}>
              <Text style={[styles.label, { color: colors.accentContrast }]}>Download</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.45)" },
  box: { borderRadius: 16, padding: 22, gap: 10 },
  title: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
  button: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 15, fontWeight: "600" }
});

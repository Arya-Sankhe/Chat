import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { fontSize, radius, space } from "@klui/shared";
import { useTheme } from "../lib/theme";

export function Composer({ busy, stopping, draft, onSend, onStop, autoFocus }: {
  busy: boolean;
  stopping: boolean;
  draft: string;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
  autoFocus: boolean;
}) {
  const colors = useTheme();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (draft) setText(draft);
  }, [draft]);

  const submit = async () => {
    if (busy || sending || !text.trim()) return;
    const sent = text;
    setSending(true);
    setError("");
    setText("");
    try {
      await onSend(sent);
    } catch (err) {
      setText(sent);
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const canSend = !sending && Boolean(text.trim());
  return (
    <View style={styles.wrap}>
      {error ? <Text style={[styles.error, { color: colors.danger }]} accessibilityRole="alert">{error}</Text> : null}
      <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.bg }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Ask Klui"
          placeholderTextColor={colors.textTertiary}
          multiline
          autoFocus={autoFocus}
          style={[styles.input, { color: colors.text }]}
          accessibilityLabel="Ask Klui"
        />
        {busy ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Stop" disabled={stopping} onPress={onStop} style={[styles.button, { backgroundColor: colors.accent, opacity: stopping ? 0.5 : 1 }]}>
            {stopping ? <ActivityIndicator size="small" color={colors.accentContrast} /> : <View style={[styles.stop, { backgroundColor: colors.accentContrast }]} />}
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!canSend} onPress={() => void submit()} style={[styles.button, { backgroundColor: colors.accent, opacity: canSend ? 1 : 0.35 }]}>
            <Text style={[styles.arrow, { color: colors.accentContrast }]}>↑</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.sm },
  error: { fontSize: fontSize.sm, marginBottom: space.xs, paddingHorizontal: space.sm },
  box: { flexDirection: "row", alignItems: "flex-end", borderWidth: 1, borderRadius: 24, paddingLeft: space.lg, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, fontSize: fontSize.md, maxHeight: 160, paddingTop: 8, paddingBottom: 8 },
  button: { width: 38, height: 38, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  stop: { width: 13, height: 13, borderRadius: 2 },
  arrow: { fontSize: 20, fontWeight: "700", marginTop: -2 }
});

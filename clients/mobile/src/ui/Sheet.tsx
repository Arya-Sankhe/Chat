import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme";
import { Icon, type IconName } from "./Icon";

export type SheetAction = { id: string; label: string; icon?: IconName; danger?: boolean; onPress: () => void };

/* A bottom sheet of actions. */
export function ActionSheet({ visible, title, actions, onClose }: { visible: boolean; title?: string; actions: SheetAction[]; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: colors.bg, borderColor: colors.border, paddingBottom: insets.bottom + 8 }]}>
        {title ? <Text numberOfLines={1} style={[styles.title, { color: colors.textSecondary }]}>{title}</Text> : null}
        {actions.map((action) => (
          <Pressable key={action.id} testID={action.id} accessibilityRole="button" style={styles.row}
            onPress={() => { onClose(); action.onPress(); }}>
            {action.icon ? <Icon name={action.icon} color={action.danger ? colors.danger : colors.text} /> : null}
            <Text style={[styles.label, { color: action.danger ? colors.danger : colors.text }]}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  title: { fontSize: 13, paddingHorizontal: 20, paddingVertical: 10 },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20 },
  label: { fontSize: 16 }
});

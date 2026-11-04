import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WRITING_STYLE_LABELS } from "@klui/shared";
import { readControls, useAccount, writeControls } from "../core/account";
import { session } from "../core/runtime";
import { openWeb } from "../core/shell";
import { useTheme } from "../theme";
import { Icon } from "../ui/Icon";
import type { RootStack } from "./navigation";

const APPEARANCE = [["light", "Light"], ["dark", "Dark"], ["system", "System"]] as const;

function Choice({ id, label, active, onPress }: { id: string; label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={id} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={onPress}
      style={[styles.choice, { borderColor: active ? colors.text : colors.border, backgroundColor: active ? colors.surface : undefined }]}>
      <Text style={[styles.choiceLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function LinkRow({ id, label, onPress, danger }: { id: string; label: string; onPress: () => void; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={id} accessibilityRole="button" onPress={onPress} style={[styles.link, { borderColor: colors.borderLight }]}>
      <Text style={[styles.linkLabel, { color: danger ? colors.danger : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function SettingsScreen({ navigation }: NativeStackScreenProps<RootStack, "Settings">) {
  const { colors } = useTheme();
  const me = useAccount((state) => state.me) as Record<string, any> | null;
  const accountError = useAccount((state) => state.error);
  const [controls, setControls] = useState(readControls);

  const change = (patch: Record<string, unknown>) => {
    writeControls(patch);
    setControls(readControls());
  };

  const name = me?.profile?.display_name || me?.profile?.full_name || me?.user?.user_metadata?.full_name || "";
  const email = me?.user?.email || "";
  const planName = me?.plan?.name || me?.plan?.label || "";
  const usage = me?.usage ?? {};
  const free = usage.free;

  const confirmSignOut = () => Alert.alert("Sign out?", "", [
    { text: "Cancel", style: "cancel" },
    { text: "Sign out", style: "destructive", onPress: () => void session.signOut() }
  ]);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Pressable testID="settingsBack" accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Icon name="back" color={colors.text} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Settings</Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          {name ? <Text testID="settingsName" style={[styles.name, { color: colors.text }]}>{name}</Text> : null}
          {email ? <Text testID="settingsEmail" style={[styles.meta, { color: colors.textSecondary }]}>{email}</Text> : null}
          {planName ? <Text testID="settingsPlan" style={[styles.meta, { color: colors.textSecondary }]}>{planName}</Text> : null}
          {free?.messages && typeof free.messages.remaining === "number" ? <Text testID="settingsFree" style={[styles.meta, { color: colors.textSecondary }]}>{free.messages.remaining} free messages left today</Text> : null}
          {accountError ? <Text style={[styles.meta, { color: colors.danger }]}>{accountError}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.text }]}>Appearance</Text>
          <View style={styles.choices}>
            {APPEARANCE.map(([id, label]) => (
              <Choice key={id} id={`appearance-${id}`} label={label} active={(controls.appearance || "system") === id} onPress={() => change({ appearance: id })} />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.text }]}>Writing style</Text>
          <View style={styles.choices}>
            {Object.entries(WRITING_STYLE_LABELS).map(([id, label]) => (
              <Choice key={id} id={`style-${id}`} label={label} active={(controls.writingStyle || "normal") === id} onPress={() => change({ writingStyle: id })} />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.heading, { color: colors.text }]}>Custom instructions</Text>
          <TextInput testID="systemPrompt" multiline defaultValue={String(controls.systemPrompt || "")} placeholder="How should Klui respond?" placeholderTextColor={colors.textTertiary}
            onEndEditing={(event) => change({ systemPrompt: event.nativeEvent.text })}
            style={[styles.prompt, { color: colors.text, borderColor: colors.border }]} accessibilityLabel="Custom instructions" />
        </View>

        <View style={styles.section}>
          <LinkRow id="openPlans" label="Plans and upgrade" onPress={() => openWeb("plans")} />
          <LinkRow id="openAllSettings" label="Memory, voice, storage and more" onPress={() => openWeb("settings")} />
          <LinkRow id="signOut" label="Sign out" danger onPress={confirmSignOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", height: 52, paddingHorizontal: 8 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  body: { padding: 18, gap: 26 },
  section: { gap: 10 },
  name: { fontSize: 20, fontWeight: "600" },
  meta: { fontSize: 14 },
  heading: { fontSize: 15, fontWeight: "600" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { minHeight: 40, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, justifyContent: "center" },
  choiceLabel: { fontSize: 14 },
  prompt: { minHeight: 90, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, fontSize: 15, textAlignVertical: "top" },
  link: { minHeight: 50, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  linkLabel: { fontSize: 16 }
});

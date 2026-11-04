import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { NATIVE_ROLES, saveRole, savedRole } from "../core/chat";
import { openWeb } from "../core/shell";
import type { WithdrawnDraft } from "@klui/shared";
import { uploadPicked, type PickedFile } from "../core/uploads";
import { useTheme } from "../theme";
import { Icon } from "../ui/Icon";
import { ActionSheet } from "../ui/Sheet";

const ROLE_LABELS: Record<string, string> = { nitro: "Nitro", think: "Think", pro: "Pro" };

export type ReadyAttachment = { id: string; file: PickedFile };
type Pending = { key: string; file: PickedFile; attachmentId: string; failed: boolean };

let nextKey = 1;

export function Composer({ busy, draft, onDraftTaken, onSend, onStop }: {
  busy: boolean;
  draft?: WithdrawnDraft;
  onDraftTaken: () => void;
  onSend: (text: string, attachments: ReadyAttachment[]) => Promise<void>;
  onStop: () => void;
}) {
  const { colors } = useTheme();
  const [text, setText] = useState("");
  const [role, setRole] = useState(savedRole);
  const [files, setFiles] = useState<Pending[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [sending, setSending] = useState(false);

  // A stopped message is withdrawn by the server: it comes back here, files and all.
  useEffect(() => {
    if (!draft) return;
    setText((current) => current || draft.text);
    setFiles((current) => [...current, ...draft.attachments.map((item) => ({
      key: String(nextKey++),
      file: { uri: item.url, name: item.fileName, mimeType: item.contentType, size: 0, category: item.category },
      attachmentId: item.id,
      failed: false
    }))]);
    onDraftTaken();
  }, [draft]);

  const uploading = files.some((file) => !file.attachmentId && !file.failed);
  const ready = files.filter((file) => file.attachmentId);
  const canSend = !busy && !sending && !uploading && (Boolean(text.trim()) || ready.length > 0);

  function chooseRole(next: string) {
    saveRole(next);
    setRole(next);
  }

  function add(picked: PickedFile[]) {
    // Nitro is text-only.
    if (role === "nitro" && picked.length) chooseRole("think");
    for (const file of picked) {
      const key = String(nextKey++);
      setFiles((current) => [...current, { key, file, attachmentId: "", failed: false }]);
      uploadPicked(file).then((uploaded: { id: string }) => {
        setFiles((current) => current.map((item) => (item.key === key ? { ...item, attachmentId: uploaded.id } : item)));
      }).catch((error: Error) => {
        setFiles((current) => current.map((item) => (item.key === key ? { ...item, failed: true } : item)));
        Alert.alert("Upload failed", error?.message || "The file could not be uploaded.");
      });
    }
  }

  const fromImage = (asset: ImagePicker.ImagePickerAsset): PickedFile => ({
    uri: asset.uri,
    name: asset.fileName || `photo-${Date.now()}.jpg`,
    mimeType: asset.mimeType || "image/jpeg",
    size: asset.fileSize || 0,
    category: "image"
  });

  async function pickPhotos() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.8 });
    if (!result.canceled) add(result.assets.map(fromImage));
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert("Camera", "Allow the camera in your phone's settings to take a photo.");
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled) add(result.assets.map(fromImage));
  }

  async function pickFiles() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    add(result.assets.map((asset) => ({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType || "application/octet-stream",
      size: asset.size || 0,
      category: asset.mimeType?.startsWith("image/") ? "image" : "document"
    })));
  }

  async function send() {
    if (!canSend) return;
    const sentText = text;
    const sentFiles = files;
    setSending(true);
    setText("");
    setFiles([]);
    try {
      await onSend(sentText, ready.map((item) => ({ id: item.attachmentId, file: item.file })));
    } catch (error) {
      setText(sentText);
      setFiles(sentFiles);
      Alert.alert("Not sent", (error as Error)?.message || "Your message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={[styles.box, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      {files.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.files}>
          {files.map((item) => (
            <View key={item.key} testID="composerFile" style={[styles.chip, { borderColor: item.failed ? colors.danger : colors.border }]}>
              {item.file.category === "image" && item.file.uri
                ? <Image source={{ uri: item.file.uri }} style={styles.thumb} />
                : <Icon name="file" size={18} color={colors.textSecondary} />}
              <Text numberOfLines={1} style={[styles.chipName, { color: colors.text }]}>{item.file.name}</Text>
              {!item.attachmentId && !item.failed ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.file.name}`} hitSlop={10}
                onPress={() => setFiles((current) => current.filter((other) => other.key !== item.key))}>
                <Icon name="close" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <TextInput testID="promptInput" value={text} onChangeText={setText} placeholder="Ask Klui" placeholderTextColor={colors.textTertiary}
        multiline style={[styles.input, { color: colors.text }]} accessibilityLabel="Message" />
      <View style={styles.row}>
        <Pressable testID="attachButton" accessibilityRole="button" accessibilityLabel="Add" onPress={() => setAttachOpen(true)}
          style={[styles.round, { backgroundColor: colors.surface }]}>
          <Icon name="plus" color={colors.text} />
        </Pressable>
        <Pressable testID="modeButton" accessibilityRole="button" accessibilityLabel={`Mode: ${ROLE_LABELS[role]}`} onPress={() => setModeOpen(true)}
          style={[styles.mode, { backgroundColor: colors.surface }]}>
          <Text style={[styles.modeLabel, { color: colors.text }]}>{ROLE_LABELS[role]}</Text>
          <Icon name="chevron" size={16} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.flex} />
        {text.trim() || files.length || busy ? null : (
          <Pressable testID="voiceButton" accessibilityRole="button" accessibilityLabel="Voice mode" onPress={() => openWeb("voice")}
            style={[styles.round, { backgroundColor: colors.surface }]}>
            <Icon name="mic" color={colors.text} />
          </Pressable>
        )}
        {busy ? (
          <Pressable testID="stopButton" accessibilityRole="button" accessibilityLabel="Stop" onPress={onStop}
            style={[styles.round, { backgroundColor: colors.accent }]}>
            <Icon name="stop" color={colors.accentContrast} />
          </Pressable>
        ) : (
          <Pressable testID="sendButton" accessibilityRole="button" accessibilityLabel="Send" disabled={!canSend} onPress={() => void send()}
            style={[styles.round, { backgroundColor: colors.accent, opacity: canSend ? 1 : 0.35 }]}>
            <Icon name="send" color={colors.accentContrast} />
          </Pressable>
        )}
      </View>
      <ActionSheet visible={attachOpen} onClose={() => setAttachOpen(false)} actions={[
        { id: "attachPhotos", label: "Photos", icon: "image", onPress: () => void pickPhotos() },
        { id: "attachCamera", label: "Camera", icon: "camera", onPress: () => void takePhoto() },
        { id: "attachFiles", label: "Files", icon: "file", onPress: () => void pickFiles() }
      ]} />
      <ActionSheet visible={modeOpen} onClose={() => setModeOpen(false)} actions={[
        ...NATIVE_ROLES.map((id) => ({ id: `mode-${id}`, label: ROLE_LABELS[id]!, onPress: () => chooseRole(id) })),
        // Compare, Council, Deep Research and the skills live in the web client.
        { id: "modeMore", label: "Compare, Council, Research, Skills", icon: "open" as const, onPress: () => openWeb("chat") }
      ]} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  box: { marginHorizontal: 10, marginBottom: 8, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 10, gap: 8 },
  input: { fontSize: 17, maxHeight: 140, minHeight: 34, paddingHorizontal: 6, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  round: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  mode: { flexDirection: "row", alignItems: "center", gap: 4, height: 42, borderRadius: 21, paddingHorizontal: 14 },
  modeLabel: { fontSize: 15, fontWeight: "600" },
  files: { gap: 8, paddingHorizontal: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 220, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 6 },
  thumb: { width: 30, height: 30, borderRadius: 6 },
  chipName: { fontSize: 13, flexShrink: 1 }
});

import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { memo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { textFromMessageContent, type DisplayItem, type LiveAssistant, type StoredMessage } from "@klui/shared";
import { useTheme } from "../theme";
import { Icon } from "../ui/Icon";
import { Markdown, OpenFullView } from "./Markdown";

const FULL_VIEW_META = ["council", "compare", "research"];
const FULL_VIEW_FENCE = /```html\b/;

/** Replies with parts only the web client draws yet: the row offers it instead of hiding them. */
export function needsFullView(message: StoredMessage | LiveAssistant): boolean {
  const metadata = message.metadata ?? {};
  if (FULL_VIEW_META.some((key) => metadata[key])) return true;
  // Every reply has metadata.documents; only made documents and decks show up in it.
  const documents = metadata.documents as { artifacts?: unknown[] } | undefined;
  if (documents?.artifacts?.length) return true;
  if ("artifacts" in message && Array.isArray(message.artifacts) && message.artifacts.length) return true;
  return FULL_VIEW_FENCE.test(textFromMessageContent(message.content as StoredMessage["content"]));
}

function UserRow({ message }: { message: StoredMessage }) {
  const { colors } = useTheme();
  const parts = Array.isArray(message.content) ? message.content : [];
  const text = textFromMessageContent(message.content);
  return (
    <View testID="userMessage" style={styles.userRow}>
      {parts.map((part, index) => {
        if (typeof part === "string") return null;
        if (part.type === "image_url") {
          const image = (part.image_url ?? {}) as { url?: string; file_name?: string };
          if (image.url) return <Image key={index} source={{ uri: image.url }} style={styles.image} contentFit="cover" accessibilityLabel="Attached image" />;
          // Sent again after a restart: no local copy to show until the server's message loads.
          return (
            <View key={index} style={[styles.file, { borderColor: colors.border }]}>
              <Icon name="image" size={18} color={colors.textSecondary} />
              <Text numberOfLines={1} style={[styles.fileName, { color: colors.text }]}>{image.file_name || "Image"}</Text>
            </View>
          );
        }
        if (part.type === "file") {
          const file = (part.file ?? {}) as { url?: string; file_name?: string };
          return (
            <Pressable key={index} onPress={() => { if (file.url) void WebBrowser.openBrowserAsync(file.url); }}
              style={[styles.file, { borderColor: colors.border }]}>
              <Icon name="file" size={18} color={colors.textSecondary} />
              <Text numberOfLines={1} style={[styles.fileName, { color: colors.text }]}>{file.file_name || "Document"}</Text>
            </Pressable>
          );
        }
        return null;
      })}
      {text ? (
        <View style={[styles.bubble, { backgroundColor: colors.surface }]}>
          <Text selectable style={[styles.userText, { color: colors.text }]}>{text}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Reasoning({ text, working }: { text: string; working: boolean }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.reasoning}>
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)} style={styles.reasoningHead}>
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{working ? "Thinking…" : "Thought process"}</Text>
        <Icon name="chevron" size={16} color={colors.textSecondary} />
      </Pressable>
      {open ? <Text selectable style={[styles.meta, { color: colors.textSecondary }]}>{text}</Text> : null}
    </View>
  );
}

type AssistantProps = {
  message: StoredMessage | LiveAssistant;
  live: boolean;
  canRetry: boolean;
  onRetry?: () => void;
  onOpenFull?: () => void;
};

function AssistantRow({ message, live, canRetry, onRetry, onOpenFull }: AssistantProps) {
  const { colors } = useTheme();
  const text = textFromMessageContent(message.content as StoredMessage["content"]);
  const reasoning = String(message.reasoning ?? "");
  const activity = ("activity" in message ? message.activity : []) as LiveAssistant["activity"];
  const stored = message.metadata as { citations?: unknown; documents?: { citations?: unknown } } | null | undefined;
  const citations = (("citations" in message ? message.citations : stored?.documents?.citations ?? stored?.citations) ?? []) as LiveAssistant["citations"];
  const images = Array.isArray(message.content) ? message.content.flatMap((part) => {
    const url = typeof part !== "string" && part.type === "image_url" ? (part.image_url as { url?: string } | undefined)?.url : "";
    return url ? [url] : [];
  }) : [];
  const lastStep = activity.filter((item) => item.kind === "step").at(-1)?.text;
  const error = String(message.error ?? "");
  return (
    <View testID="assistantMessage" style={styles.assistant}>
      {reasoning ? <Reasoning text={reasoning} working={live && !text} /> : null}
      {live && lastStep && !text ? <Text style={[styles.meta, { color: colors.textSecondary }]}>{lastStep}</Text> : null}
      {live && !text && !reasoning && !lastStep ? <ActivityIndicator testID="replyStarting" style={styles.spinner} color={colors.textSecondary} /> : null}
      {text ? <OpenFullView.Provider value={live ? undefined : onOpenFull}><Markdown text={text} streaming={live} /></OpenFullView.Provider> : null}
      {images.map((url) => <Image key={url} source={{ uri: url }} style={styles.replyImage} contentFit="contain" accessibilityLabel="Image from the reply" />)}
      {needsFullView(message) && !live && onOpenFull ? (
        <Pressable testID="openFullView" accessibilityRole="button" onPress={onOpenFull} style={[styles.fullView, { borderColor: colors.border }]}>
          <Icon name="open" size={16} color={colors.text} />
          <Text style={[styles.meta, { color: colors.text }]}>Open in full view</Text>
        </Pressable>
      ) : null}
      {citations.length ? (
        <View style={styles.citations}>
          {citations.map((citation) => (
            <Pressable key={citation.index} onPress={() => { if (citation.url) void WebBrowser.openBrowserAsync(citation.url); }}>
              <Text numberOfLines={1} style={[styles.meta, styles.citation]}>{citation.index}. {citation.title || citation.url}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? <Text testID="messageError" style={[styles.meta, { color: colors.danger }]}>{error}</Text> : null}
      {!live ? (
        <View style={styles.actions}>
          {text ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Copy reply" hitSlop={10} onPress={() => void Clipboard.setStringAsync(text)}>
              <Icon name="copy" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          {canRetry && onRetry ? (
            <Pressable testID="retryReply" accessibilityRole="button" accessibilityLabel="Try again" hitSlop={10} onPress={onRetry}>
              <Icon name="retry" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

type RowProps = { item: DisplayItem; onRetry: (id: string) => void; onOpenFull: () => void };

/* Only the row that changed draws again while a reply streams. */
export const MessageRow = memo(Row, (a, b) =>
  a.item.message === b.item.message
  && (a.item.kind === "live" ? a.item.status : a.item.kind === "stored" && a.item.canRetry) === (b.item.kind === "live" ? b.item.status : b.item.kind === "stored" && b.item.canRetry));

function Row({ item, onRetry, onOpenFull }: RowProps) {
  if (item.kind === "live") return <AssistantRow message={item.message} live={item.status !== "failed"} canRetry={false} />;
  if (item.message.role === "user") return <UserRow message={item.message} />;
  if (item.message.role !== "assistant") return null;
  const canRetry = item.kind === "stored" && item.canRetry;
  return <AssistantRow message={item.message} live={false} canRetry={canRetry} onRetry={() => onRetry(item.message.id)} onOpenFull={onOpenFull} />;
}

const styles = StyleSheet.create({
  userRow: { alignItems: "flex-end", gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  bubble: { maxWidth: "85%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  userText: { fontSize: 16, lineHeight: 23 },
  image: { width: 200, height: 200, borderRadius: 12 },
  replyImage: { width: "100%", aspectRatio: 1, borderRadius: 12 },
  file: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "85%", borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 10 },
  fileName: { fontSize: 14, flexShrink: 1 },
  assistant: { gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  spinner: { alignSelf: "flex-start" },
  meta: { fontSize: 14, lineHeight: 20 },
  reasoning: { gap: 6 },
  reasoningHead: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28 },
  fullView: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 12, minHeight: 36 },
  citations: { gap: 4 },
  citation: { color: "#2563eb" },
  actions: { flexDirection: "row", gap: 18, marginTop: 2 }
});

import * as Clipboard from "expo-clipboard";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fontSize, radius, space, textFromMessageContent, type DisplayItem, type LiveAssistant } from "@klui/shared";
import { chat } from "../lib/runtime";
import { useTheme } from "../lib/theme";
import { Markdown } from "./Markdown";

function liveLabel(message: LiveAssistant, status: string): string {
  if (status === "reconnecting") return "Reconnecting…";
  if (status === "stopping") return "Stopping…";
  if (message.content) return "";
  const running = message.toolEvents.findLast((tool) => tool.status === "running");
  return message.illustrationStatus
    || (running ? `Searching${running.query ? ` “${running.query}”` : ""}…` : "")
    || message.activity.at(-1)?.text
    || "Thinking…";
}

export const MessageItem = memo(function MessageItem({ item, conversationId }: { item: DisplayItem; conversationId: string }) {
  const colors = useTheme();

  if (item.kind !== "live" && item.message.role === "user") {
    return (
      <View style={styles.userRow}>
        <Text selectable style={[styles.userBubble, { backgroundColor: colors.surface, color: colors.text }]}>
          {textFromMessageContent(item.message.content)}
        </Text>
      </View>
    );
  }

  if (item.kind === "live") {
    const { message, status } = item;
    const busy = status !== "failed" && !message.error && !message.stopped;
    const label = busy ? liveLabel(message, status) : "";
    return (
      <View style={styles.assistant}>
        {message.content ? <Markdown text={message.content} /> : null}
        {label ? <Text style={[styles.status, { color: colors.textSecondary }]}>{label}</Text> : null}
        {message.stopped ? <Text style={[styles.status, { color: colors.textTertiary }]}>Stopped</Text> : null}
        {message.error ? <Text style={[styles.error, { color: colors.danger }]} accessibilityRole="alert">{message.error}</Text> : null}
        {status === "failed" ? (
          <Text accessibilityRole="button" style={[styles.action, { color: colors.textSecondary }]} onPress={() => chat.dismissFailedRun(conversationId)}>Dismiss</Text>
        ) : null}
      </View>
    );
  }

  const text = textFromMessageContent(item.message.content);
  return (
    <View style={styles.assistant}>
      {text ? <Markdown text={text} /> : null}
      {item.message.error ? <Text style={[styles.error, { color: colors.danger }]}>{item.message.error}</Text> : null}
      {item.kind === "stored" && item.canRetry ? (
        <View style={styles.actions}>
          <Pressable hitSlop={8} onPress={() => void chat.retry(conversationId, item.message.id)} accessibilityRole="button" accessibilityLabel="Retry">
            <Text style={[styles.action, { color: colors.textSecondary }]}>Retry</Text>
          </Pressable>
          {text ? (
            <Pressable hitSlop={8} onPress={() => void Clipboard.setStringAsync(text)} accessibilityRole="button" accessibilityLabel="Copy">
              <Text style={[styles.action, { color: colors.textSecondary }]}>Copy</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  userRow: { alignItems: "flex-end" },
  userBubble: { maxWidth: "85%", paddingHorizontal: space.lg, paddingVertical: 10, borderRadius: 20, overflow: "hidden", fontSize: fontSize.md, lineHeight: 22 },
  assistant: { gap: space.xs },
  status: { fontSize: fontSize.sm },
  error: { fontSize: fontSize.sm },
  actions: { flexDirection: "row", gap: space.lg, marginTop: 2 },
  action: { fontSize: fontSize.sm, borderRadius: radius.sm }
});

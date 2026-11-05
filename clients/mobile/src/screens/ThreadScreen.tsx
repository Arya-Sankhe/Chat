import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { buildDisplayItems, type DisplayItem } from "@klui/shared";
import { Composer, type ReadyAttachment } from "../chat/Composer";
import { MessageRow } from "../chat/Message";
import { chat, useChat } from "../core/chat";
import { openWeb, useShell } from "../core/shell";
import { API_ORIGIN } from "../core/runtime";
import { deliverLink } from "../host/bridge";
import { useTheme } from "../theme";
import { Icon } from "../ui/Icon";
import type { RootStack } from "./navigation";

function useKeyboardInset() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (event) => setHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export function openFullChat(conversationId: string | null) {
  if (conversationId) deliverLink(`https://klui.ai/c/${conversationId}`);
  openWeb("chat");
}

export function ThreadScreen({ route, navigation }: NativeStackScreenProps<RootStack, "Thread">) {
  const { colors } = useTheme();
  const [conversationId, setConversationId] = useState(route.params?.id ?? null);
  const thread = useChat((state) => (conversationId ? state.threads[conversationId] : undefined));
  const run = useChat((state) => (conversationId ? state.runs[conversationId] : undefined));
  const title = useChat((state) => state.conversations.find((row) => row.id === conversationId)?.title);
  const draft = useChat((state) => (conversationId ? state.drafts[conversationId] : undefined));
  const keyboard = useKeyboardInset();
  const list = useRef<FlatList<DisplayItem>>(null);

  // Also when the page closes: the full view can send in this chat too.
  const pageOpen = useShell((state) => state.webVisible);
  useEffect(() => {
    if (conversationId && !pageOpen) void chat.openConversation(conversationId);
  }, [conversationId, pageOpen]);

  // Newest first: the list is inverted, so it stays at the bottom as a reply grows.
  const items = useMemo(() => buildDisplayItems(thread, run).slice().reverse(), [thread, run]);
  const busy = Boolean(run && run.status !== "failed");

  async function send(text: string, attachments: ReadyAttachment[]) {
    const id = await chat.send({
      conversationId,
      text,
      attachments: attachments.map(({ id: attachmentId, file }) => ({
        id: attachmentId,
        category: file.category,
        fileName: file.name,
        contentType: file.mimeType,
        url: file.uri
      }))
    });
    setConversationId(id);
    list.current?.scrollToOffset({ offset: 0, animated: true });
  }

  // Rows only draw again when their message changes, so these always read the current chat.
  const currentId = useRef(conversationId);
  currentId.current = conversationId;
  const retry = useCallback((messageId: string) => {
    if (currentId.current) chat.retry(currentId.current, messageId).catch((error: Error) => Alert.alert("Try again", error.message));
  }, []);
  const openFull = useCallback(() => openFullChat(currentId.current), []);
  const renderRow = useCallback(({ item }: { item: DisplayItem }) => <MessageRow item={item} onRetry={retry} onOpenFull={openFull} />, [retry, openFull]);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Pressable testID="threadBack" accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Icon name="back" color={colors.text} />
        </Pressable>
        <Text testID="threadTitle" numberOfLines={1} style={[styles.title, { color: colors.text }]}>{title || "New chat"}</Text>
        <Pressable testID="openFullChat" accessibilityRole="button" accessibilityLabel="Open in full view" hitSlop={10} onPress={() => openFullChat(conversationId)} style={styles.headerButton}>
          <Icon name="open" size={20} color={colors.text} />
        </Pressable>
      </View>
      <FlatList
        ref={list}
        testID="messages"
        style={styles.flex}
        data={items}
        inverted
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        onEndReached={() => { if (conversationId) void chat.loadOlder(conversationId); }}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        initialNumToRender={12}
        windowSize={9}
        ListEmptyComponent={
          thread?.status === "error"
            ? <Text testID="threadError" style={[styles.empty, { color: colors.danger }]}>{thread.error}</Text>
            : conversationId
              ? undefined
              : <Text testID="newChatHint" style={[styles.emptyTitle, { color: colors.text }]}>What can I help with?</Text>
        }
        contentContainerStyle={items.length ? styles.content : styles.emptyContent}
      />
      <View style={{ paddingBottom: keyboard }}>
        <Composer busy={busy} onSend={send} onStop={() => { if (conversationId) void chat.stop(conversationId); }}
          draft={draft} onDraftTaken={() => { if (conversationId) chat.takeDraft(conversationId); }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", height: 52, paddingHorizontal: 8, gap: 4 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  content: { paddingVertical: 8 },
  emptyContent: { flexGrow: 1, justifyContent: "center", transform: [{ scaleY: -1 }] },
  empty: { fontSize: 15, textAlign: "center", padding: 24 },
  emptyTitle: { fontSize: 24, fontWeight: "600", textAlign: "center", padding: 24 }
});

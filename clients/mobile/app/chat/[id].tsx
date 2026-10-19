import { Stack, useLocalSearchParams, useNavigation } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontSize, space } from "@klui/shared";
import { Composer } from "../../src/components/Composer";
import { MessageItem } from "../../src/components/MessageItem";
import { chat } from "../../src/lib/runtime";
import { useTheme } from "../../src/lib/theme";
import { useChat, useTranscript } from "../../src/lib/useChat";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = id && id !== "new" ? id : null;
  const navigation = useNavigation();
  const list = useRef<FlatList>(null);
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  // The view starts below the stack header, so the keyboard overlaps it by that much less.
  const headerHeight = useHeaderHeight();
  // With the keyboard up, the home-indicator inset is under the keyboard, not under the composer.
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const { thread, run, items } = useTranscript(conversationId);
  const title = useChat((state) => state.conversations.find((row) => row.id === conversationId)?.title ?? "");
  const draft = useChat((state) => (conversationId ? state.drafts[conversationId] ?? "" : ""));
  // Inverted list: newest first, so the view sits at the latest message and grows upward.
  const data = useMemo(() => [...items].reverse(), [items]);

  useEffect(() => {
    if (conversationId) void chat.openConversation(conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (draft && conversationId) chat.takeDraft(conversationId);
  }, [draft, conversationId]);

  // A new reply brings the view back to the newest message (offset 0 in an inverted list).
  const followKey = run?.assistant.id;
  useEffect(() => {
    if (followKey) list.current?.scrollToOffset({ offset: 0, animated: true });
  }, [followKey]);

  const busy = Boolean(run && run.status !== "failed");
  const send = async (text: string) => {
    const next = await chat.send({ conversationId, text });
    // Scoped to this screen, so a chat opened meanwhile is never retargeted.
    if (next !== conversationId) navigation.setParams({ id: next } as never);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.bg }} keyboardVerticalOffset={headerHeight}>
      <Stack.Screen options={{ title: title || (conversationId ? "" : "New chat") }} />
      {!conversationId ? (
        <View style={styles.empty}><Text style={[styles.hero, { color: colors.text }]}>What can I help with?</Text></View>
      ) : thread?.status === "error" && !items.length ? (
        <View style={styles.empty}>
          <Text style={{ color: colors.danger, textAlign: "center" }}>{thread.error}</Text>
          <Text style={{ color: colors.text, textDecorationLine: "underline" }} onPress={() => void chat.openConversation(conversationId)}>Try again</Text>
        </View>
      ) : thread?.status === "loading" && !items.length ? (
        <View style={styles.empty}><ActivityIndicator color={colors.textSecondary} /></View>
      ) : (
        <>
        {thread?.error ? (
          <Text style={[styles.banner, { color: colors.danger }]} accessibilityRole="alert" onPress={() => void chat.openConversation(conversationId)}>
            {thread.error} Tap to refresh.
          </Text>
        ) : null}
        <FlatList
          ref={list}
          inverted
          data={data}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => <MessageItem item={item} conversationId={conversationId} />}
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.3}
          onEndReached={() => { if (thread?.page.hasMore) void chat.loadOlder(conversationId).catch(() => {}); }}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        />
        </>
      )}
      <View style={{ paddingBottom: keyboardVisible ? 0 : insets.bottom }}>
        <Composer
          busy={busy}
          stopping={run?.status === "stopping"}
          draft={draft}
          autoFocus={!conversationId}
          onSend={send}
          onStop={() => conversationId && void chat.stop(conversationId)}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  hero: { fontSize: fontSize.xl, fontWeight: "600" },
  banner: { paddingHorizontal: space.lg, paddingVertical: space.sm, fontSize: fontSize.sm },
  list: { paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.xl }
});

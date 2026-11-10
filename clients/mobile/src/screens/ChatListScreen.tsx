import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ChatSearchHit, ConversationSummary } from "@klui/shared";
import { usePinnedChats } from "../core/account";
import { chat, useChat } from "../core/chat";
import { api } from "../core/runtime";
import { openWeb, useShell } from "../core/shell";
import { useTheme } from "../theme";
import { Icon } from "../ui/Icon";
import { ActionSheet } from "../ui/Sheet";
import type { RootStack } from "./navigation";

type RowProps = {
  item: ConversationSummary;
  isPinned: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
  onOpen: (id: string) => void;
  onMenu: (row: ConversationSummary) => void;
};

/* Pinning or renaming one chat draws that row, not the whole list. */
const ChatRow = memo(function ChatRow({ item, isPinned, colors, onOpen, onMenu }: RowProps) {
  return (
    <Pressable testID={`chatRow-${item.id}`} accessibilityRole="button" onPress={() => onOpen(item.id)} onLongPress={() => onMenu(item)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}>
      {isPinned ? <Icon name="pin" size={15} color={colors.textSecondary} /> : null}
      <View style={styles.flex}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>{item.title || "New chat"}</Text>
        {typeof item.snippet === "string" && item.snippet ? <Text numberOfLines={1} style={[styles.snippet, { color: colors.textSecondary }]}>{item.snippet}</Text> : null}
      </View>
      <Pressable testID={`chatMenu-${item.id}`} accessibilityRole="button" accessibilityLabel={`More for ${item.title || "chat"}`} hitSlop={8} onPress={() => onMenu(item)} style={styles.more}>
        <Icon name="more" size={20} color={colors.textTertiary} />
      </Pressable>
    </Pressable>
  );
});

export function ChatListScreen({ navigation }: NativeStackScreenProps<RootStack, "Chats">) {
  const { colors } = useTheme();
  const conversations = useChat((state) => state.conversations);
  const status = useChat((state) => state.conversationsStatus);
  const error = useChat((state) => state.conversationsError);
  const { pinned, togglePin } = usePinnedChats();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ChatSearchHit[]>([]);
  const [menuFor, setMenuFor] = useState<ConversationSummary | null>(null);
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null);
  const [renameText, setRenameText] = useState("");

  // Also when the page closes: chats can change there too.
  const pageOpen = useShell((state) => state.webVisible);
  useEffect(() => { if (!pageOpen) void chat.loadConversations(); }, [pageOpen]);

  // Titles filter at once; message text comes from the server, a moment after typing stops.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return setHits([]);
    let current = true;
    const timer = setTimeout(() => {
      api.searchChats(term).then((found) => { if (current) setHits(found.results ?? []); }).catch(() => {});
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const byTitle = term ? conversations.filter((row) => String(row.title || "").toLowerCase().includes(term)) : conversations;
    const shown = new Set(byTitle.map((row) => row.id));
    const extra = hits
      .filter((hit) => !shown.has(hit.conversation_id))
      .map((hit) => ({ id: hit.conversation_id, title: hit.title || "Chat", snippet: hit.snippet } as ConversationSummary));
    const all = [...byTitle, ...extra];
    return [...all.filter((row) => pinnedSet.has(row.id)), ...all.filter((row) => !pinnedSet.has(row.id))];
  }, [conversations, hits, pinnedSet, query]);

  const open = useCallback((id: string | null) => navigation.navigate("Thread", { id }), [navigation]);
  const renderRow = useCallback(
    ({ item }: { item: ConversationSummary }) => <ChatRow item={item} isPinned={pinnedSet.has(item.id)} colors={colors} onOpen={open} onMenu={setMenuFor} />,
    [pinnedSet, colors, open]
  );

  function confirmDelete(row: ConversationSummary) {
    Alert.alert("Delete chat?", row.title || "This chat will be gone for good.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void chat.deleteConversation(row.id).catch((failure: Error) => Alert.alert("Delete", failure.message)) }
    ]);
  }

  function saveRename() {
    const row = renaming;
    const title = renameText.trim();
    setRenaming(null);
    if (row && title && title !== row.title) void chat.renameConversation(row.id, title).catch((failure: Error) => Alert.alert("Rename", failure.message));
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text testID="homeTitle" accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Klui</Text>
        <View style={styles.flex} />
        <Pressable testID="openDojo" accessibilityRole="button" accessibilityLabel="Dojo" hitSlop={8} onPress={() => openWeb("dojo")} style={styles.headerButton}>
          <Icon name="book" color={colors.text} />
        </Pressable>
        <Pressable testID="openSettings" accessibilityRole="button" accessibilityLabel="Settings" hitSlop={8} onPress={() => navigation.navigate("Settings")} style={styles.headerButton}>
          <Icon name="gear" color={colors.text} />
        </Pressable>
      </View>
      <View style={[styles.search, { backgroundColor: colors.surface }]}>
        <Icon name="search" size={18} color={colors.textSecondary} />
        <TextInput testID="searchChats" value={query} onChangeText={setQuery} placeholder="Search chats" placeholderTextColor={colors.textTertiary}
          style={[styles.searchInput, { color: colors.text }]} autoCorrect={false} returnKeyType="search" accessibilityLabel="Search chats" />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10} onPress={() => setQuery("")}>
            <Icon name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        testID="chatList"
        style={styles.flex}
        data={rows}
        keyExtractor={(row) => row.id}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={status === "loading" && conversations.length > 0} onRefresh={() => void chat.loadConversations()} />}
        renderItem={renderRow}
        ListEmptyComponent={
          status === "error"
            ? <Text testID="chatListError" style={[styles.empty, { color: colors.danger }]}>{error}</Text>
            : status === "ready" ? <Text testID="chatListEmpty" style={[styles.empty, { color: colors.textSecondary }]}>{query ? "No chats found." : "Your chats will show up here."}</Text> : undefined
        }
      />
      <Pressable testID="newChat" accessibilityRole="button" accessibilityLabel="New chat" onPress={() => open(null)} style={[styles.newChat, { backgroundColor: colors.accent }]}>
        <Icon name="plus" size={20} color={colors.accentContrast} />
        <Text style={[styles.newChatLabel, { color: colors.accentContrast }]}>New chat</Text>
      </Pressable>
      <ActionSheet visible={Boolean(menuFor)} title={menuFor?.title} onClose={() => setMenuFor(null)} actions={menuFor ? [
        { id: "chatPin", label: pinned.includes(menuFor.id) ? "Unpin" : "Pin", icon: "pin", onPress: () => togglePin(menuFor.id) },
        { id: "chatRename", label: "Rename", icon: "file", onPress: () => { setRenameText(menuFor.title || ""); setRenaming(menuFor); } },
        { id: "chatDelete", label: "Delete", icon: "close", danger: true, onPress: () => confirmDelete(menuFor) }
      ] : []} />
      <Modal visible={Boolean(renaming)} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setRenaming(null)}>
        <View style={styles.dialogBack}>
          <View style={[styles.dialog, { backgroundColor: colors.bg }]}>
            <Text style={[styles.dialogTitle, { color: colors.text }]}>Rename chat</Text>
            <TextInput testID="renameInput" autoFocus selectTextOnFocus value={renameText} onChangeText={setRenameText} onSubmitEditing={saveRename}
              style={[styles.dialogInput, { color: colors.text, borderColor: colors.border }]} accessibilityLabel="Chat name" />
            <View style={styles.dialogActions}>
              <Pressable accessibilityRole="button" onPress={() => setRenaming(null)} style={styles.dialogButton}><Text style={{ color: colors.textSecondary }}>Cancel</Text></Pressable>
              <Pressable testID="renameSave" accessibilityRole="button" onPress={saveRename} style={styles.dialogButton}><Text style={[styles.strong, { color: colors.text }]}>Save</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  strong: { fontWeight: "600" },
  header: { flexDirection: "row", alignItems: "center", height: 56, paddingLeft: 18, paddingRight: 8 },
  title: { fontSize: 24, fontWeight: "700" },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 14, marginBottom: 8, height: 42, borderRadius: 21, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, paddingLeft: 18, paddingRight: 8 },
  rowTitle: { fontSize: 16 },
  snippet: { fontSize: 13, marginTop: 2 },
  more: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  empty: { fontSize: 15, textAlign: "center", padding: 32 },
  newChat: { position: "absolute", right: 18, bottom: 34, flexDirection: "row", alignItems: "center", gap: 8, height: 50, borderRadius: 25, paddingHorizontal: 20, elevation: 4 },
  newChatLabel: { fontSize: 16, fontWeight: "600" },
  dialogBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 28 },
  dialog: { alignSelf: "stretch", borderRadius: 16, padding: 20, gap: 14 },
  dialogTitle: { fontSize: 18, fontWeight: "600" },
  dialogInput: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 16 },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  dialogButton: { paddingHorizontal: 14, minHeight: 40, justifyContent: "center" }
});

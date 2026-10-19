import { Stack, router } from "expo-router";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontSize, radius, space } from "@klui/shared";
import { signOut, useAuth } from "../src/lib/auth";
import { chat } from "../src/lib/runtime";
import { useTheme } from "../src/lib/theme";
import { useChat } from "../src/lib/useChat";

export default function ConversationsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const conversations = useChat((state) => state.conversations);
  const status = useChat((state) => state.conversationsStatus);
  const error = useChat((state) => state.conversationsError);
  const runs = useChat((state) => state.runs);
  const email = useAuth((state) => state.me?.user?.email ?? "");

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{
        headerRight: () => (
          <Text accessibilityRole="button" style={{ color: colors.textSecondary, fontSize: fontSize.sm }} onPress={() => void signOut()}>Sign out</Text>
        )
      }} />
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        refreshControl={<RefreshControl refreshing={status === "loading" && conversations.length > 0} onRefresh={() => void chat.loadConversations()} tintColor={colors.textSecondary} />}
        ListHeaderComponent={email ? <Text style={[styles.email, { color: colors.textTertiary }]}>{email}</Text> : undefined}
        ListEmptyComponent={
          <Text style={[styles.note, { color: status === "error" ? colors.danger : colors.textSecondary }]}>
            {status === "error" ? error : status === "loading" || status === "idle" ? "Loading chats…" : "No chats yet."}
          </Text>
        }
        renderItem={({ item }) => {
          const running = runs[item.id] && runs[item.id]!.status !== "failed";
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/chat/[id]", params: { id: item.id } })}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
            >
              <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{item.title || "New chat"}</Text>
              {running ? <View style={[styles.dot, { backgroundColor: colors.textSecondary }]} accessibilityLabel="Replying" /> : null}
            </Pressable>
          );
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New chat"
        onPress={() => router.push({ pathname: "/chat/[id]", params: { id: "new" } })}
        style={({ pressed }) => [styles.fab, { backgroundColor: colors.accent, bottom: insets.bottom + space.lg, opacity: pressed ? 0.8 : 1 }]}
      >
        <Text style={[styles.fabText, { color: colors.accentContrast }]}>New chat</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  email: { paddingHorizontal: space.lg, paddingVertical: space.sm, fontSize: fontSize.sm },
  note: { padding: space.xl, textAlign: "center", fontSize: fontSize.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: 14 },
  title: { flex: 1, fontSize: fontSize.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
  fab: { position: "absolute", right: space.lg, height: 52, paddingHorizontal: space.xl, borderRadius: radius.full, alignItems: "center", justifyContent: "center", elevation: 3 },
  fabText: { fontSize: fontSize.md, fontWeight: "600" }
});

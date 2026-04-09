import { FlatList, View, StyleSheet, useColorScheme, Pressable, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAui, useAuiState } from "@assistant-ui/react-native";
import { useLogto } from "@logto/rn";
import { ThreadListItem } from "./ThreadListItem";
import { postSignOutRedirectUri } from "@/lib/logto";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";

export function ThreadListDrawer({ navigation }: DrawerContentComponentProps) {
  const aui = useAui();
  const { signOut } = useLogto();
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === "dark";

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark
            ? "rgba(28, 28, 30, 0.85)"
            : "rgba(242, 242, 247, 0.85)",
          paddingTop: insets.top,
        },
      ]}
    >
      <FlatList
        data={threadIds}
        keyExtractor={(item) => item}
        renderItem={({ item: threadId, index }) => {
          const threadItem = threadItems.find((t) => t.id === threadId);
          return (
            <ThreadListItem
              title={threadItem?.title ?? `Chat ${threadIds.length - index}`}
              isActive={threadId === mainThreadId}
              onPress={() => {
                aui.threads().switchToThread(threadId);
                navigation.closeDrawer();
              }}
            />
          );
        }}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
      <Pressable
        style={[
          styles.signOutButton,
          { borderTopColor: isDark ? "#38383a" : "#d1d1d6" },
        ]}
        onPress={() => signOut(postSignOutRedirectUri)}
      >
        <Text style={[styles.signOutText, { color: isDark ? "#ff453a" : "#ff3b30" }]}>
          Sign Out
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    paddingVertical: 8,
  },
  signOutButton: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  signOutText: {
    fontSize: 16,
    fontWeight: "600",
  },
});

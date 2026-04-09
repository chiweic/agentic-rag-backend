import { useState, useEffect } from "react";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Drawer } from "expo-router/drawer";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { Pressable, useColorScheme } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import {
  AssistantRuntimeProvider,
  useAui,
  Tools,
} from "@assistant-ui/react-native";
import { useAppRuntime } from "@/hooks/use-app-runtime";
import { ThreadListDrawer } from "@/components/thread-list/ThreadListDrawer";
import { expoToolkit } from "@/components/assistant-ui/tools";

function NewChatButton() {
  const aui = useAui();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  return (
    <Pressable
      onPress={() => {
        aui.threads().switchToNewThread();
      }}
      style={{ marginRight: 16 }}
    >
      <Ionicons
        name="create-outline"
        size={24}
        color={isDark ? "#ffffff" : "#000000"}
      />
    </Pressable>
  );
}

function DrawerLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Drawer
        drawerContent={(props) => <ThreadListDrawer {...props} />}
        screenOptions={{
          headerRight: () => <NewChatButton />,
          drawerType: "front",
          swipeEnabled: true,
          drawerStyle: { backgroundColor: "transparent" },
        }}
      >
        <Drawer.Screen name="index" options={{ title: "Chat" }} />
      </Drawer>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

function AppContent() {
  const runtime = useAppRuntime();
  const aui = useAui({
    tools: Tools({ toolkit: expoToolkit }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <DrawerLayout />
    </AssistantRuntimeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts(Ionicons.font);

  // Dynamically import @logto/rn to avoid SSR crash (localStorage)
  const [LogtoProvider, setLogtoProvider] =
    useState<React.ComponentType<any> | null>(null);
  const [logtoConfig, setLogtoConfig] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const logtoMod = await import("@logto/rn");
      const configMod = await import("@/lib/logto");
      setLogtoProvider(() => logtoMod.LogtoProvider);
      setLogtoConfig(configMod.logtoConfig);
    })();
  }, []);

  if (!fontsLoaded || !LogtoProvider || !logtoConfig) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LogtoProvider config={logtoConfig}>
        <AppContent />
      </LogtoProvider>
    </GestureHandlerRootView>
  );
}

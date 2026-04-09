import { Redirect, Stack } from "expo-router";
import { useLogto } from "@logto/rn";
import { ActivityIndicator, View } from "react-native";

export default function AppLayout() {
  const { isAuthenticated, isInitialized } = useLogto();

  if (!isInitialized) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

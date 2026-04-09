import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
} from "react-native";
import { useLogto } from "@logto/rn";
import { useState } from "react";
import { redirectUri } from "@/lib/logto";

export default function SignInScreen() {
  const { signIn } = useLogto();
  const [loading, setLoading] = useState(false);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const handleSignIn = async () => {
    setLoading(true);
    try {
      await signIn(redirectUri);
    } catch (error) {
      console.error("Sign-in error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: isDark ? "#000000" : "#ffffff" },
      ]}
    >
      <View style={styles.content}>
        <Text
          style={[styles.title, { color: isDark ? "#ffffff" : "#000000" }]}
        >
          Welcome
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: isDark ? "#8e8e93" : "#6e6e73" },
          ]}
        >
          Sign in to start chatting
        </Text>
        <Pressable
          style={[
            styles.button,
            { backgroundColor: isDark ? "#0a84ff" : "#007aff" },
          ]}
          onPress={handleSignIn}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    alignItems: "center",
    gap: 12,
    padding: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 20,
  },
  button: {
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 200,
    alignItems: "center",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
  },
});

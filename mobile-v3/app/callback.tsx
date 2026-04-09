import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Redirect } from "expo-router";
import { ActivityIndicator, View, Text } from "react-native";
import { useLogto } from "@logto/rn";
import * as WebBrowser from "expo-web-browser";

export default function Callback() {
  const { client } = useLogto();
  const [status, setStatus] = useState<"processing" | "done" | "error">(
    "processing",
  );
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === "web") {
          // On web, the callback page runs inside the popup opened by
          // expo-web-browser. We need to send the URL (with auth code)
          // back to the parent window via postMessage so that
          // openAuthSessionAsync() resolves with {type: 'success', url}.
          // The parent window's Logto client then calls handleSignInCallback().
          WebBrowser.maybeCompleteAuthSession();
          // The popup will be closed by the parent — nothing more to do here.
          return;
        }

        // On native, handle the callback directly
        const callbackUrl = window.location.href;
        await client.handleSignInCallback(callbackUrl);
        setStatus("done");
      } catch (e) {
        console.error("Callback error:", e);
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();
  }, [client]);

  if (status === "processing") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
        <Text style={{ color: "red", textAlign: "center" }}>
          Sign-in failed: {errorMsg}
        </Text>
      </View>
    );
  }

  return <Redirect href="/" />;
}

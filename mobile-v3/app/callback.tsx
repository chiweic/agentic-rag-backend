import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { ActivityIndicator, View, Text } from "react-native";
import { useLogto } from "@logto/rn";

export default function Callback() {
  const { client } = useLogto();
  const [status, setStatus] = useState<"processing" | "done" | "error">(
    "processing",
  );
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
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

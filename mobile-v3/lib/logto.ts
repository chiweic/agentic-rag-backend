import type { LogtoNativeConfig } from "@logto/rn";
import * as Linking from "expo-linking";

export const logtoConfig: LogtoNativeConfig = {
  endpoint: process.env.EXPO_PUBLIC_LOGTO_ENDPOINT ?? "http://localhost:3302",
  appId: process.env.EXPO_PUBLIC_LOGTO_APP_ID ?? "un96c8vwvshdv84vi3qvs",
  resources: [
    process.env.EXPO_PUBLIC_LOGTO_RESOURCE ?? "https://api.myapp.local",
  ],
  preferEphemeralSession: false,
};

export const redirectUri = Linking.createURL("callback");
export const postSignOutRedirectUri = Linking.createURL("");

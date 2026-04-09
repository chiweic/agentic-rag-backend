import { useMemo } from "react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";

const CHAT_API = process.env.EXPO_PUBLIC_CHAT_ENDPOINT_URL ?? "/api/chat";

export function useAppRuntime(getAccessToken?: () => Promise<string | null>) {
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: CHAT_API,
        headers: async () => {
          const token = await getAccessToken?.();
          if (token) {
            return { Authorization: `Bearer ${token}` };
          }
          return {};
        },
      }),
    [getAccessToken],
  );
  return useChatRuntime({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });
}

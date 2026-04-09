import { useMemo } from "react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { useRemoteThreadListRuntime } from "@assistant-ui/core/react";
import { useAui } from "@assistant-ui/store";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import {
  localThreadListAdapter,
  createLocalHistoryAdapter,
} from "@/lib/local-thread-adapter";

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

  return useRemoteThreadListRuntime({
    runtimeHook: function RuntimeHook() {
      const aui = useAui();
      const history = useMemo(
        () =>
          createLocalHistoryAdapter(
            () => aui.threadListItem()?.getState()?.remoteId,
          ),
        [aui],
      );

      return useChatRuntime({
        transport,
        adapters: { history },
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      });
    },
    adapter: localThreadListAdapter,
  });
}

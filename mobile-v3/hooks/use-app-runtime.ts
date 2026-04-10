import { useMemo } from "react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useRemoteThreadListRuntime } from "@assistant-ui/core/react";
import { useAui } from "@assistant-ui/store";
import { createBackendThreadListAdapter } from "@/lib/backend-thread-adapter";
import { BackendChatTransport } from "@/lib/backend-chat-transport";
import { createBackendHistoryAdapter } from "@/lib/backend-history-adapter";

export function useAppRuntime(getAccessToken: () => Promise<string | null>) {
  const adapter = useMemo(
    () => createBackendThreadListAdapter(getAccessToken),
    [getAccessToken],
  );

  return useRemoteThreadListRuntime({
    runtimeHook: function RuntimeHook() {
      const aui = useAui();
      const remoteId = aui.threadListItem()?.getState()?.remoteId;

      const getRemoteId = useMemo(
        () => () => aui.threadListItem()?.getState()?.remoteId,
        [aui],
      );

      const transport = useMemo(
        () =>
          new BackendChatTransport({
            getRemoteId,
            getAccessToken,
          }),
        [getRemoteId],
      );

      // Re-create history adapter when remoteId changes so useChatRuntime
      // sees a new adapter reference and calls load() for the new thread.
      const history = useMemo(
        () => createBackendHistoryAdapter(getRemoteId, getAccessToken),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [remoteId],
      );

      return useChatRuntime({
        transport,
        adapters: { history },
      });
    },
    adapter,
  });
}

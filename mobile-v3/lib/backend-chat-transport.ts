import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { parseBackendSSE } from "./backend-thread-adapter";

const BACKEND_BASE_URL =
  (process.env.EXPO_PUBLIC_BACKEND_BASE_URL ?? "http://localhost:8081").replace(
    /\/$/,
    "",
  );

type BackendChatTransportOptions = {
  getRemoteId: () => string | undefined;
  getAccessToken: () => Promise<string | null>;
};

/**
 * Custom ChatTransport that sends messages to the backend's
 * POST /threads/{remoteId}/runs/stream endpoint and converts
 * the SSE response to UIMessageChunk stream.
 */
export class BackendChatTransport implements ChatTransport<UIMessage> {
  private getRemoteId: () => string | undefined;
  private getAccessToken: () => Promise<string | null>;

  constructor({ getRemoteId, getAccessToken }: BackendChatTransportOptions) {
    this.getRemoteId = getRemoteId;
    this.getAccessToken = getAccessToken;
  }

  async sendMessages({
    messages,
    abortSignal,
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    // The runtime may call sendMessages before initialize() has stored
    // the remoteId. Wait briefly for it to become available.
    let remoteId = this.getRemoteId();
    if (!remoteId) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        remoteId = this.getRemoteId();
        if (remoteId) break;
      }
    }
    if (!remoteId) {
      throw new Error("No remote thread ID available");
    }

    // Extract the last user message to send
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMessage) {
      throw new Error("No user message to send");
    }

    const userText = lastUserMessage.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n");

    const token = await this.getAccessToken();
    const response = await fetch(
      `${BACKEND_BASE_URL}/threads/${remoteId}/runs/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          input: {
            messages: [{ role: "user", content: userText }],
          },
        }),
        signal: abortSignal,
      },
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Backend ${response.status}: ${message}`);
    }

    // Convert backend SSE events to UIMessageChunk stream
    const sseGenerator = parseBackendSSE(response);
    const textPartId = crypto.randomUUID();

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        try {
          let textStarted = false;
          let prevText = "";

          for await (const event of sseGenerator) {
            if (
              event.type === "messages/partial" ||
              event.type === "messages/complete"
            ) {
              const fullText = event.message.content
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("\n");

              if (!textStarted) {
                controller.enqueue({
                  type: "start",
                  messageId: event.message.id,
                });
                controller.enqueue({ type: "text-start", id: textPartId });
                textStarted = true;
              }

              // Compute the actual delta (new chars since last partial)
              const delta = fullText.slice(prevText.length);
              if (delta) {
                controller.enqueue({
                  type: "text-delta",
                  id: textPartId,
                  delta,
                });
              }
              prevText = fullText;

              if (event.type === "messages/complete") {
                controller.enqueue({ type: "text-end", id: textPartId });
                controller.enqueue({ type: "finish" });
              }
              continue;
            }

            if (event.type === "error") {
              controller.enqueue({ type: "error", errorText: event.message });
              break;
            }

            if (event.type === "end") {
              break;
            }
          }

          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }

  async reconnectToStream(
    _options: Parameters<ChatTransport<UIMessage>["reconnectToStream"]>[0],
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}

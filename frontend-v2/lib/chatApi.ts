import type {
  LangChainMessage,
  LangGraphCommand,
  LangGraphMessagesEvent,
} from "@assistant-ui/react-langgraph";

let tokenResolver: (() => Promise<string | null>) | null = null;

export function setTokenResolver(resolver: () => Promise<string | null>) {
  tokenResolver = resolver;
}

const getApiUrl = () =>
  process.env["NEXT_PUBLIC_LANGGRAPH_API_URL"] ||
  new URL("/api", window.location.href).href;

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (tokenResolver) {
    const token = await tokenResolver();
    if (token) {
      headers["authorization"] = `Bearer ${token}`;
    }
  }
  return headers;
};

/**
 * Convert backend normalized message to LangChain message format.
 * Backend: { id, role: "user"|"assistant", content: [{ type: "text", text }] }
 * LangChain: { id, type: "human"|"ai", content: "..." }
 */
function toLangChainMessage(msg: {
  id: string;
  role: string;
  content: { type: string; text: string }[] | string;
}): LangChainMessage {
  const roleMap: Record<string, string> = {
    user: "human",
    assistant: "ai",
    system: "system",
    tool: "tool",
  };

  const text = Array.isArray(msg.content)
    ? msg.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("")
    : msg.content;

  return {
    id: msg.id,
    type: roleMap[msg.role] ?? msg.role,
    content: text,
  } as LangChainMessage;
}

export const createThread = async () => {
  const res = await fetch(`${getApiUrl()}/threads`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Failed to create thread: ${res.status}`);
  return res.json();
};

export const getThreadState = async (
  threadId: string,
): Promise<{ messages: LangChainMessage[] }> => {
  const res = await fetch(`${getApiUrl()}/threads/${threadId}/state`, {
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to get thread state: ${res.status}`);
  const data = await res.json();
  const messages = (data.messages ?? []).map(toLangChainMessage);
  return { messages };
};

/**
 * Stream a run via SSE, yielding LangChainMessage arrays as partial updates.
 *
 * The backend sends events:
 *   messages/partial — running accumulation
 *   messages/complete — final assistant message
 *   values — full thread state
 *   end — stream sentinel
 */
export async function* sendMessage(params: {
  threadId: string;
  messages?: LangChainMessage[];
  command?: LangGraphCommand | undefined;
}): AsyncGenerator<LangGraphMessagesEvent<LangChainMessage>> {
  const body = {
    input: params.messages?.length ? { messages: params.messages } : null,
    command: params.command,
    streamMode: ["messages", "updates"],
  };

  const res = await fetch(
    `${getApiUrl()}/threads/${params.threadId}/runs/stream`,
    {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) throw new Error(`Stream failed: ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ") && currentEvent) {
        const dataStr = line.slice(6);
        if (dataStr === "null") continue;

        try {
          const data = JSON.parse(dataStr);

          if (
            currentEvent === "messages/partial" ||
            currentEvent === "messages/complete"
          ) {
            yield {
              event: currentEvent,
              data: [toLangChainMessage(data)],
            };
          } else if (currentEvent === "values" && data.messages) {
            yield {
              event: currentEvent,
              data: data.messages.map(toLangChainMessage),
            };
          }
        } catch {
          // skip malformed JSON
        }
        currentEvent = "";
      }
    }
  }
}

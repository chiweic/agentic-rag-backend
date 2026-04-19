import type {
  LangChainMessage,
  LangGraphCommand,
  LangGraphMessagesEvent,
} from "@assistant-ui/react-langgraph";
import {
  type FollowupSuggestion,
  setFollowupSuggestions,
} from "@/lib/followupSuggestions";

export type Citation = {
  chunk_id: string;
  text: string;
  title: string;
  source_url: string | null;
  score: number | null;
  metadata: {
    source_type: string;
    record_id?: string;
    chunk_index?: number;
    publish_date?: string | null;
  };
};

type BackendTextPart = {
  type: "text";
  text: string;
};

type BackendCitationsPart = {
  type: "citations";
  citations: Citation[];
};

type BackendMessage = {
  id: string;
  role: string;
  content: (BackendTextPart | BackendCitationsPart)[] | string;
};

type AssistantUiMessagePart = {
  type: "text";
  text: string;
};

let tokenResolver: (() => Promise<string | null>) | null = null;

export function setTokenResolver(resolver: () => Promise<string | null>) {
  tokenResolver = resolver;
}

async function fetchAccessTokenFallback(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/token");
    if (!res.ok) return null;
    const data = await res.json();
    return data.accessToken ?? null;
  } catch {
    return null;
  }
}

const getApiUrl = () =>
  process.env["NEXT_PUBLIC_LANGGRAPH_API_URL"] ||
  new URL("/api", window.location.href).href;

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const token = tokenResolver
    ? await tokenResolver()
    : await fetchAccessTokenFallback();
  if (token) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return headers;
};

/**
 * Convert backend normalized message to LangChain message format.
 * Backend: content can be a string or a list of blocks, including citations.
 * LangChain: assistant-ui's LangGraph converter only accepts a fixed set of
 * content block types, so we preserve citations in message metadata.
 */
function toLangChainMessage(msg: BackendMessage): LangChainMessage {
  const roleMap: Record<string, string> = {
    user: "human",
    assistant: "ai",
    system: "system",
    tool: "tool",
  };

  const content: AssistantUiMessagePart[] | string = Array.isArray(msg.content)
    ? msg.content
        .filter((part): part is BackendTextPart => part.type === "text")
        .map((part) => ({ type: "text", text: part.text }))
    : msg.content;

  const citations = Array.isArray(msg.content)
    ? msg.content.flatMap((part) =>
        part.type === "citations" ? part.citations : [],
      )
    : [];

  const type = roleMap[msg.role] ?? msg.role;
  if (type === "ai") {
    return {
      id: msg.id,
      type: "ai",
      content,
      ...(citations.length > 0
        ? {
            additional_kwargs: {
              metadata: {
                citations,
              },
            },
          }
        : {}),
    } as LangChainMessage;
  }

  return {
    id: msg.id,
    type,
    content,
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

  const parseSseEvent = (
    rawEvent: string,
  ): { event: string; data: string } | null => {
    const lines = rawEvent.split("\n");
    let event = "";
    const data: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).trimStart());
      }
    }

    if (!event || data.length === 0) return null;
    return { event, data: data.join("\n") };
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
    } else {
      buffer += decoder.decode(value, { stream: true });
    }

    const rawEvents = done ? [buffer] : buffer.split("\n\n");
    buffer = done ? "" : (rawEvents.pop() ?? "");

    for (const rawEvent of rawEvents) {
      const parsed = parseSseEvent(rawEvent);
      if (!parsed || parsed.data === "null") continue;

      try {
        const data = JSON.parse(parsed.data);

        if (
          parsed.event === "messages/partial" ||
          parsed.event === "messages/complete"
        ) {
          yield {
            event: parsed.event,
            data: [toLangChainMessage(data)],
          };
        } else if (parsed.event === "values" && data.messages) {
          yield {
            event: parsed.event,
            data: {
              ...data,
              messages: data.messages.map(toLangChainMessage),
            },
          };
        } else if (parsed.event === "suggestions/final" && data.suggestions) {
          setFollowupSuggestions(
            params.threadId,
            (data.suggestions as FollowupSuggestion[]).filter(
              (item) => typeof item?.text === "string",
            ),
          );
        }
      } catch {
        // skip malformed JSON
      }
    }

    if (done) break;
  }
}

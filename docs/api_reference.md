# Backend API Reference

Base URL: `http://localhost:8005`

---

## Thread Endpoints (for assistant-ui frontend)

These follow the LangGraph Cloud API format, compatible with `@assistant-ui/react-langgraph`.

### Create Thread

```
POST /threads
Content-Type: application/json

Body (optional):
{ "metadata": { "user": "alice" } }

Response:
{ "thread_id": "uuid", "created_at": 1712345678.9, "metadata": {} }
```

### List Threads (sidebar)

```
GET /threads

Response:
[
  {
    "thread_id": "uuid",
    "title": "First user message (up to 80 chars)...",
    "created_at": 1712345678.9,
    "metadata": {}
  }
]
```

Sorted newest first. `title` is the first user message in the thread (null if empty).

### Get Thread State (load conversation)

```
GET /threads/{thread_id}/state

Response:
{
  "values": {
    "messages": [
      { "type": "human", "data": { "content": "Hello", ... } },
      { "type": "ai", "data": { "content": "Hi there!", ... } }
    ]
  },
  "tasks": []
}
```

### Run Agent & Stream Response

```
POST /threads/{thread_id}/runs/stream
Content-Type: application/json

Body:
{
  "input": {
    "messages": [{ "role": "user", "content": "Hello" }]
  },
  "stream_mode": ["messages", "updates"]
}

Response: SSE stream
  event: messages/partial    — accumulated content as tokens arrive
  data: [{"type":"ai","id":"uuid","content":"Hello so"}]

  event: messages/complete   — final complete message
  data: [{"type":"ai","id":"uuid","content":"Hello so far!"}]

  event: values              — full thread state after completion
  data: {"messages": [...]}

  event: end                 — stream finished
  data: null
```

### Delete Thread

```
DELETE /threads/{thread_id}

Response:
{ "status": "deleted", "thread_id": "uuid" }
```

---

## OpenAI-Compatible Endpoints (for Open WebUI)

Connection URL for Open WebUI: `http://<host-ip>:8005/v1`

### Chat Completions

```
POST /v1/chat/completions
Content-Type: application/json

Body:
{
  "model": "agentic-rag",
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Hello" }
  ],
  "stream": false,
  "user": "optional-user-id"
}

Non-streaming response:
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1712345678,
  "model": "agentic-rag",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "Hi!" },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}

Streaming response (stream: true): SSE
  data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}
  data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}
  data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}
  data: [DONE]
```

### List Models

```
GET /v1/models

Response:
{
  "object": "list",
  "data": [{ "id": "agentic-rag", "object": "model", "owned_by": "local" }]
}
```

---

## Custom Chat Endpoints

Simple endpoints for custom frontends that don't need threads.

### Chat (non-streaming)

```
POST /api/chat
Content-Type: application/json

Body:
{
  "messages": [{ "role": "user", "content": "Hello" }],
  "user_id": "optional",
  "session_id": "optional"
}

Response:
{
  "message": { "role": "assistant", "content": "Hi!" },
  "trace_id": "langfuse-trace-id"
}
```

### Chat Stream (SSE)

```
POST /api/chat/stream
Content-Type: application/json

Body: (same as /api/chat)

Response: SSE
  event: token
  data: {"content": "Hi"}

  event: done
  data: {"trace_id": "langfuse-trace-id"}
```

---

## Health Check

```
GET /health

Response:
{ "status": "ok", "env": "development" }
```

---

## assistant-ui Frontend Integration

Install:
```bash
npm install @assistant-ui/react @assistant-ui/react-langgraph @langchain/langgraph-sdk
```

Connect:
```typescript
// lib/chatApi.ts
import { Client } from "@langchain/langgraph-sdk";

const client = new Client({ apiUrl: "http://localhost:8005" });

export const createThread = () => client.threads.create();
export const getThreadState = (threadId: string) => client.threads.getState(threadId);
export const sendMessage = (params: { threadId: string; messages: any[] }) =>
  client.runs.stream(params.threadId, "agent", {
    input: { messages: params.messages },
    streamMode: ["messages", "updates"],
  });
```

```typescript
// components/MyAssistant.tsx
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { createThread, getThreadState, sendMessage } from "@/lib/chatApi";

const runtime = useLangGraphRuntime({
  stream: async function* (messages, { initialize }) {
    const { externalId } = await initialize();
    yield* await sendMessage({ threadId: externalId!, messages });
  },
  create: async () => {
    const { thread_id } = await createThread();
    return { externalId: thread_id };
  },
  load: async (externalId) => {
    const state = await getThreadState(externalId);
    return { messages: state.values.messages };
  },
});
```

---

## Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_BASE` | `http://area51r5:8003/v1` | OpenAI-compatible LLM endpoint |
| `OPENAI_API_KEY` | `not-needed` | API key (not needed for local) |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model name |
| `LANGFUSE_PUBLIC_KEY` | | Langfuse public key |
| `LANGFUSE_SECRET_KEY` | | Langfuse secret key |
| `LANGFUSE_BASE_URL` | `http://localhost:3002` | Langfuse server URL |
| `POSTGRES_URI` | `postgresql://langgraph:langgraph@localhost:5434/langgraph` | Thread storage |
| `MAX_MESSAGE_WINDOW` | `20` | Messages sent to LLM (full history stays in DB) |
| `MAX_THREADS_PER_USER` | `100` | Max threads per user (not enforced yet) |

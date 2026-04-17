# Backend API Reference

Base URL: `http://localhost:8081`

---

## Authentication

Thread endpoints and `/assisted-learning/*` require a verified bearer token sent
as `Authorization: Bearer <token>`.

`/v1/*`, `/api/chat*`, and `/health` are bearer-less.

Current supported bearer issuers:

- Google OIDC ID tokens for the M4 flow
- Clerk-issued bearer tokens for the Phase 5 flow when Clerk is configured
- dev-only test tokens when `AUTH_DEV_MODE=True`

For Clerk integrations, the recommended frontend pattern is:

- use Clerk in the Next.js app for register / sign-in / sign-out UX
- obtain a backend-facing bearer via Clerk's token API
- optionally use a Clerk JWT template dedicated to the FastAPI backend
- send that bearer to `/threads*` and `/assisted-learning/*`

Backend Clerk verification requires:

- `CLERK_OIDC_ISSUER`
- `CLERK_OIDC_JWKS_URL`
- optional `CLERK_AUTHORIZED_PARTIES` if `azp` should be constrained

### User identity

Backend derives a stable `user_id` from the verified token as `"{provider}:{sub}"`.

Examples:

- Google token → `google:<google_sub>`
- Clerk token → `clerk:<clerk_sub>`
- dev token → `dev:<sub>`

Frontend does not need to call `/me` in the current design. For Google and Clerk,
the frontend can populate display-only account UI from the token/session payload.
Backend remains the authority for ownership semantics.

### Error response shapes

| Status | Body | When |
|---|---|---|
| `401` | `{"detail": "<reason>"}` | Missing / malformed / expired / wrong-aud / wrong-iss / bad-signature bearer |
| `403` | `{"detail": "Forbidden"}` | Valid bearer, but the thread belongs to another user |
| `404` | `{"detail": "Thread not found"}` | Thread does not exist for any user |

`401` detail strings currently expose which verification step failed
(`"Token is expired"`, `"Invalid token issuer"`, etc.) to aid debugging in M4.
Pre-production these will collapse to a generic `"Unauthorized"`.

### Dev-only auth (AUTH_DEV_MODE)

When the backend is started with `AUTH_DEV_MODE=True`, a fresh RSA keypair is
generated in-process and a `POST /auth/dev-token` endpoint becomes available.
This exists solely for Playwright / integration testing — **never enable in
production**. When `AUTH_DEV_MODE=False` (default) the endpoint returns `404`.

```
POST /auth/dev-token
Content-Type: application/json

Body:
{ "sub": "alice", "email": "alice@test", "name": "Alice", "ttl_seconds": 3600 }

Response:
{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 3600 }
```

Dev-issued tokens are signed under `iss: "https://dev.local"` and flow through
the same verifier as Google tokens. User IDs for dev tokens are namespaced as
`"dev:<sub>"`, kept separate from production `"google:<sub>"` identities.

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
    "title": "Setting Up RAG Pipeline",
    "created_at": 1712345678.9,
    "is_archived": false,
    "metadata": {}
  }
]
```

Sorted newest first. `title` is the LLM-generated title (via `/generate-title`), or falls back to first user message (up to 80 chars), or null if empty.

### Get Thread State (load conversation)

```
GET /threads/{thread_id}/state

Response:
{
  "thread_id": "uuid",
  "messages": [
    {
      "id": "msg-...",
      "role": "user",
      "content": [{"type": "text", "text": "Hello"}]
    },
    {
      "id": "msg-...",
      "role": "assistant",
      "content": [{"type": "text", "text": "Hi there!"}]
    }
  ]
}
```

Returns 404 if the thread does not exist.

**Normalized message shape** (Milestone 3): every message has `id`, `role`
(`"user" | "assistant" | "system" | "tool"`), and `content` as an array of
parts. Milestone 3 emits **text parts only** (`{"type": "text", "text": "..."}`).
Additional part types (tool calls, images, attachments) will be added to the
same array without a breaking migration.

### Run Agent & Stream Response

```
POST /threads/{thread_id}/runs/stream
Content-Type: application/json

Body:
{
  "input": {
    "messages": [{ "role": "user", "content": "Hello" }]
  }
}
```

**Critical contract: `input.messages` is APPENDED to checkpointer state**, not
replaced. The frontend must send **only the new user message**, not the full
conversation history. Sending the full history will duplicate messages in the
thread.

Correct second-turn example:

```json
// After a "Hello" / "Hi there!" exchange, to send "How are you?":
{ "input": { "messages": [{ "role": "user", "content": "How are you?" }] } }
```

Incorrect (will duplicate):

```json
// DO NOT send full history:
{ "input": { "messages": [
  { "role": "user",      "content": "Hello" },
  { "role": "assistant", "content": "Hi there!" },
  { "role": "user",      "content": "How are you?" }
] } }
```

Returns 404 if the thread does not exist.

**Response: SSE stream**

Event sequence (happy path): `messages/partial` (one or more) →
`messages/complete` → `values` → *optional* `suggestions/final` → `end`.

On failure: an `error` event is emitted, followed by `end`.

```
event: messages/partial
data: {"id":"uuid","role":"assistant","content":[{"type":"text","text":"Hello so"}]}

event: messages/complete
data: {"id":"uuid","role":"assistant","content":[{"type":"text","text":"Hello so far!"}]}

event: values
data: {"thread_id":"uuid","messages":[...normalized messages...]}

event: suggestions/final
data: {"suggestions":[{"id":"sug_abc","text":"How does this relate to X?"}, ...]}

event: end
data: null
```

Event semantics:

- `messages/partial` — **running accumulation** of assistant content. The
  frontend replaces the in-progress message on each tick; it is not a delta to
  append. Same `id` across all partials for a single turn.
- `messages/complete` — final assistant message after the LLM finishes. Same
  normalized shape as the partials.
- `values` — full normalized thread state after the run settles. Same shape
  as `GET /threads/{id}/state`.
- `suggestions/final` — **optional.** Follow-up prompt suggestions for the
  latest turn. Emitted only when the assistant reply is grounded (has a
  non-empty citations block). Absence under no-hits answers is expected, not
  an error. Payload: `{"suggestions":[{"id","text"}, ...]}`, up to
  `FOLLOWUP_SUGGESTIONS_N` items (default 3). Generation runs in parallel with
  the `values` emission so it doesn't extend time-to-first-answer; arrives
  ~1s after `values` in typical turns.
- `end` — final sentinel with `data: null`.

On error:

```
event: error
data: {"message": "simulated LLM failure"}

event: end
data: null
```

The `error` event is emitted once, before `end`, and the stream closes
cleanly. There is no in-stream recovery protocol — the frontend should
surface the error and let the user retry. Retrying hits
`POST /threads/{id}/runs/stream` again with **only the new user message**
(append semantics still apply). If the frontend needs to reconcile with
actual backend state after an error, call `GET /threads/{id}/state`.

### Update Thread (rename, archive)

```
PATCH /threads/{thread_id}
Content-Type: application/json

Body (all fields optional):
{
  "title": "My conversation about RAG",
  "is_archived": false,
  "metadata": { "pinned": true }
}

Response:
{
  "thread_id": "uuid",
  "title": "My conversation about RAG",
  "created_at": 1712345678.9,
  "is_archived": false,
  "metadata": { "pinned": true }
}
```

### Generate Title (LLM-generated)

```
POST /threads/{thread_id}/generate-title

Response:
{ "thread_id": "uuid", "title": "Setting Up RAG Pipeline" }
```

Uses the LLM to generate a short title (max 6 words) from the first user message. Also stores it so `GET /threads` returns it.

### Delete Thread

```
DELETE /threads/{thread_id}

Response:
{ "status": "deleted", "thread_id": "uuid" }
```

---

## Suggestions

Starter prompts for empty-state UIs. Follow-up suggestions for in-thread UX
arrive on the `/threads/{id}/runs/stream` SSE as `suggestions/final` (see above)
and do not have a separate HTTP endpoint.

### Get Starter Suggestions

```
GET /suggestions/starter?n=4

Success (200):
{
  "suggestions": [
    { "id": "sug_abc123", "text": "How do I start meditating?" },
    { "id": "sug_def456", "text": "Tell me about the Diamond Sutra" },
    ...
  ]
}

Warming up (503):
{ "detail": { "status": "warming_up" } }

Build failed (500):
{ "detail": { "status": "failed", "error": "..." } }
```

- `n` is clamped to `[1, SUGGESTIONS_MAX_N]` (default max 10). If omitted,
  defaults to `SUGGESTIONS_DEFAULT_N` (default 4).
- Suggestions are a random subset of an in-process pool built at startup from
  the latest `rag_bot_qa_*` Milvus collection, rephrased by `SUGGEST_LLM`
  (falls back to `GEN_LLM`). Different requests see different subsets.
- The pool builds asynchronously in the lifespan; until it's ready the endpoint
  returns 503 `warming_up`. The frontend should retry or display a placeholder.
- Bearer-less (same as `/v1/*`) so empty-state prompts can load pre-auth.

### Refresh Starter Pool (dev-only)

```
POST /admin/suggestions/refresh

Success (200):
{ "triggered": true, "prior_status": "ready" }
```

Kicks off a pool rebuild in the background. Returns immediately. Mounted only
when `AUTH_DEV_MODE=true` — returns 404 in production.

---

## OpenAI-Compatible Endpoints (for Open WebUI)

Connection URL for Open WebUI: `http://<host-ip>:8081/v1`

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

The frontend uses `ExternalStoreRuntime` with an app-owned Zustand store (see
`docs/planning.md`). All thread endpoints return normalized shapes suitable
for direct use in `ThreadMessageLike[]`.

### Endpoint usage by frontend operation

| Frontend operation | Backend endpoint |
|---|---|
| Create a backend-linked thread (on first send) | `POST /threads` |
| List threads for sidebar hydration | `GET /threads` |
| Load message history for a linked thread | `GET /threads/{id}/state` |
| Stream a run on a linked thread | `POST /threads/{id}/runs/stream` |
| Rename a linked thread | `PATCH /threads/{id}` with `{ "title": "..." }` |
| Archive / unarchive | `PATCH /threads/{id}` with `{ "is_archived": bool }` |
| Delete a linked thread | `DELETE /threads/{id}` |
| LLM-generated title | `POST /threads/{id}/generate-title` |

### Converting `/state` messages to `ThreadMessageLike[]`

The normalized message shape is a near-drop-in for `ThreadMessageLike`:

```typescript
type NormalizedMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: Array<{ type: "text"; text: string }>;
};

// GET /threads/{id}/state → { thread_id, messages: NormalizedMessage[] }
const { messages } = await fetch(`${API}/threads/${id}/state`).then(r => r.json());
// messages is already ThreadMessageLike-compatible for text-only content
```

### Sending a run

Remember: `input.messages` is **append-only**. Send only the new user message.

```typescript
const response = await fetch(`${API}/threads/${id}/runs/stream`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    input: { messages: [{ role: "user", content: "Hello" }] },
  }),
});
// Parse SSE — see "Run Agent & Stream Response" above for event shapes
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

# Partner API Guide

Programmatic access to the Changpt backend API (the same service that powers https://app.changpt.org).

- **Base URL**: `https://app.changpt.org/api`
- **Auth**: OAuth 2.0 Client Credentials via Logto. Every call needs `Authorization: Bearer <access_token>`.
- **Audience**: `https://api.myapp.local` (opaque ID — the string just has to match, no need to resolve).
- **Token endpoint**: `https://auth.changpt.org/oidc/token`

## What you need from us

We create a Machine-to-Machine application in our Logto tenant and hand you:

1. `CLIENT_ID` — iyu8pgx14q3gzr68xd2qk
2. `CLIENT_SECRET` — sNQRfsbspwqFg6vYELFfGR6rHeQJWTxC (treat as a password; store in an env var or a secret manager, not in source control)

Keep the secret. We can't show it to you again after creation.

## Quickstart with curl

### 1. Fetch an access token

```bash
export CLIENT_ID="<your client id>"
export CLIENT_SECRET="<your client secret>"

TOKEN=$(curl -sS -X POST https://auth.changpt.org/oidc/token \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "resource=https://api.myapp.local" \
  -d "scope=all" \
  | jq -r .access_token)

echo "$TOKEN" | head -c 40 ; echo "..."
```

Tokens are JWTs with a default lifetime of **1 hour**. Cache the token in memory; don't re-fetch on every request.

### 2. Health check (no auth required)

```bash
curl -sS https://app.changpt.org/api/health
# -> {"status":"ok","env":"dev"}
```

### 3. Create a conversation thread

```bash
THREAD=$(curl -sS -X POST https://app.changpt.org/api/threads \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')
THREAD_ID=$(echo "$THREAD" | jq -r .thread_id)
echo "Thread: $THREAD_ID"
```

### 4. Stream an assistant turn (SSE)

The stream endpoint is the **primary chat entrypoint**. It emits Server-Sent Events:

```
messages/partial  → running accumulation of assistant content
messages/complete → final assistant message
values            → full thread state after settle
suggestions/final → optional follow-up prompts (only when citations exist)
end               → sentinel (data: null)
error             → on failure, followed by `end`
```

```bash
curl -N -X POST "https://app.changpt.org/api/threads/$THREAD_ID/runs/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":{"messages":[{"role":"user","content":"法鼓山是什麼？"}]}}'
```

**Contract**: `input.messages` is **appended** to thread state on the server. On turn N, send only the new user message — do not replay the history.

### 5. Non-streaming equivalent (if you don't need token-by-token)

The stream endpoint is the only chat entrypoint, but you can ignore intermediate events and read `GET /threads/{id}/state` once the stream ends. The settled state carries the full text **and** the citations block.

```bash
# Fire the run, drain the stream silently
curl -sSN -X POST "https://app.changpt.org/api/threads/$THREAD_ID/runs/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":{"messages":[{"role":"user","content":"法鼓山是什麼？"}]}}' \
  > /dev/null

# Fetch the settled thread — last message has text + citations
curl -sS "https://app.changpt.org/api/threads/$THREAD_ID/state" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.messages[-1] | {
      text: ([.content[] | select(.type=="text").text] | join("")),
      citations: [.content[] | select(.type=="citations").citations[] | {title, source_url, score, source_type: .metadata.source_type}]
    }'
```

In Python, the client exposes a blocking helper that does the same:

```python
from client import BackendClient

c = BackendClient.from_env()
thread = c.create_thread()
result = c.run_turn(thread["thread_id"], "法鼓山是什麼？")

print(result["text"])
for ci in result["citations"]:
    print(ci["title"], ci["source_url"], ci["score"])
```

Full blocking example: [../examples/partner_api/demo_blocking.py](../examples/partner_api/demo_blocking.py).

### 6. List and inspect threads

```bash
# List your threads (sorted newest first)
curl -sS https://app.changpt.org/api/threads \
  -H "Authorization: Bearer $TOKEN" | jq

# Full state of one thread (messages + metadata)
curl -sS "https://app.changpt.org/api/threads/$THREAD_ID/state" \
  -H "Authorization: Bearer $TOKEN" | jq
```

## OpenAI-compatible interface

If you already have code written against the OpenAI SDK, you can point it at our backend:

- **Endpoint**: `POST https://app.changpt.org/api/v1/chat/completions`
- **Model list**: `GET https://app.changpt.org/api/v1/models` (returns one model id: `agentic-rag`)
- **Auth**: ✅ same M2M Bearer token as `/threads`. The OpenAI SDK's `api_key` field maps to `Authorization: Bearer …` — pass your access token there.
- **State**: stateless — every call is a fresh ephemeral thread; no thread IDs, no history carry-over. If you want multi-turn memory, send the history in `messages[]` yourself, or use the `/threads` path instead.
- **Citations**: flattened into a `Sources:` footer **inside the assistant's text content** (OpenAI's schema has no citations block, so structured metadata is lost on this path). Use `/threads` if you need programmatic access to chunk metadata.
- **Identity in traces**: the authenticated M2M sub is always used (the OpenAI `user` request field is ignored server-side so callers can't spoof identity).

### curl (non-streaming)

```bash
# TOKEN fetched exactly as in section 1
curl -sS -X POST https://app.changpt.org/api/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agentic-rag",
    "messages": [
      {"role": "user", "content": "請用一句話介紹法鼓山。"}
    ],
    "stream": false
  }' | jq '.choices[0].message.content'
```

Response (OpenAI-shaped):

```json
{
  "id": "chatcmpl-abc123...",
  "model": "agentic-rag",
  "choices": [
    { "index": 0, "message": { "role": "assistant", "content": "法鼓山是位於金山的觀音道場...\n\nSources:\n- 每位義工都是觀音菩薩的化身... (https://ddc.shengyen.org/html/09-06-029.html)\n- ..." } }
  ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}
```

### curl (streaming)

```bash
curl -sSN -X POST https://app.changpt.org/api/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agentic-rag",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": true
  }'
```

Standard OpenAI `data:`-prefixed SSE chunks, terminated by `data: [DONE]`.

### Python (OpenAI SDK)

```python
import os, requests
from openai import OpenAI

# 1. Fetch an M2M access token (cache this for ~50 min in real code)
r = requests.post(
    "https://auth.changpt.org/oidc/token",
    auth=(os.environ["CLIENT_ID"], os.environ["CLIENT_SECRET"]),
    data={
        "grant_type": "client_credentials",
        "resource": "https://api.myapp.local",
        "scope": "all",
    },
)
token = r.json()["access_token"]

# 2. Feed the token to the OpenAI SDK as `api_key`
#    (it sends `Authorization: Bearer <api_key>` under the hood).
client = OpenAI(
    base_url="https://app.changpt.org/api/v1",
    api_key=token,
    # Our Cloudflare ingress blocks the default `OpenAI/Python x.y`
    # User-Agent as a bot. Override it with something generic.
    default_headers={"User-Agent": "partner-demo/1.0"},
)

resp = client.chat.completions.create(
    model="agentic-rag",
    messages=[{"role": "user", "content": "請用一句話介紹法鼓山。"}],
)
print(resp.choices[0].message.content)
```

A runnable version: [../examples/partner_api/demo_openai_compat.py](../examples/partner_api/demo_openai_compat.py).

> ⚠️ **Cloudflare UA gotcha**: Cloudflare's bot protection returns `HTTP 403 "Your request was blocked."` for requests with the OpenAI SDK's default User-Agent. Set `default_headers={"User-Agent": "<anything>"}` on your client, or send `-H "User-Agent: <anything>"` with curl, and it works.

### When to use which

| Goal | Use |
|---|---|
| You already have OpenAI-SDK code and just want it grounded | `/v1/chat/completions` |
| You need structured citations (title, score, source_url, metadata) | `/threads` (stream or blocking) |
| You need multi-turn threads the backend remembers | `/threads` |
| You want per-partner identity + rate-limit isolation | `/threads` (M2M token carries identity) |
| Everything else | Default to `/threads` |

## Available endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness |
| POST | `/v1/chat/completions` | ✅ | OpenAI-compatible chat (stateless, `Sources:` footer) |
| GET | `/v1/models` | ✅ | OpenAI-compatible model list |
| POST | `/threads` | ✅ | Create a thread; optional `{"metadata":{...}}` body |
| GET | `/threads` | ✅ | List your threads |
| GET | `/threads/{id}/state` | ✅ | Full normalized messages |
| POST | `/threads/{id}/runs/stream` | ✅ | Stream an assistant turn (SSE) |
| PATCH | `/threads/{id}` | ✅ | Rename / archive |
| DELETE | `/threads/{id}` | ✅ | Delete |
| POST | `/threads/{id}/generate-title` | ✅ | Back-fill LLM title |
| GET | `/recommendations` | ✅ | Event-recommendation cards (used by `/events` UI) |
| GET | `/whats-new-suggestions?limit=N` | ✅ | Today's news → dharma-framed prompts |
| GET | `/assisted-learning/modules` | ✅ | Deep-dive module list |
| POST | `/quiz/generate` | ✅ | Generate an MCQ quiz |
| GET | `/sources/{source_type}/{record_id}` | ✅ | Citation detail |
| POST/DELETE | `/feedback` | ✅ | Thumbs up / down |

Full request/response shapes: [docs/api_reference.md](api_reference.md).

## Citations

Assistant messages are retrieval-grounded. Each assistant reply is a **two-part content array** — the text block plus a citations block with the source chunks the LLM used.

```json
{
  "id": "msg-...",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "法鼓山是位於金山的..." },
    { "type": "citations", "citations": [
        {
          "chunk_id": "faguquanji:09-06-029:1:886:1876",
          "title": "每位義工都是觀音菩薩的化身——法鼓山園區義工開示",
          "text": "<the actual passage from the corpus>",
          "source_url": "https://ddc.shengyen.org/html/09-06-029.html",
          "score": 0.976,
          "metadata": {
            "source_type": "faguquanji",
            "record_id": "09-06-029",
            "chunk_index": 1,
            "book_title": "法鼓山的方向：萬行菩薩",
            "chapter_title": "每位義工都是觀音菩薩的化身——法鼓山園區義工開示",
            "publish_date": null
          }
        }
      ]
    }
  ]
}
```

**Where it shows up in the stream**: the `citations` block arrives on the **`values`** event (the full thread state, emitted after the LLM settles). `messages/partial` and `messages/complete` are text-only. Citations are also available in `GET /threads/{id}/state` at any later time.

**Always iterate `content` as an array** and filter by `type` — new block types (e.g., tool outputs, images) may be added without a schema bump.

```python
for part in assistant_message["content"]:
    if part["type"] == "text":
        text = part["text"]
    elif part["type"] == "citations":
        for c in part["citations"]:
            print(c["title"], c["source_url"], c["score"])
```

**Source corpora** (via `metadata.source_type`):
- `faguquanji` — 聖嚴法師法鼓全集
- `audio` — 法鼓音檔
- `video_ddmtv01`, `video_ddmtv02`, `video_ddmmedia1321` — 法鼓影音
- `news` — 當日時事 (only for the 新鮮事 path)

## Errors

| Status | Meaning | What to do |
|---|---|---|
| `401` | Missing / expired / wrong-audience token | Re-fetch a token and retry once |
| `403` | You do not own the referenced thread | Don't retry; the thread ID is wrong |
| `404` | Thread not found (or endpoint not mounted) | Check the URL and thread ID |
| `5xx` | Transient server issue | Retry with exponential backoff |

Example 401 body: `{"detail":"Token is expired"}`.

## Python client

A minimal self-contained client lives at [../examples/partner_api/](../examples/partner_api/). It handles token caching, auto-refresh on 401, and SSE parsing.

```bash
cd examples/partner_api
pip install -r requirements.txt
export CLIENT_ID="<your client id>"
export CLIENT_SECRET="<your client secret>"
python demo.py
```

`demo.py` creates a thread, streams a short turn, prints the assistant reply token-by-token, and lists follow-up suggestions.

See [client.py](../examples/partner_api/client.py) for the class you can drop into your own project.

## Rate & cost

- **No per-user rate limiting today.** Every call hits our LLM vendor and costs real money — please keep concurrency small and cache responses when you can.
- A single chat turn typically costs `<$0.01` (mid-sized model). Long conversations accumulate.
- We monitor per-account usage in our observability stack. If your partner sub generates outlier traffic we'll reach out before pulling the plug.

## Streaming tips

- Use `Accept: text/event-stream` if your HTTP client needs the hint; the backend emits SSE regardless.
- Events are terminated by blank lines. Don't parse chunks as JSON until you've accumulated a full `event:` / `data:` pair.
- `messages/partial` carries the **running** message content, not deltas — replace the in-progress message each tick rather than appending.
- The stream ends cleanly with `event: end / data: null`. An `error` event means the turn failed; there is no in-stream recovery — call `GET /threads/{id}/state` if you need to reconcile.

## Getting help

- First: check the error detail (401 bodies describe the exact verification failure during debugging).
- Then: ping whoever shared the M2M credentials with you — we can see your traces in Langfuse and pinpoint what went wrong.

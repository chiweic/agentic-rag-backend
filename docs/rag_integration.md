# RAG Integration

How the backend plugs into a RAG library without coupling to it.

## Problem

The backend needs grounded answers with citations. The RAG library (`rag_bot`) lives in a separate repo and evolves on its own schedule. Direct imports would hard-couple the two, making it impossible to try a `rag_bot_v2` without editing the backend everywhere.

## Shape

```
app/agent/nodes.py          (retrieve, generate — no rag_bot imports)
        │
        ▼
app/rag/protocol.py         (RagService Protocol + DTOs — backend owns the contract)
        ▲
        │  set by lifespan, pulled via current_rag_service()
        │
app/rag/providers/rag_bot.py  ◄── the ONLY file in the backend that imports rag_bot
        │
        ▼
rag_bot (separate repo, installed into the backend venv)
```

### Contract — [app/rag/protocol.py](../app/rag/protocol.py)

```python
class RetrievalHit(BaseModel):
    chunk_id: str
    text: str
    title: str
    source_url: str | None = None
    score: float | None = None
    metadata: dict[str, Any] = {}

class RagAnswer(BaseModel):
    text: str
    citations: list[RetrievalHit]

class RagService(Protocol):
    def search(self, query, *, source_type=None, limit=5) -> list[RetrievalHit]: ...
    def generate(self, query, hits, *, history=None) -> RagAnswer: ...
```

Two calls, not one. Keeps room for reranking / caching / hybrid retrieval at the graph level without renegotiating the provider contract.

### Service lifecycle

- [app/rag/__init__.py](../app/rag/__init__.py) holds a module-level `_SERVICE`.
- Lifespan calls `set_rag_service(build_rag_service(settings))` once.
- Request handlers call `current_rag_service()` and inject into `config["configurable"]["rag_service"]`.
- Tests swap in a `FakeRagService` via `set_rag_service(...)` in [tests/conftest.py](../tests/conftest.py).

### Provider selection

`settings.rag_provider` is a Literal — dispatch happens in `build_rag_service`:

| `RAG_PROVIDER` | Behavior |
|---|---|
| `rag_bot` (default) | Uses [app/rag/providers/rag_bot.py](../app/rag/providers/rag_bot.py) — real retrieval + LLM |
| `null`              | Uses [app/rag/providers/_null.py](../app/rag/providers/_null.py) — empty hits, passthrough text |

## Config

rag_bot exposes `rag_bot.llm_config.resolve(role_env_var)` as the single source of truth for `{vendor, base_url, model, api_key}`. The backend adapter calls `resolve("GEN_LLM")` — no reimplementation, no duplicated env vars.

Env surface the backend reads directly:

| Var | Purpose |
|---|---|
| `RAG_PROVIDER` | `rag_bot` (default) or `null` |
| `DATA_ROOT` | Passed to `DataSourceManager` — rag_bot's managed data dir |
| `DEFAULT_SOURCE_TYPE` | Corpus used when a request omits `metadata.source_type` |
| `RETRIEVAL_BACKEND` | `milvus` (default) or `lexical` |
| `RETRIEVAL_LIMIT` | Top-k passed to `search()` |
| `RERANK_ENABLED` | Toggle rag_bot's reranker |
| `GEN_LLM` | Vendor alias — `resolve()` reads `{VENDOR}_BASE_URL/API_KEY/MODEL_NAME` |

Per-request override: pass `metadata.source_type` on `/threads/{id}/runs/stream` or `/v1/chat/completions`. Threads inject it into `AgentState.source_type`; OpenAI-compat threads it into the graph config directly.

## Citations on the wire

Assistant messages have two content blocks:

```json
{
  "role": "assistant",
  "content": [
    {"type": "text", "text": "禪修是..."},
    {"type": "citations", "citations": [{"chunk_id": "...", "title": "...", "source_url": "..."}]}
  ]
}
```

- `/threads` and `/threads/{id}/state` pass both blocks through unchanged ([app/api/normalize.py](../app/api/normalize.py)).
- `/v1/chat/completions` flattens the citations block into a `Sources:` footer appended to the text — OpenAI clients don't understand custom block types.
- Streaming `/v1` emits a final footer chunk after token streaming completes ([app/api/openai_compat.py](../app/api/openai_compat.py)).

## Adding a new provider (e.g. `rag_bot_v2`)

1. Copy [app/rag/providers/rag_bot.py](../app/rag/providers/rag_bot.py) to `rag_bot_v2.py`.
2. Replace the imports; keep the `RagService` surface identical.
3. Map the new library's hit/answer types into `RetrievalHit` / `RagAnswer`.
4. Add a `"rag_bot_v2"` case to [app/rag/__init__.py](../app/rag/__init__.py) `build_rag_service`.
5. Widen `rag_provider: Literal[...]` in [app/core/config.py](../app/core/config.py).

Nothing outside `app/rag/providers/` needs to change.

## Running locally

```bash
cd /mnt/data/backend
source venv/bin/activate
pip install -e /mnt/data/rag_bot[langchain]

cp .env.example .env    # fill in GEN_LLM, vendor creds, DATA_ROOT
uvicorn app.main:app --reload --host 0.0.0.0 --port 8081
```

Smoke test:

```bash
# dev token (AUTH_DEV_MODE=true)
TOKEN=$(curl -s -X POST localhost:8081/auth/dev-token \
  -H "Content-Type: application/json" \
  -d '{"sub":"local-dev"}' | jq -r .access_token)

# OpenAI-compat with a Chinese query
curl -s localhost:8081/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"agentic-rag","messages":[{"role":"user","content":"什麼是禪修？"}],"metadata":{"source_type":"faguquanji"}}' | jq -r '.choices[0].message.content'
```

Expect a grounded answer followed by `Sources: <title> (<url>)` lines.

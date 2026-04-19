# Frontend Handoff — RAG Integration is Live on the Backend

**As of 2026-04-17.** Backend Milestone A (RAG via pluggable `RagService`) is merged. This doc is a catch-up for frontend work that starts from here.

## What changed on the wire

The backend's LangGraph pipeline is now `START → retrieve → generate → END` (previously just `generate`). Assistant messages now carry **two content blocks** instead of one:

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "..." },
    { "type": "citations", "citations": [ ... ] }
  ]
}
```

Every assistant message from `/threads` and `/api/chat` has this shape. Older messages (pre-RAG) are plain `{type:"text"}` only — code must tolerate the absence of the citations block.

### Citation object shape

```ts
type Citation = {
  chunk_id: string;
  text: string;
  title: string;
  source_url: string | null;
  score: number | null;
  metadata: {
    source_type: string;          // e.g. "faguquanji"
    record_id?: string;
    chunk_index?: number;
    publish_date?: string | null;
  };
};
```

Source: [app/rag/protocol.py](../app/rag/protocol.py). Normalisation in [app/api/normalize.py](../app/api/normalize.py) passes the `citations` block through unchanged.

### Per-endpoint behaviour

| Endpoint | Citations delivery |
|---|---|
| `POST /threads/{id}/runs/stream` (SSE) | Tokens arrive as `messages/partial`; final `messages/complete` carries **text-only**; the **`values`** event at the end carries the full message including the `citations` block. |
| `GET /threads/{id}/state` | Assistant messages include both blocks. |
| `POST /v1/chat/completions` (non-stream) | Citations **flattened into the text** as a `Sources:` footer. No separate block. |
| `POST /v1/chat/completions` (stream) | Token chunks first, then one final chunk containing `\n\nSources:\n- Title (URL)...`, then `[DONE]`. |
| `POST /api/chat`, `/api/chat/stream` | Unchanged in contract — message content is still an object, now possibly a list of blocks. |

### Per-request source override

Clients can pick which corpus to retrieve from by passing `metadata.source_type`:

```jsonc
// /threads/{id}/runs/stream
{
  "input": { "messages": [{"role":"user","content":"..."}] },
  "metadata": { "source_type": "faguquanji" }
}

// /v1/chat/completions (same key inside the top-level metadata field)
{
  "model": "agentic-rag",
  "messages": [...],
  "metadata": { "source_type": "faguquanji" }
}
```

Missing metadata falls back to `settings.default_source_type` (currently `faguquanji`).

## Recommended rendering

For the assistant-ui frontends ([frontend](../frontend/), [mobile-v3](../mobile-v3/)):

1. **Split blocks.** Iterate `message.content[]`. For `type === "text"` render the markdown body. For `type === "citations"` render a footnote/accordion with the `citations[]` array.
2. **Deduplicate by `chunk_id`.** The backend doesn't dedupe; multiple chunks from the same document are common.
3. **Group by `title` or `source_url`** if you want a "3 sources" count under the answer rather than N chunk cards.
4. **Link out via `source_url`** when present; fall back to `title` when null.
5. **Streaming:** ignore the citations block during `messages/partial` — it arrives only in the final `values` event. Render it once after `messages/complete` fires.
6. **Source switcher UI:** a per-conversation dropdown that sets `metadata.source_type` on the next runs/stream call is the cheapest way to let the user choose a corpus.

## Running the backend locally

```bash
cd /mnt/data/backend
python3.12 -m venv venv && source venv/bin/activate
pip install -e ".[dev]"
pip install -e /mnt/data/rag_bot[langchain]

cp .env.example .env    # fill GEN_LLM + {VENDOR}_* creds, DATA_ROOT, AUTH_DEV_MODE=true
uvicorn app.main:app --host 0.0.0.0 --port 8082
```

Expected log lines on startup:
```
RAG provider: rag_bot
Thread metadata store initialised (memory)   # or (postgres)
AUTH_DEV_MODE=True — dev signer active ...
Uvicorn running on http://0.0.0.0:8082
```

### Getting a bearer token in dev

When `AUTH_DEV_MODE=true`:
```bash
TOKEN=$(curl -s -X POST http://localhost:8082/auth/dev-token \
  -H "Content-Type: application/json" \
  -d '{"sub":"frontend-dev","ttl_seconds":86400}' \
  | jq -r .access_token)
```

Tokens don't survive a `uvicorn` restart (fresh RSA key each time).

## Config surface the frontend probably cares about

Configured in backend `.env`:

| Var | Effect seen from the frontend |
|---|---|
| `RAG_PROVIDER=rag_bot` | Grounded answers with citations. `null` = no-RAG passthrough. |
| `DEFAULT_SOURCE_TYPE` | Fallback corpus when no `metadata.source_type` is passed. |
| `RETRIEVAL_BACKEND=milvus\|lexical` | Lexical is self-contained; Milvus needs TEI + Milvus up. |
| `RERANK_ENABLED` | Changes citation ordering only. |
| `AUTH_DEV_MODE=true` | Enables `POST /auth/dev-token`. |

## Ongoing work

- **Milestone B — production tracing.** Langfuse spans on retrieve/generate matching the eval-trace shape, so reference-free scoring via `rag_bot.eval.scorer.DeepEvalEvaluator` can run against prod traffic. Not yet started. Won't change API shapes — only adds observability.
- Streaming is **token-level already** for both `/threads` and `/v1`. No planned changes there.

## Gotchas hit during backend spot-test

- `AUTH_DEV_MODE=false` + expecting `/auth/dev-token` → 404. Flip to `true` and restart.
- Dev signer regenerates RSA keys per process, so `Invalid token` right after a restart means you need to re-mint.
- `RETRIEVAL_BACKEND=milvus` without TEI/Milvus running → 500 on the first `/threads/*/runs/stream`. Use `lexical` for frontend dev without infra.
- `langchain-huggingface>=1.2.2` breaks TEI embeddings (rejects URLs in `model=`). rag_bot is pinned `<1.2.2`; if you rebuild the backend venv and see `model must be a HuggingFace repo ID`, that's this — run `pip install 'langchain-huggingface==1.2.1'`.

## Pointers

- Backend architecture: [CLAUDE.md](../CLAUDE.md)
- RAG integration internals: [docs/rag_integration.md](./rag_integration.md)
- API reference: [docs/api_reference.md](./api_reference.md)
- Example of the new content-block shape: [tests/test_rag_behavior.py](../tests/test_rag_behavior.py) (deterministic fixture, easy to read)

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Multi-Agent Coordination

Read and follow `AGENTS.md` for rules on working alongside other AI agents (e.g. Codex). Use branch prefix `claude/` for feature branches.

## What This Is

Agentic RAG backend — FastAPI + LangGraph + Langfuse observability. See `docs/agent_context.md` for full design principles.

## Commands

```bash
# Activate venv
source venv/bin/activate

# Install (editable + dev deps)
pip install -e ".[dev]"

# Run server (0.0.0.0 required for Docker clients like Open WebUI)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8081

# Lint
ruff check app/ tests/
ruff format app/ tests/

# Test
pytest
pytest tests/test_foo.py::test_bar  # single test
```

## Architecture

```
app/
├── main.py              # FastAPI app, CORS, lifespan (installs RagService, Langfuse shutdown)
├── core/
│   ├── config.py        # pydantic-settings + load_dotenv (must load before SDK imports)
│   └── tracing.py       # Langfuse config builder (callback + metadata per request)
├── rag/                 # RAG integration layer — see "RAG Service" section below
│   ├── protocol.py      # RagService Protocol + RetrievalHit, RagAnswer DTOs
│   ├── __init__.py      # build_rag_service() factory + set/current service getters
│   └── providers/       # _null.py + rag_bot.py (the ONLY file that imports rag_bot)
├── agent/
│   ├── state.py         # AgentState (Pydantic model for LangGraph)
│   ├── nodes.py         # retrieve + generate nodes — pull RagService from config["configurable"]
│   └── graph.py         # StateGraph: START → retrieve → generate → END
└── api/
    ├── schemas.py       # Request/response Pydantic models (custom + OpenAI-compat)
    ├── chat.py          # POST /api/chat, POST /api/chat/stream (SSE)
    ├── openai_compat.py # POST /v1/chat/completions (Sources: footer) + /v1/models
    └── threads.py       # LangGraph Cloud-compatible thread/run endpoints (assistant-ui)
```

## Key Design Rules (from docs/agent_context.md)

- **LangGraph pipeline, NOT LangChain agent loop** — deterministic flow, no LLM deciding control flow
- **Each step is a function** — a node in the graph, independently testable
- **All steps must be observable** — every node traced via Langfuse callback handler
- **LLM uses structured output** — no hidden logic inside LLM
- **Retrieval is separated** — dense / sparse / merge / rerank as distinct nodes (not yet wired)

## RAG Service

Retrieval + grounded generation are decoupled from rag_bot via a Protocol. See [docs/rag_integration.md](docs/rag_integration.md) for the full provider-add guide.

- [app/rag/protocol.py](app/rag/protocol.py) — `RagService` Protocol + `RetrievalHit` / `RagAnswer` DTOs. Backend code outside the adapter sees **only** these types.
- [app/rag/providers/rag_bot.py](app/rag/providers/rag_bot.py) — single integration seam. Only file allowed to `import rag_bot`. Uses `rag_bot.llm_config.resolve("GEN_LLM")` so both repos share one env-var schema.
- [app/rag/__init__.py](app/rag/__init__.py) — `build_rag_service(settings)` picks a provider from `RAG_PROVIDER` (`rag_bot` default, `null` fallback). Lifespan calls `set_rag_service(...)`; request handlers pull via `current_rag_service()`.
- Nodes read the service from `config["configurable"]["rag_service"]` — no imports of providers or rag_bot from [app/agent/](app/agent/).
- Assistant messages carry two content blocks: `{type:"text",...}` + `{type:"citations", citations:[...]}`. OpenAI-compat flattens the citations block into a `Sources:` footer.
- Per-request source override: pass `metadata.source_type` on `/threads/*/runs/stream` or `/v1/chat/completions`.

To add a new provider (e.g. `rag_bot_v2`): copy [app/rag/providers/rag_bot.py](app/rag/providers/rag_bot.py), implement `RagService`, register it in [app/rag/__init__.py](app/rag/__init__.py).

## Thread / Conversation Model

LangGraph's `MemorySaver` checkpointer persists conversation state per `thread_id`. Each thread is a ChatGPT-like conversation:
- `POST /threads` creates a new thread (returns `thread_id`)
- `POST /threads/{id}/runs/stream` sends a message and streams the response (SSE)
- `GET /threads/{id}/state` returns full message history
- The assistant-ui frontend uses `ExternalStoreRuntime` with an app-owned Zustand store (see `docs/planning.md`)
- Thread metadata (title, archive, created_at) is stored in Postgres via `app/core/thread_store.py`, separately from checkpointer state
- Thread endpoints return normalized messages: `{id, role, content: [{type:"text", text}]}` (see `app/api/normalize.py` and `docs/api_reference.md`)

## Langfuse Integration

- `tracing.py` builds a config dict with `CallbackHandler` + metadata (`user_id`, `session_id`, tags)
- Config is passed into `agent_graph.ainvoke()` / `astream_events()`
- Langfuse v4: trace attributes go in `config.metadata` (not handler constructor)
- Langfuse client is shut down in FastAPI lifespan on app exit
- Environment variables: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`

## API Endpoints

| Method | Path                           | Client          | Description                    |
|--------|--------------------------------|-----------------|--------------------------------|
| POST   | `/threads`                     | assistant-ui    | Create a conversation thread   |
| GET    | `/threads/{id}/state`          | assistant-ui    | Get thread messages            |
| POST   | `/threads/{id}/runs/stream`    | assistant-ui    | Run agent & stream (SSE)       |
| POST   | `/v1/chat/completions`         | Open WebUI      | OpenAI-compatible chat         |
| GET    | `/v1/models`                   | Open WebUI      | Model list                     |
| POST   | `/api/chat`                    | custom frontend | Non-streaming chat             |
| POST   | `/api/chat/stream`             | custom frontend | SSE streaming chat             |
| GET    | `/health`                      | any             | Health check                   |

Open WebUI connection URL: `http://<host-ip>:8081/v1`

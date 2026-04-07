# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
├── main.py              # FastAPI app, CORS, lifespan (Langfuse shutdown)
├── core/
│   ├── config.py        # pydantic-settings + load_dotenv (must load before SDK imports)
│   └── tracing.py       # Langfuse config builder (callback + metadata per request)
├── agent/
│   ├── state.py         # AgentState (Pydantic model for LangGraph)
│   ├── nodes.py         # Graph nodes — each step is a standalone function
│   └── graph.py         # LangGraph StateGraph + MemorySaver checkpointer
└── api/
    ├── schemas.py       # Request/response Pydantic models (custom + OpenAI-compat)
    ├── chat.py          # POST /api/chat, POST /api/chat/stream (SSE)
    ├── openai_compat.py # POST /v1/chat/completions, GET /v1/models (Open WebUI)
    └── threads.py       # LangGraph Cloud-compatible thread/run endpoints (assistant-ui)
```

## Key Design Rules (from docs/agent_context.md)

- **LangGraph pipeline, NOT LangChain agent loop** — deterministic flow, no LLM deciding control flow
- **Each step is a function** — a node in the graph, independently testable
- **All steps must be observable** — every node traced via Langfuse callback handler
- **LLM uses structured output** — no hidden logic inside LLM
- **Retrieval is separated** — dense / sparse / merge / rerank as distinct nodes (not yet wired)

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

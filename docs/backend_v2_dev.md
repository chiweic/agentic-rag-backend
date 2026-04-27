# Backend v2 — Step 1: Standalone MCP Retrieval Server

## Goal

Build a standalone MCP server that exposes the DDM domain knowledge base as tools over the MCP protocol. Three collections are indexed and ready: books, video/audio transcripts, and events. This is the foundation layer — independently deployable, testable, and reusable by any MCP-compatible client (the LangGraph agent, Claude Code, other agents).

## Deliverables

1. **MCP server** — A standalone Python service exposing `search_books`, `search_transcripts`, `search_events` tools over MCP (stdio + SSE transport)
2. **Verified** — Tools callable from Claude Code returning ranked results from existing Milvus indices
3. **Retrieval validated** — Raw retrieval pipeline tested against golden queries before MCP wrapping

## Non-goals (deferred to later steps)

- Modifying the LangGraph agent graph (step 2)
- Planner/router logic (step 3)
- Data ingestion pipeline (indices already exist)
- Endpoint changes to the FastAPI backend

## Architecture

```
┌─────────────────────┐     MCP protocol      ┌─────────────────────────┐
│  LangGraph Agent    │ ◄──────────────────►   │  MCP Retrieval Server   │
│  (FastAPI backend)  │     (step 2)           │  (standalone service)   │
└─────────────────────┘                        └────────┬────────────────┘
                                                        │
                                          ┌─────────────┼─────────────┐
                                          │             │             │
                                     ┌────▼───┐   ┌────▼───┐   ┌────▼───┐
                                     │ Milvus │   │  TEI   │   │Reranker│
                                     │localhost│  │area51r5│   │area51r5│
                                     │ :19530 │   │ :8080  │   │ :8081  │
                                     └────────┘   └────────┘   └────────┘
```

All retrieval infra is already deployed and running. No docker-compose setup needed — the MCP server connects to them as external services.

## Retrieval Contract (resolved)

### Models

| Component | Model ID | Notes |
|-----------|----------|-------|
| Embedder | `BAAI/bge-m3` | 1024 dimensions, multilingual |
| Reranker | `BAAI/bge-reranker-v2-m3` | CrossEncoder-based |

### Infrastructure

| Service | URL | Status |
|---------|-----|--------|
| Milvus | `http://127.0.0.1:19530` | Running (v2.6.12-gpu) |
| TEI Embedder | `http://area51r5:8080` | Running |
| Reranker | `http://area51r5:8081/rerank` | Running (custom FastAPI wrapper) |
| MongoDB (source docs) | `mongodb://area51r5:27017` | Running |

Milvus auth token: `root:Milvus`

### Milvus Collections

All collections use `BAAI/bge-m3` embeddings (1024 dim), dense-only search (FLAT index). Books are in the `milvus_demo` database; transcripts and events are in the `default` database.

#### 1. `faguquanji_chunks_langchain_bge_m3` — Books

~120 Buddhist books, chunked via LangChain. Vector field: `text_vector`.

| Field | Type | Notes |
|-------|------|-------|
| `text_vector` | FLOAT_VECTOR(1024) | LangChain default vector field |
| `chunk_id` | VARCHAR | Stable chunk identifier |
| `source_id` | VARCHAR | Parent document ID |
| `source_type` | VARCHAR | |
| `book_id` | VARCHAR | |
| `book_title_normalized` | VARCHAR | Book title |
| `chapter_id` | VARCHAR | |
| `chapter_title_normalized` | VARCHAR | Chapter title |
| `url` | VARCHAR | |
| `chunk_index` | INT64 | Position within document |
| `chunk_count` | INT64 | Total chunks in document |
| `previous_chunk_id` | VARCHAR | Linked list for context |
| `next_chunk_id` | VARCHAR | Linked list for context |

#### 2. `ddm_transcripts_bge_m3` — Video/Audio Transcripts

39,075 chunks from DDM (法鼓山) video/audio transcripts. Vector field: `embedding`. Dynamic fields enabled.

| Field | Type | Notes |
|-------|------|-------|
| `id` | VARCHAR (PK) | Format: `{video_id}::chunk::{n}` |
| `doc_id` | VARCHAR | Video/audio ID |
| `text` | VARCHAR | Transcript chunk text |
| `embedding` | FLOAT_VECTOR(1024) | Vector field |
| `source_type` | VARCHAR (dynamic) | `transcript` |
| `media_type` | VARCHAR (dynamic) | `video` or `audio` |
| `video_id` | VARCHAR (dynamic) | YouTube video ID |
| `title` | VARCHAR (dynamic) | Video title |
| `speaker` | VARCHAR (dynamic) | Speaker name |
| `publish_date` | VARCHAR (dynamic) | e.g. `2015-05-27` |
| `source_url` | VARCHAR (dynamic) | YouTube URL |
| `channel` | VARCHAR (dynamic) | Channel name, e.g. `聖嚴法師大法鼓` |
| `description` | VARCHAR (dynamic) | Video description |
| `duration_seconds` | INT64 (dynamic) | Video duration |
| `thumbnail_url` | VARCHAR (dynamic) | YouTube thumbnail |

#### 3. `ddm_events_bge_m3` — Events

3,704 chunks from DDM event listings. Vector field: `embedding`. Dynamic fields enabled.

| Field | Type | Notes |
|-------|------|-------|
| `id` | VARCHAR (PK) | Format: `{event_id}::chunk::{n}` |
| `doc_id` | VARCHAR | Event ID |
| `text` | VARCHAR | Event description text |
| `embedding` | FLOAT_VECTOR(1024) | Vector field |
| `source_type` | VARCHAR (dynamic) | `event` |
| `title` | VARCHAR (dynamic) | Event title |
| `category` | VARCHAR (dynamic) | e.g. `禪藝生活` |
| `location` | VARCHAR (dynamic) | Venue name |
| `organizer` | VARCHAR (dynamic) | Organizing unit |
| `audience` | VARCHAR (dynamic) | Target audience |
| `city` | VARCHAR (dynamic) | City |
| `district` | VARCHAR (dynamic) | District |
| `event_url` | VARCHAR (dynamic) | DDM event page URL |
| `start_date` | VARCHAR (dynamic) | e.g. `2026/03/25` |
| `end_date` | VARCHAR (dynamic) | e.g. `2026/06/10` |
| `time_start` | VARCHAR (dynamic) | e.g. `13:30` |
| `time_end` | VARCHAR (dynamic) | e.g. `16:00` |
| `is_recurring` | BOOL (dynamic) | Whether event recurs |
| `session_dates` | list (dynamic) | List of session dates |
| `session_count` | INT64 (dynamic) | Number of sessions |

**Note:** The books collection uses `text_vector` as the vector field name (LangChain convention), while transcripts and events use `embedding` (LlamaIndex convention).

### Retrieval Pipeline Parameters

| Parameter | Value |
|-----------|-------|
| Top K (final results) | 5 |
| Rerank candidate K | 20 |
| Reranker max candidates | 100 |
| Reranker max input length | 256 tokens |
| Reranker timeout | 120s |

### Golden Query

From existing `rag_bot_langchain.py`:
- Query: `"禪修"` (meditation)
- Expected: returns relevant chunks from Buddhist book content about meditation practices

## Sub-tasks

### 1.1 Validate retrieval pipeline

Before writing MCP wrappers, validate the raw retrieval pipeline connects to existing infra:

1. Embed query `"禪修"` via TEI at `area51r5:8080`
2. Search Milvus collection `faguquanji_chunks_langchain_bge_m3`
3. Rerank candidates via `area51r5:8081/rerank`
4. Verify results match expected domain content

Deliverable: a validation script (`scripts/test_retrieval.py`) that proves end-to-end retrieval works against the existing infra.

### 1.2 Build MCP server

New directory: `mcp-retrieval/` (standalone, separate from `app/`)

```
mcp-retrieval/
├── server.py           # MCP server entry point (stdio + SSE)
├── tools/
│   ├── search_books.py
│   ├── search_transcripts.py
│   └── search_events.py
├── retrieval/
│   ├── embedder.py     # TEI client (embed query → 1024-dim vector)
│   ├── milvus.py       # Milvus client (dense L2 search)
│   └── reranker.py     # Reranker client (POST area51r5:8081/rerank)
├── config.py           # Env-based config (Milvus/TEI/reranker URLs)
├── pyproject.toml      # Dependencies (mcp, pymilvus, httpx)
└── README.md
```

**MCP transport:** Both stdio and SSE from the same entry point.
- stdio: default for local dev and Claude Code (`python server.py`)
- SSE: via flag for networked clients (`python server.py --transport sse`)

**Retrieval pipeline per tool call:**
1. Embed user query → 1024-dim vector via TEI (`BAAI/bge-m3`)
2. Search target Milvus collection — dense L2, retrieve top 20 candidates
3. Rerank 20 → 5 via `BAAI/bge-reranker-v2-m3`
4. Return top 5 results with metadata

**Note:** The vector field name differs per collection — `text_vector` for books, `embedding` for transcripts and events. The retrieval client must handle this.

### 1.3 Tool definitions

| Tool | Collection | Description | Parameters |
|------|-----------|-------------|------------|
| `search_books` | `faguquanji_chunks_langchain_bge_m3` | Search Buddhist book content | `query: str`, `top_k: int = 5` |
| `search_transcripts` | `ddm_transcripts_bge_m3` | Search DDM video/audio transcripts | `query: str`, `top_k: int = 5` |
| `search_events` | `ddm_events_bge_m3` | Search DDM event listings | `query: str`, `top_k: int = 5` |

Return schema per tool:

**search_books:**
```json
{
  "id": "chunk_id value",
  "source_type": "book",
  "title": "book_title_normalized",
  "chapter": "chapter_title_normalized",
  "text": "chunk content...",
  "score": 0.87,
  "book_id": "...",
  "chapter_id": "...",
  "url": "..."
}
```

**search_transcripts:**
```json
{
  "id": "video_id::chunk::n",
  "source_type": "transcript",
  "title": "video title",
  "text": "transcript chunk...",
  "score": 0.87,
  "media_type": "video|audio",
  "speaker": "...",
  "channel": "...",
  "publish_date": "2015-05-27",
  "source_url": "https://www.youtube.com/watch?v=...",
  "duration_seconds": 520
}
```

**search_events:**
```json
{
  "id": "event_id::chunk::n",
  "source_type": "event",
  "title": "event title",
  "text": "event description...",
  "score": 0.87,
  "category": "禪藝生活",
  "location": "venue name",
  "organizer": "...",
  "city": "...",
  "start_date": "2026/03/25",
  "end_date": "2026/06/10",
  "event_url": "https://www.ddm.org.tw/..."
}
```

### 1.4 Verification

- [ ] Retrieval validation script passes against existing infra
- [ ] Golden query `"禪修"` returns relevant Buddhist meditation content from books
- [ ] Golden query `"禪修"` returns relevant transcript results from DDM videos
- [ ] Golden query `"禪修"` returns relevant event results
- [ ] MCP server starts and registers all 3 tools
- [ ] Each tool returns ranked results with correct metadata fields
- [ ] Test via Claude Code: add MCP server to `.claude.json`, ask about Buddhist meditation, see tool calls + results
- [ ] Graceful error handling when Milvus/TEI/reranker is unreachable

## Reference: Existing Implementation

The retrieval pipeline is already implemented in `/home/chiweic/repository/llamaindex/`:
- `langchain_vectorstore.py` — Milvus connection, embedding, reranking via `get_rerank_retriever()`
- `llm_factory.py` — LLM configuration
- `rag_bot_langchain.py` — End-to-end RAG bot using the retriever
- `.env.dev` — Environment config for the retrieval stack

The MCP server implementation should replicate the retrieval logic from `langchain_vectorstore.py` but without LangChain dependency — use direct `pymilvus` + `httpx` calls for cleaner, lighter code.

## Review Comments

<details>
<summary>Archived review feedback (resolved)</summary>

### Comment 1: Model compatibility
**Status:** Resolved. Embedding model is `BAAI/bge-m3` (1024 dim), reranker is `BAAI/bge-reranker-v2-m3`.

### Comment 2: Data restore path
**Status:** Resolved. Milvus is already running on `area51r5` with the existing index loaded. No restore needed.

### Comment 3: Transport decision
**Status:** Resolved. Support both stdio (default) and SSE from day one.

### Comment 4: Milvus schema contract
**Status:** Resolved. Collection schema documented above.

### Comment 5: Result schema stable IDs
**Status:** Resolved. `id` (from `chunk_id`) and `source_type` included in result schema.

### Comment 6: Verification criteria
**Status:** Resolved. Golden query `"禪修"` defined, validation script required before MCP wrapping.

### Comment 7: Sequencing
**Status:** Resolved. Validate retrieval first (1.1), then build MCP server (1.2).

</details>

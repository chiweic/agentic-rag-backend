**Goal**
- v2 backend is to add RAG functionality
- possible a more elaborated agent work flow
- especially using domain (DDM) data
- domain data: buddhish books, events, media
- no endpoint changes

**Thoughts**
- using concepts from https://blog.langchain.com/deep-agents-deploy-an-open-alternative-to-claude-managed-agents/
- seek to establish framework on deep-agents
    - MCP
    - Skills
    - A2A
    - Agent Protocol

**Q&A**

1. **Domain data ingestion** — What formats, how much data?
   - ~120 books already chunked and indexed via LangChain. Events, audio, and video also indexed.
   - No ingestion pipeline needed for v2 — wire up the existing retriever.

2. **Retrieval infra readiness** — Milvus, TEI embedder, reranker deployed?
   - Previously deployed in another setup. Need to bring up Milvus, TEI embedder, and reranker as part of this phase (docker-compose / deploy config in this repo).

3. **"Deep agents" scope** — MCP, Skills, A2A, Agent Protocol all in v2?
   - Plan: wrap retriever (and other domain tools) as MCP tools, use Skills on top of them.
   - MCP keeps retrieval decoupled and reusable by other agents/clients.
   - MCP server as a standalone sidecar — decoupled, reusable by other agents and clients.

4. **Agent behavior** — Always retrieve, or decide per query?
   - Add a Planner/router node that classifies the query and decides strategy (direct answer, RAG search, multi-step).
   - Replaces current `START → generate → END` with `START → planner → [route] → ... → generate → END`.

5. **Endpoint changes** — New endpoints needed?
   - No. Existing `/threads/{id}/runs/stream` and `/v1/chat/completions` stay as-is. RAG is internal to the agent graph.

**Incremental Build Plan**
1. Build standalone MCP server exposing domain retriever as tools (Milvus + TEI + reranker)
2. Connect LangGraph agent to MCP server as a tool-calling client
3. Add planner/router node (classify → route to RAG, direct answer, or multi-step)
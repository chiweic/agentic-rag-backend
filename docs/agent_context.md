This project is an Agentic RAG system.

Architecture:
- FastAPI backend
- LangGraph pipeline (NOT LangChain agent loop)
- Milvus for retrieval (dense + BM25 + RRF)
- TEI embedder (bge / qwen embedder)
- Reranker (bge / qwen reranker)
- Langfuse for observability

Key principles:
- Deterministic flow (no LLM deciding everything)
- Explicit retrieval pipeline
- All steps must be observable (Langfuse spans)
- Support evaluation (faithfulness, hit rate)

Coding rules:
- No hidden logic inside LLM
- LLM instance must use structured output
- Retrieval MUST be separated: dense / sparse / merge / rerank
- Each step must be a function
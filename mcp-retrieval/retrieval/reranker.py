"""Reranker client — rerank candidate documents via TEI reranker endpoint."""

import httpx
from config import TEI_RERANK_URL


async def rerank(
    query: str,
    documents: list[dict],
    text_field: str,
    top_n: int,
) -> list[dict]:
    """Rerank documents and return top_n with scores."""
    if not documents:
        return []

    texts = [doc.get(text_field, "") for doc in documents]
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            TEI_RERANK_URL,
            json={"query": query, "texts": texts, "raw_scores": False},
        )
        resp.raise_for_status()

    scored = resp.json()
    scored.sort(key=lambda x: x["score"], reverse=True)

    results = []
    for item in scored[:top_n]:
        doc = documents[item["index"]]
        results.append({"score": item["score"], **doc})
    return results

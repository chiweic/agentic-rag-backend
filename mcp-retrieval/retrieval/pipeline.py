"""Full retrieval pipeline: embed → search → rerank."""

from config import CANDIDATE_K, COLLECTIONS

from retrieval.embedder import embed_query
from retrieval.milvus import search
from retrieval.reranker import rerank


async def retrieve(collection_key: str, query: str, top_k: int) -> list[dict]:
    """Run the full retrieval pipeline for a collection.

    Args:
        collection_key: One of "books", "transcripts", "events".
        query: The search query text.
        top_k: Number of final results after reranking.

    Returns:
        List of result dicts with score and metadata.
    """
    cfg = COLLECTIONS[collection_key]
    output_fields = [cfg["text_field"]] + cfg["metadata_fields"]

    vector = await embed_query(query)

    candidates = search(
        collection_name=cfg["collection_name"],
        db_name=cfg["db_name"],
        vector=vector,
        vector_field=cfg["vector_field"],
        metric_type=cfg["metric_type"],
        output_fields=output_fields,
        limit=CANDIDATE_K,
    )

    results = await rerank(query, candidates, cfg["text_field"], top_k)
    return results

#!/usr/bin/env python3
"""Validate the retrieval pipeline (embed → search → rerank) against existing infra.

Usage:
    python scripts/test_retrieval.py
    python scripts/test_retrieval.py --query "禪修" --collection faguquanji_chunks_langchain_bge_m3

Environment variables:
    MILVUS_URI          default: http://127.0.0.1:19530
    MILVUS_TOKEN        default: root:Milvus
    TEI_EMBED_URL       default: http://area51r5:8080
    TEI_RERANK_URL      default: http://area51r5:8091/rerank
"""

import argparse
import os
import sys
import time

import httpx
from pymilvus import MilvusClient

# ── Config ───────────────────────────────────────────────────────────

MILVUS_URI = os.getenv("MILVUS_URI", "http://127.0.0.1:19530")
MILVUS_TOKEN = os.getenv("MILVUS_TOKEN", "root:Milvus")
TEI_EMBED_URL = os.getenv("TEI_EMBED_URL", "http://area51r5:8080")
TEI_RERANK_URL = os.getenv("TEI_RERANK_URL", "http://area51r5:8081/rerank")

# Collection configs: name → (vector_field, metadata_fields_to_display, db_name)
COLLECTIONS = {
    "faguquanji_chunks_langchain_bge_m3": {
        "vector_field": "vector",
        "metric_type": "L2",
        "db_name": "milvus_demo",
        "display_fields": ["book_title_normalized", "chapter_title_normalized", "chunk_id"],
        "text_field": "text",
    },
    "ddm_transcripts_bge_m3": {
        "vector_field": "embedding",
        "metric_type": "IP",
        "db_name": "default",
        "display_fields": ["title", "channel", "publish_date", "source_url"],
        "text_field": "text",
    },
    "ddm_events_bge_m3": {
        "vector_field": "embedding",
        "metric_type": "IP",
        "db_name": "default",
        "display_fields": ["title", "category", "location", "start_date", "end_date"],
        "text_field": "text",
    },
}

CANDIDATE_K = 20
TOP_K = 5


# ── Step 1: Embed ───────────────────────────────────────────────────


def embed_query(query: str) -> list[float]:
    """Embed a query string via TEI endpoint. Returns 1024-dim vector."""
    t0 = time.time()
    resp = httpx.post(
        f"{TEI_EMBED_URL}/embed",
        json={"inputs": query, "truncate": True},
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()
    # TEI returns [[float, ...]] for single input
    vector = data[0] if isinstance(data[0], list) else data
    elapsed = time.time() - t0
    print(f"  Embed: {len(vector)} dims, {elapsed:.3f}s")
    return vector


# ── Step 2: Search Milvus ────────────────────────────────────────────


def ensure_collection_loaded(client: MilvusClient, collection: str):
    """Load collection into memory if not already loaded."""
    try:
        client.load_collection(collection)
    except Exception:
        pass  # Already loaded


def search_milvus(
    client: MilvusClient,
    collection: str,
    vector: list[float],
    vector_field: str,
    metric_type: str,
    top_k: int,
    output_fields: list[str],
) -> list[dict]:
    """Dense search against a Milvus collection."""
    ensure_collection_loaded(client, collection)
    t0 = time.time()
    results = client.search(
        collection_name=collection,
        data=[vector],
        anns_field=vector_field,
        limit=top_k,
        output_fields=output_fields,
        search_params={"metric_type": metric_type},
    )
    elapsed = time.time() - t0
    hits = results[0] if results else []
    print(f"  Milvus search: {len(hits)} hits, {elapsed:.3f}s")
    return [
        {"id": h.get("id", h.get("pk")), "distance": h["distance"], **h["entity"]} for h in hits
    ]


# ── Step 3: Rerank ───────────────────────────────────────────────────


def rerank(query: str, documents: list[dict], text_field: str, top_n: int) -> list[dict]:
    """Rerank documents via the TEI reranker endpoint."""
    if not documents:
        return []
    texts = [doc.get(text_field, "") for doc in documents]
    t0 = time.time()
    resp = httpx.post(
        TEI_RERANK_URL,
        json={"query": query, "texts": texts, "raw_scores": False},
        timeout=120.0,
    )
    resp.raise_for_status()
    scores = resp.json()
    elapsed = time.time() - t0
    print(f"  Rerank: {len(scores)} scored, {elapsed:.3f}s")

    # Sort by score descending, take top_n
    for item in scores:
        item["doc"] = documents[item["index"]]
    scores.sort(key=lambda x: x["score"], reverse=True)
    return scores[:top_n]


# ── Pipeline ─────────────────────────────────────────────────────────


def run_retrieval(query: str, collection_name: str) -> list[dict]:
    """Run the full retrieval pipeline: embed → search → rerank."""
    config = COLLECTIONS[collection_name]

    print(f"\n{'='*60}")
    print(f"Query: {query}")
    print(f"Collection: {collection_name}")
    print(f"{'='*60}")

    # Embed
    vector = embed_query(query)

    # Search
    db_name = config.get("db_name", "default")
    client = MilvusClient(uri=MILVUS_URI, token=MILVUS_TOKEN, db_name=db_name)
    output_fields = [config["text_field"]] + config["display_fields"]
    candidates = search_milvus(
        client,
        collection_name,
        vector,
        config["vector_field"],
        config["metric_type"],
        CANDIDATE_K,
        output_fields,
    )

    # Rerank
    reranked = rerank(query, candidates, config["text_field"], TOP_K)

    # Display results
    print(f"\n  Top {len(reranked)} results after reranking:")
    print(f"  {'-'*50}")
    for i, item in enumerate(reranked):
        doc = item["doc"]
        text_preview = doc.get(config["text_field"], "")[:100].replace("\n", " ")
        print(f"\n  [{i+1}] score={item['score']:.4f}  id={doc['id']}")
        for field in config["display_fields"]:
            val = doc.get(field, "")
            if val:
                print(f"      {field}: {val}")
        print(f"      text: {text_preview}...")

    return reranked


# ── Main ─────────────────────────────────────────────────────────────

TEST_CASES = [
    {"query": "禪修", "expect": {"books": True, "transcripts": True, "events": True}},
    {
        "query": "如何處理憤怒的情緒",
        "expect": {"books": True, "transcripts": True, "events": False},
    },
    {"query": "法鼓山義工招募", "expect": {"books": False, "transcripts": False, "events": True}},
    {"query": "心經的意義", "expect": {"books": True, "transcripts": True, "events": False}},
]

COLLECTION_SHORT = {
    "faguquanji_chunks_langchain_bge_m3": "books",
    "ddm_transcripts_bge_m3": "transcripts",
    "ddm_events_bge_m3": "events",
}


def run_test_suite():
    """Run diverse queries and check that results are relevant."""
    passed = 0
    failed = 0

    for tc in TEST_CASES:
        query = tc["query"]
        for coll_name, short in COLLECTION_SHORT.items():
            try:
                results = run_retrieval(query, coll_name)
                if results:
                    top_score = results[0]["score"]
                    status = f"PASS (top={top_score:.4f})"
                    passed += 1
                else:
                    status = (
                        "PASS (0 results, as expected)"
                        if not tc["expect"][short]
                        else "FAIL (no results)"
                    )
                    if "FAIL" in status:
                        failed += 1
                    else:
                        passed += 1
            except Exception as e:
                status = f"FAIL ({e})"
                failed += 1
            print(f"\n  {status}")

    print(f"\n{'='*60}")
    print(f"Test suite: {passed} passed, {failed} failed, {passed + failed} total")
    if failed:
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Validate retrieval pipeline")
    parser.add_argument("--query", default="禪修", help="Search query (default: 禪修)")
    parser.add_argument(
        "--collection",
        choices=list(COLLECTIONS.keys()) + ["all"],
        default="all",
        help="Collection to search (default: all)",
    )
    parser.add_argument("--test", action="store_true", help="Run test suite with diverse queries")
    args = parser.parse_args()

    if args.test:
        run_test_suite()
        return

    collections = list(COLLECTIONS.keys()) if args.collection == "all" else [args.collection]

    all_passed = True
    for coll in collections:
        try:
            results = run_retrieval(args.query, coll)
            if not results:
                print(f"\n  FAIL: No results returned for {coll}")
                all_passed = False
            else:
                print(f"\n  PASS: {len(results)} results from {coll}")
        except Exception as e:
            print(f"\n  FAIL: {coll} — {e}")
            all_passed = False

    print(f"\n{'='*60}")
    if all_passed:
        print("ALL COLLECTIONS PASSED")
    else:
        print("SOME COLLECTIONS FAILED")
        sys.exit(1)


if __name__ == "__main__":
    main()

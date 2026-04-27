"""Milvus search client — dense vector search against a collection."""

from config import MILVUS_TOKEN, MILVUS_URI
from pymilvus import MilvusClient


def search(
    collection_name: str,
    db_name: str,
    vector: list[float],
    vector_field: str,
    metric_type: str,
    output_fields: list[str],
    limit: int,
) -> list[dict]:
    """Search a Milvus collection and return hits with metadata."""
    client = MilvusClient(uri=MILVUS_URI, token=MILVUS_TOKEN, db_name=db_name)
    try:
        client.load_collection(collection_name)
    except Exception:
        pass

    results = client.search(
        collection_name=collection_name,
        data=[vector],
        anns_field=vector_field,
        limit=limit,
        output_fields=output_fields,
        search_params={"metric_type": metric_type},
    )

    hits = results[0] if results else []
    return [
        {"id": h.get("id", h.get("pk")), "distance": h["distance"], **h["entity"]} for h in hits
    ]

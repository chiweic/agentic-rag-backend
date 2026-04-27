"""Environment-based configuration for the MCP retrieval server."""

import os

MILVUS_URI = os.getenv("MILVUS_URI", "http://127.0.0.1:19530")
MILVUS_TOKEN = os.getenv("MILVUS_TOKEN", "root:Milvus")
TEI_EMBED_URL = os.getenv("TEI_EMBED_URL", "http://area51r5:8080")
TEI_RERANK_URL = os.getenv("TEI_RERANK_URL", "http://area51r5:8081/rerank")

CANDIDATE_K = 20  # candidates retrieved from Milvus before reranking
DEFAULT_TOP_K = 5  # final results after reranking

# Collection definitions
COLLECTIONS = {
    "books": {
        "collection_name": "faguquanji_chunks_langchain_bge_m3",
        "db_name": "milvus_demo",
        "vector_field": "vector",
        "metric_type": "L2",
        "text_field": "text",
        "metadata_fields": [
            "chunk_id",
            "book_id",
            "book_title_normalized",
            "chapter_id",
            "chapter_title_normalized",
            "url",
        ],
    },
    "transcripts": {
        "collection_name": "ddm_transcripts_bge_m3",
        "db_name": "default",
        "vector_field": "embedding",
        "metric_type": "IP",
        "text_field": "text",
        "metadata_fields": [
            "title",
            "speaker",
            "channel",
            "publish_date",
            "source_url",
            "media_type",
            "duration_seconds",
        ],
    },
    "events": {
        "collection_name": "ddm_events_bge_m3",
        "db_name": "default",
        "vector_field": "embedding",
        "metric_type": "IP",
        "text_field": "text",
        "metadata_fields": [
            "title",
            "category",
            "location",
            "organizer",
            "city",
            "start_date",
            "end_date",
            "event_url",
        ],
    },
}

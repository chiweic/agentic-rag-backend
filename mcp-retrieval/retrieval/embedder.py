"""TEI embedding client — embed query text into a 1024-dim vector."""

import httpx
from config import TEI_EMBED_URL


async def embed_query(query: str) -> list[float]:
    """Embed a query string via the TEI endpoint. Returns a 1024-dim float vector."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{TEI_EMBED_URL}/embed",
            json={"inputs": query, "truncate": True},
        )
        resp.raise_for_status()
        return resp.json()[0]

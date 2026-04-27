"""MCP Retrieval Server — exposes DDM domain knowledge as search tools."""

import argparse
import json

from config import DEFAULT_TOP_K
from mcp.server.fastmcp import FastMCP
from retrieval.pipeline import retrieve

mcp = FastMCP(
    "DDM Retrieval",
    instructions=(
        "Search DDM (法鼓山) domain knowledge: Buddhist books, "
        "video/audio transcripts, and event listings."
    ),
)


@mcp.tool()
async def search_books(query: str, top_k: int = DEFAULT_TOP_K) -> str:
    """Search Buddhist book content from ~120 books in the 法鼓全集 (Fagu Quanji) collection.

    Use this to find teachings, dharma talks, and written content by Master Sheng Yen (聖嚴法師)
    and other Buddhist authors. Returns ranked text chunks with book/chapter metadata.

    Args:
        query: Search query in Chinese or English.
        top_k: Number of results to return (default 5).
    """
    results = await retrieve("books", query, top_k)
    return json.dumps(results, ensure_ascii=False, indent=2)


@mcp.tool()
async def search_transcripts(query: str, top_k: int = DEFAULT_TOP_K) -> str:
    """Search DDM (法鼓山) video and audio transcripts.

    Use this to find content from dharma talks, lectures, and media recordings.
    Returns ranked transcript chunks with video title, speaker, channel, and source URL.

    Args:
        query: Search query in Chinese or English.
        top_k: Number of results to return (default 5).
    """
    results = await retrieve("transcripts", query, top_k)
    return json.dumps(results, ensure_ascii=False, indent=2)


@mcp.tool()
async def search_events(query: str, top_k: int = DEFAULT_TOP_K) -> str:
    """Search DDM (法鼓山) event listings — retreats, classes, ceremonies, and activities.

    Use this to find upcoming or past events at DDM locations.
    Returns ranked events with title, category, location, dates, and registration info.

    Args:
        query: Search query in Chinese or English.
        top_k: Number of results to return (default 5).
    """
    results = await retrieve("events", query, top_k)
    return json.dumps(results, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MCP Retrieval Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "sse"],
        default="stdio",
        help="MCP transport (default: stdio)",
    )
    parser.add_argument("--port", type=int, default=8090, help="SSE port (default: 8090)")
    args = parser.parse_args()

    if args.transport == "sse":
        mcp.settings.port = args.port
        mcp.run(transport="sse")
    else:
        mcp.run(transport="stdio")

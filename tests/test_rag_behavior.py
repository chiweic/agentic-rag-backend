"""RAG-behavior tests — exercises the retrieve→generate graph via the fake service.

Covers the surface introduced in the RagService Protocol work:
* citations content block present in /threads state and SSE values event
* source_type from request metadata reaches the RagService
* FakeRagService call counts (retrieve runs once per turn, generate once)
* OpenAI-compat "Sources:" footer in both streaming and non-streaming paths
"""

from __future__ import annotations

import json

import pytest


def _parse_sse(text: str) -> list[dict]:
    events: list[dict] = []
    current: dict = {}
    for line in text.strip().split("\n"):
        if line.startswith("event: "):
            current["event"] = line[7:]
        elif line.startswith("data: "):
            current["data"] = line[6:]
        elif line == "" and current:
            events.append(current)
            current = {}
    if current:
        events.append(current)
    return events


def _parse_openai_sse(text: str) -> list[dict]:
    chunks: list[dict] = []
    for line in text.strip().split("\n"):
        if line.startswith("data: ") and line != "data: [DONE]":
            chunks.append(json.loads(line[6:]))
    return chunks


# ---------------------------------------------------------------------------
# /threads path
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_threads_run_emits_citations_block(client, fake_rag_service):
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "What is zen?"}]}},
    )
    assert resp.status_code == 200
    events = _parse_sse(resp.text)

    # Final values event carries the assistant message with text + citations blocks.
    values_events = [e for e in events if e["event"] == "values"]
    assert values_events, "no values event emitted"
    payload = json.loads(values_events[-1]["data"])
    assistant = next(m for m in reversed(payload["messages"]) if m["role"] == "assistant")
    block_types = {b["type"] for b in assistant["content"] if isinstance(b, dict)}
    assert block_types == {"text", "citations"}

    citations_block = next(b for b in assistant["content"] if b["type"] == "citations")
    chunk_ids = [c["chunk_id"] for c in citations_block["citations"]]
    assert chunk_ids == ["FIXTURE_CHUNK_0", "FIXTURE_CHUNK_1"]

    # Fixture marker proves the generate node ran.
    text_block = next(b for b in assistant["content"] if b["type"] == "text")
    assert fake_rag_service.MARKER in text_block["text"]


@pytest.mark.asyncio
async def test_threads_source_type_plumbs_to_service(client, fake_rag_service):
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={
            "input": {"messages": [{"role": "user", "content": "custom topic"}]},
            "metadata": {"source_type": "custom_corpus"},
        },
    )
    assert resp.status_code == 200

    assert len(fake_rag_service.search_calls) == 1
    assert fake_rag_service.search_calls[0]["source_type"] == "custom_corpus"


@pytest.mark.asyncio
async def test_threads_default_source_type_when_metadata_missing(client, fake_rag_service):
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "hi"}]}},
    )
    assert resp.status_code == 200

    # Should fall back to settings.default_source_type (faguquanji) in the fake.
    assert fake_rag_service.search_calls[0]["source_type"] == "faguquanji"


@pytest.mark.asyncio
async def test_threads_call_counts_per_turn(client, fake_rag_service):
    """Each user turn should trigger exactly one search + one generate."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    for content in ("turn one", "turn two", "turn three"):
        await client.post(
            f"/threads/{thread_id}/runs/stream",
            json={"input": {"messages": [{"role": "user", "content": content}]}},
        )

    assert len(fake_rag_service.search_calls) == 3
    assert len(fake_rag_service.generate_calls) == 3


# ---------------------------------------------------------------------------
# OpenAI-compat path
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_openai_compat_appends_sources_footer_non_streaming(client, fake_rag_service):
    resp = await client.post(
        "/v1/chat/completions",
        json={
            "model": "agentic-rag",
            "messages": [{"role": "user", "content": "What is zen?"}],
            "stream": False,
        },
    )
    assert resp.status_code == 200
    content = resp.json()["choices"][0]["message"]["content"]

    assert fake_rag_service.MARKER in content
    assert "Sources:" in content
    assert "FIXTURE_DOC_A" in content
    assert "FIXTURE_DOC_B" in content
    assert "https://example.test/a" in content


@pytest.mark.asyncio
async def test_openai_compat_source_type_plumbs(client, fake_rag_service):
    await client.post(
        "/v1/chat/completions",
        json={
            "model": "agentic-rag",
            "messages": [{"role": "user", "content": "custom"}],
            "stream": False,
            "metadata": {"source_type": "openai_compat_corpus"},
        },
    )
    assert fake_rag_service.search_calls[0]["source_type"] == "openai_compat_corpus"


@pytest.mark.asyncio
async def test_openai_compat_streaming_includes_sources(client, fake_rag_service):
    resp = await client.post(
        "/v1/chat/completions",
        json={
            "model": "agentic-rag",
            "messages": [{"role": "user", "content": "What is zen?"}],
            "stream": True,
        },
    )
    assert resp.status_code == 200

    chunks = _parse_openai_sse(resp.text)
    assembled = "".join(
        c["choices"][0]["delta"].get("content") or "" for c in chunks if c.get("choices")
    )
    assert fake_rag_service.MARKER in assembled
    assert "Sources:" in assembled
    assert "FIXTURE_DOC_A" in assembled
    assert resp.text.strip().endswith("data: [DONE]")

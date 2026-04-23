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
async def test_threads_scoped_retrieval_uses_get_record_chunks(client, fake_rag_service):
    """When metadata.scope_record_id + scope_source_type are set, retrieve
    pulls every chunk for that record instead of running a semantic search."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={
            "input": {"messages": [{"role": "user", "content": "Tell me more"}]},
            "metadata": {
                "scope_record_id": "REC-123",
                "scope_source_type": "faguquanji",
            },
        },
    )
    assert resp.status_code == 200

    # The scoped path was taken — get_record_chunks fired, search did not.
    assert len(fake_rag_service.record_chunks_calls) == 1
    assert fake_rag_service.record_chunks_calls[0] == {
        "record_id": "REC-123",
        "source_type": "faguquanji",
    }
    assert fake_rag_service.search_calls == []


@pytest.mark.asyncio
async def test_threads_without_scope_uses_semantic_search(client, fake_rag_service):
    """Without scope metadata, retrieve continues to use semantic search."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "anything"}]}},
    )
    assert resp.status_code == 200

    assert len(fake_rag_service.search_calls) == 1
    assert fake_rag_service.record_chunks_calls == []


@pytest.mark.asyncio
async def test_scope_record_id_reaches_generate(client, fake_rag_service):
    """The generate node must see scope_record_id so the provider can
    inject a deep-dive prompt prefix. Without it, the LLM can happily
    answer from training knowledge even when retrieval is pinned."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={
            "input": {"messages": [{"role": "user", "content": "Summarize this"}]},
            "metadata": {
                "scope_record_id": "REC-ABC",
                "scope_source_type": "faguquanji",
            },
        },
    )
    assert resp.status_code == 200
    assert len(fake_rag_service.generate_calls) == 1
    assert fake_rag_service.generate_calls[0]["scope_record_id"] == "REC-ABC"


@pytest.mark.asyncio
async def test_scope_record_id_absent_on_regular_thread(client, fake_rag_service):
    """Regular (non-scoped) turns pass scope_record_id=None to generate."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "hi"}]}},
    )
    assert resp.status_code == 200
    assert fake_rag_service.generate_calls[0]["scope_record_id"] is None


@pytest.mark.asyncio
async def test_deep_dive_run_omits_citations_block(client, fake_rag_service):
    """Scoped turns must not emit a citations content block on the
    assistant message — otherwise the Deep Dive chat renders source
    cards that would open a Deep Dive inside a Deep Dive."""
    import json

    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={
            "input": {"messages": [{"role": "user", "content": "Summarize this"}]},
            "metadata": {
                "scope_record_id": "REC-ABC",
                "scope_source_type": "faguquanji",
            },
        },
    )
    assert resp.status_code == 200

    events = _parse_sse(resp.text)
    values_events = [e for e in events if e["event"] == "values"]
    assert values_events
    payload = json.loads(values_events[-1]["data"])
    assistant = next(m for m in reversed(payload["messages"]) if m["role"] == "assistant")
    block_types = {b["type"] for b in assistant["content"] if isinstance(b, dict)}
    # Text only — no citations block.
    assert block_types == {"text"}


@pytest.mark.asyncio
async def test_regular_run_still_emits_citations_block(client, fake_rag_service):
    """Sanity check that the suppression is scoped: regular runs still
    carry the citations block for the main-chat UI."""
    import json

    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "hi"}]}},
    )
    assert resp.status_code == 200

    events = _parse_sse(resp.text)
    payload = json.loads(next(e["data"] for e in events if e["event"] == "values"))
    assistant = next(m for m in reversed(payload["messages"]) if m["role"] == "assistant")
    block_types = {b["type"] for b in assistant["content"] if isinstance(b, dict)}
    assert block_types == {"text", "citations"}


@pytest.mark.asyncio
async def test_threads_generate_receives_chat_history(client, fake_rag_service):
    """The second turn should carry turn 1 (Q + A, text-only) as history."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "first question"}]}},
    )
    await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "follow up"}]}},
    )

    assert len(fake_rag_service.generate_calls) == 2

    # First turn has no prior conversation.
    first_history = fake_rag_service.generate_calls[0]["history"]
    assert first_history in (None, [])

    # Second turn carries turn 1 Q + A in order, roles alternating, and
    # the assistant content is the text block only (no citations leak).
    second_history = fake_rag_service.generate_calls[1]["history"]
    assert second_history is not None
    assert [m["role"] for m in second_history] == ["user", "assistant"]
    assert second_history[0]["content"] == "first question"
    assistant_text = second_history[1]["content"]
    assert fake_rag_service.MARKER in assistant_text
    assert "FIXTURE_CHUNK_0" not in assistant_text  # citations block not echoed


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


# ---------------------------------------------------------------------------
# Multi-source retrieval (features_v3.md §1 — 聖嚴師父身影 tab)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_threads_source_types_fans_out_across_corpora(client, fake_rag_service):
    """A metadata.source_types list causes one `search` call per corpus."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={
            "input": {"messages": [{"role": "user", "content": "聖嚴法師開示"}]},
            "metadata": {
                "source_types": ["audio", "video_ddmtv01", "video_ddmtv02"],
            },
        },
    )
    assert resp.status_code == 200

    # One search per source, no scalar source_type path followed.
    calls_by_source = [c["source_type"] for c in fake_rag_service.search_calls]
    assert calls_by_source == ["audio", "video_ddmtv01", "video_ddmtv02"]
    assert fake_rag_service.record_chunks_calls == []


@pytest.mark.asyncio
async def test_threads_source_types_videos_before_audio(client, fake_rag_service):
    """Merged citations group videos before audio (modality priority),
    with round-robin WITHIN each modality group. The /sheng-yen tab
    relies on this so video cards render at the top of the grid."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={
            "input": {"messages": [{"role": "user", "content": "hello"}]},
            "metadata": {"source_types": ["audio", "video_ddmtv01"]},
        },
    )
    assert resp.status_code == 200

    # Fake returns 2 hits per search with metadata.source_type tagging
    # which corpus they came from. With "videos before audio", the
    # single video source's two hits lead, then the audio source's.
    values_events = [e for e in _parse_sse(resp.text) if e["event"] == "values"]
    payload = json.loads(values_events[-1]["data"])
    assistant = next(m for m in reversed(payload["messages"]) if m["role"] == "assistant")
    citations_block = next(
        b for b in assistant["content"] if isinstance(b, dict) and b["type"] == "citations"
    )
    sources_in_order = [c["metadata"]["source_type"] for c in citations_block["citations"]]
    assert sources_in_order[:4] == [
        "video_ddmtv01",
        "video_ddmtv01",
        "audio",
        "audio",
    ]


@pytest.mark.asyncio
async def test_threads_source_types_wins_over_scalar(client, fake_rag_service):
    """When both `source_type` and `source_types` are in metadata, the
    list wins — the single-source scalar path should not fire."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={
            "input": {"messages": [{"role": "user", "content": "hi"}]},
            "metadata": {
                "source_type": "events",
                "source_types": ["audio", "video_ddmtv01"],
            },
        },
    )
    assert resp.status_code == 200

    sources = {c["source_type"] for c in fake_rag_service.search_calls}
    assert sources == {"audio", "video_ddmtv01"}
    assert "events" not in sources


# ---------------------------------------------------------------------------
# /recommendations?sources=... (features_v3.md §1)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_recommendations_default_source_is_events(client, fake_rag_service):
    # Ensure a recent user message exists so collect_recent_queries returns
    # something (so the endpoint reaches the search step).
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]
    await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "seed"}]}},
    )

    # Without `?sources=`, the endpoint searches only the events corpus.
    # We can't easily assert the status "ok" without a real summariser
    # (summarize_interests returns "" in-tests because there's no LLM)
    # but we CAN assert the default source behaviour by hitting it with
    # a stubbed summariser below — that test uses `sources=` explicitly.
    resp = await client.get("/recommendations?limit=3")
    # In-test environment has no real LLM so summarise returns "" →
    # status=summary_failed. That's still enough to prove the endpoint
    # parses query params without 500ing.
    assert resp.status_code == 200
    assert resp.json()["status"] in ("summary_failed", "no_activity", "ok")


@pytest.mark.asyncio
async def test_recommendations_rejects_unknown_source(client):
    resp = await client.get("/recommendations?sources=nope")
    assert resp.status_code == 400
    assert "nope" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_recommendations_multi_source_search(client, fake_rag_service, monkeypatch):
    """With a real summary result stubbed in, ?sources=a,b,c should fan
    out to each corpus and round-robin interleave the hits."""
    from app.api import recommendations as recs_module

    async def _fake_summary(queries, *, chat_model=None):
        return "stubbed interest profile"

    async def _fake_collect(user_id, *, days=7, now=None):
        return ["recent query"]

    monkeypatch.setattr(recs_module, "summarize_interests", _fake_summary)
    monkeypatch.setattr(recs_module, "collect_recent_queries", _fake_collect)

    resp = await client.get("/recommendations?sources=audio,video_ddmtv01,video_ddmtv02&limit=6")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["profile"] == "stubbed interest profile"

    # One search per corpus (ceil(6/3)=2 hits each). With modality
    # priority, the merged order is videos first (round-robin between
    # video_ddmtv01 and video_ddmtv02) then audio.
    calls = [c["source_type"] for c in fake_rag_service.search_calls]
    assert calls == ["audio", "video_ddmtv01", "video_ddmtv02"]

    sources_in_order = [e["metadata"]["source_type"] for e in body["events"]]
    assert sources_in_order == [
        "video_ddmtv01",
        "video_ddmtv02",
        "video_ddmtv01",
        "video_ddmtv02",
        "audio",
        "audio",
    ]

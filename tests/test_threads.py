import pytest


@pytest.mark.asyncio
async def test_create_thread(client):
    resp = await client.post("/threads", json={})
    assert resp.status_code == 200
    data = resp.json()
    assert "thread_id" in data
    assert len(data["thread_id"]) > 0


@pytest.mark.asyncio
async def test_create_thread_with_metadata(client):
    resp = await client.post("/threads", json={"metadata": {"user": "alice"}})
    assert resp.status_code == 200
    data = resp.json()
    assert data["metadata"] == {"user": "alice"}


@pytest.mark.asyncio
async def test_get_empty_thread_state(client):
    # Create thread
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    # Get state — should be empty
    resp = await client.get(f"/threads/{thread_id}/state")
    assert resp.status_code == 200
    data = resp.json()
    assert data["thread_id"] == thread_id
    assert data["messages"] == []


@pytest.mark.asyncio
async def test_run_stream_and_state(client):
    """Send a message via streaming, then verify state has both messages."""
    # Create thread
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    # Stream a message
    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={
            "input": {"messages": [{"role": "user", "content": "Say hello briefly"}]},
            "stream_mode": ["messages", "updates"],
        },
    )
    assert resp.status_code == 200

    # Parse SSE events
    events = _parse_sse(resp.text)
    event_types = [e["event"] for e in events]

    assert "messages/complete" in event_types
    assert "values" in event_types
    assert "end" in event_types

    # Verify state persisted
    resp = await client.get(f"/threads/{thread_id}/state")
    data = resp.json()
    messages = data["messages"]
    assert len(messages) >= 2
    assert messages[0]["role"] == "user"
    assert messages[-1]["role"] == "assistant"


@pytest.mark.asyncio
async def test_thread_conversation_memory(client):
    """Verify follow-up messages have access to prior conversation."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    # First message
    await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "My name is Bob."}]}},
    )

    # Second message
    await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "What is my name?"}]}},
    )

    # Should have 4 messages total
    resp = await client.get(f"/threads/{thread_id}/state")
    messages = resp.json()["messages"]
    assert len(messages) == 4


@pytest.mark.asyncio
async def test_patch_thread_rename(client):
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.patch(f"/threads/{thread_id}", json={"title": "My chat"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "My chat"

    # Verify it persists on subsequent reads
    resp = await client.get("/threads")
    listed = {t["thread_id"]: t for t in resp.json()}
    assert listed[thread_id]["title"] == "My chat"


@pytest.mark.asyncio
async def test_patch_thread_archive(client):
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.patch(f"/threads/{thread_id}", json={"is_archived": True})
    assert resp.status_code == 200
    assert resp.json()["is_archived"] is True

    # Archived threads should be filtered out of default list
    resp = await client.get("/threads")
    ids = [t["thread_id"] for t in resp.json()]
    assert thread_id not in ids


@pytest.mark.asyncio
async def test_patch_nonexistent_thread_returns_404(client):
    resp = await client.patch("/threads/does-not-exist", json={"title": "x"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_thread_removes_metadata_and_state(client):
    """After delete, state and run endpoints must reject the thread_id."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    # Add some conversation state
    await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "hello"}]}},
    )

    # Delete
    resp = await client.delete(f"/threads/{thread_id}")
    assert resp.status_code == 200

    # Thread must no longer be accessible via state endpoint
    resp = await client.get(f"/threads/{thread_id}/state")
    assert resp.status_code == 404

    # Thread must not be resumable via run stream
    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "still there?"}]}},
    )
    assert resp.status_code == 404

    # Thread must be gone from list
    resp = await client.get("/threads")
    ids = [t["thread_id"] for t in resp.json()]
    assert thread_id not in ids


@pytest.mark.asyncio
async def test_state_for_unknown_thread_returns_404(client):
    resp = await client.get("/threads/unknown-id/state")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_run_stream_for_unknown_thread_returns_404(client):
    resp = await client.post(
        "/threads/unknown-id/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "hi"}]}},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_threads_title_fallback(client):
    """Unnamed threads should fall back to first user message as title."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "What is gravity?"}]}},
    )

    resp = await client.get("/threads")
    listed = {t["thread_id"]: t for t in resp.json()}
    assert listed[thread_id]["title"] == "What is gravity?"


# ---------------------------------------------------------------------------
# SSE shape stability — these pin the contract the frontend consumes.
# Any change here is a contract change that must be coordinated with frontend.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_sse_event_sequence_and_shape(client):
    """Pin the SSE event names, order, and payload shape."""
    import json

    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "Say ok"}]}},
    )
    assert resp.status_code == 200

    events = _parse_sse(resp.text)
    event_names = [e["event"] for e in events]

    # Event names and ordering (no error in happy path)
    assert "messages/partial" in event_names
    assert "messages/complete" in event_names
    assert "values" in event_names
    assert event_names[-1] == "end"
    assert "error" not in event_names

    # messages/partial payload shape
    partial = json.loads(next(e["data"] for e in events if e["event"] == "messages/partial"))
    assert set(partial.keys()) == {"id", "role", "content"}
    assert partial["role"] == "assistant"
    assert isinstance(partial["content"], list)
    assert partial["content"][0]["type"] == "text"
    assert isinstance(partial["content"][0]["text"], str)

    # messages/complete payload shape
    complete = json.loads(next(e["data"] for e in events if e["event"] == "messages/complete"))
    assert set(complete.keys()) == {"id", "role", "content"}
    assert complete["role"] == "assistant"
    assert complete["content"][0]["type"] == "text"

    # values payload shape (normalized, matches /state)
    values = json.loads(next(e["data"] for e in events if e["event"] == "values"))
    assert set(values.keys()) == {"thread_id", "messages"}
    assert values["thread_id"] == thread_id
    assert len(values["messages"]) >= 2
    for msg in values["messages"]:
        assert set(msg.keys()) >= {"id", "role", "content"}
        assert msg["role"] in {"user", "assistant", "system", "tool"}
        assert isinstance(msg["content"], list)

    # end payload
    end_event = next(e for e in events if e["event"] == "end")
    assert end_event["data"] == "null"


@pytest.mark.asyncio
async def test_state_response_shape(client):
    """Pin the GET /threads/{id}/state response shape."""
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "hi"}]}},
    )

    resp = await client.get(f"/threads/{thread_id}/state")
    data = resp.json()

    assert set(data.keys()) == {"thread_id", "messages"}
    assert data["thread_id"] == thread_id
    assert len(data["messages"]) >= 2

    for msg in data["messages"]:
        assert set(msg.keys()) >= {"id", "role", "content"}
        assert msg["role"] in {"user", "assistant", "system", "tool"}
        assert isinstance(msg["content"], list)
        for part in msg["content"]:
            assert part["type"] == "text"
            assert isinstance(part["text"], str)


@pytest.mark.asyncio
async def test_run_input_messages_are_appended_not_replaced(client):
    """Critical contract: input.messages is APPENDED to checkpointer state.

    The frontend must send ONLY the new user message, not full history.
    Sending history would duplicate messages. This test pins that behavior.
    """
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    # First send
    await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "first"}]}},
    )

    # Second send — frontend sends only the new message
    await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "second"}]}},
    )

    # State must contain both exchanges, exactly once each
    resp = await client.get(f"/threads/{thread_id}/state")
    messages = resp.json()["messages"]
    assert len(messages) == 4
    assert messages[0]["role"] == "user"
    assert messages[0]["content"][0]["text"] == "first"
    assert messages[2]["role"] == "user"
    assert messages[2]["content"][0]["text"] == "second"


@pytest.mark.asyncio
async def test_run_emits_error_event_on_failure(client, monkeypatch):
    """When the agent raises mid-stream, an `error` event must be emitted
    before `end`, and the connection must close cleanly."""
    import json

    from app.agent import graph as agent_module

    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    # Patch astream_events to raise after yielding once
    original = agent_module.agent_graph.astream_events

    async def failing_stream(*args, **kwargs):
        raise RuntimeError("simulated LLM failure")
        yield  # pragma: no cover

    monkeypatch.setattr(agent_module.agent_graph, "astream_events", failing_stream)

    try:
        resp = await client.post(
            f"/threads/{thread_id}/runs/stream",
            json={"input": {"messages": [{"role": "user", "content": "boom"}]}},
        )
        assert resp.status_code == 200

        events = _parse_sse(resp.text)
        names = [e["event"] for e in events]

        assert "error" in names
        assert names[-1] == "end"

        error_event = next(e for e in events if e["event"] == "error")
        payload = json.loads(error_event["data"])
        assert "message" in payload
        assert "simulated LLM failure" in payload["message"]
    finally:
        monkeypatch.setattr(agent_module.agent_graph, "astream_events", original)


@pytest.mark.asyncio
async def test_integration_full_conversation_cycle(client):
    """End-to-end: create → first run → state → second run → state.

    Validates the normalized shape at every step of the frontend journey.
    """
    # Create
    resp = await client.post("/threads", json={})
    assert resp.status_code == 200
    thread_id = resp.json()["thread_id"]

    # Empty state after creation
    resp = await client.get(f"/threads/{thread_id}/state")
    assert resp.json() == {"thread_id": thread_id, "messages": []}

    # First run
    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "hello"}]}},
    )
    assert resp.status_code == 200
    assert "event: messages/complete" in resp.text
    assert "event: values" in resp.text
    assert "event: end" in resp.text

    # State after first run
    resp = await client.get(f"/threads/{thread_id}/state")
    data = resp.json()
    assert data["thread_id"] == thread_id
    assert len(data["messages"]) == 2
    assert data["messages"][0]["role"] == "user"
    assert data["messages"][0]["content"][0]["text"] == "hello"
    assert data["messages"][1]["role"] == "assistant"

    # Second run (new message only)
    resp = await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "and again"}]}},
    )
    assert resp.status_code == 200

    # State after second run
    resp = await client.get(f"/threads/{thread_id}/state")
    data = resp.json()
    assert len(data["messages"]) == 4
    assert [m["role"] for m in data["messages"]] == ["user", "assistant", "user", "assistant"]
    assert data["messages"][2]["content"][0]["text"] == "and again"


def _parse_sse(text: str) -> list[dict]:
    """Parse SSE text into list of {event, data} dicts."""
    events = []
    current = {}
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

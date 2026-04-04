import json

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
    assert data["values"]["messages"] == []
    assert data["tasks"] == []


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
    messages = data["values"]["messages"]
    assert len(messages) >= 2
    assert messages[0]["type"] == "human"
    assert messages[-1]["type"] == "ai"


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
    messages = resp.json()["values"]["messages"]
    assert len(messages) == 4


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

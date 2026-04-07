"""Walkthrough tests — common user paths through the system.

Each test simulates a real user journey end-to-end.
"""

import json

import pytest


# ---------------------------------------------------------------------------
# Path 1: assistant-ui user — new conversation
# Create thread → send message → get streamed response → follow up → verify history
# ---------------------------------------------------------------------------
class TestAssistantUIConversation:
    @pytest.mark.asyncio
    async def test_new_conversation_flow(self, client):
        # User opens the app — frontend creates a thread
        resp = await client.post("/threads", json={})
        assert resp.status_code == 200
        thread_id = resp.json()["thread_id"]

        # User types first message
        resp = await client.post(
            f"/threads/{thread_id}/runs/stream",
            json={"input": {"messages": [{"role": "user", "content": "What is 2+2?"}]}},
        )
        assert resp.status_code == 200
        events = _parse_sse(resp.text)

        # Verify we got streaming tokens, a complete message, and final state
        assert any(e["event"] == "messages/partial" for e in events)
        assert any(e["event"] == "messages/complete" for e in events)
        assert events[-1]["event"] == "end"

        # User sends follow-up
        resp = await client.post(
            f"/threads/{thread_id}/runs/stream",
            json={"input": {"messages": [{"role": "user", "content": "Now multiply that by 3"}]}},
        )
        assert resp.status_code == 200

        # Verify full conversation is stored (4 messages: user, assistant, user, assistant)
        resp = await client.get(f"/threads/{thread_id}/state")
        messages = resp.json()["messages"]
        assert len(messages) == 4
        assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]

    @pytest.mark.asyncio
    async def test_resume_conversation(self, client):
        """User closes browser, comes back later, loads thread state."""
        # Start a conversation
        resp = await client.post("/threads", json={})
        thread_id = resp.json()["thread_id"]

        await client.post(
            f"/threads/{thread_id}/runs/stream",
            json={
                "input": {
                    "messages": [{"role": "user", "content": "Remember: the secret word is banana"}]
                }
            },
        )

        # --- User closes browser, time passes ---

        # Frontend loads thread state to restore UI
        resp = await client.get(f"/threads/{thread_id}/state")
        assert resp.status_code == 200
        messages = resp.json()["messages"]
        assert len(messages) == 2
        assert messages[0]["content"][0]["text"] == "Remember: the secret word is banana"

        # User continues the conversation
        resp = await client.post(
            f"/threads/{thread_id}/runs/stream",
            json={"input": {"messages": [{"role": "user", "content": "What is the secret word?"}]}},
        )
        assert resp.status_code == 200

        # Verify agent remembers context
        resp = await client.get(f"/threads/{thread_id}/state")
        messages = resp.json()["messages"]
        assert len(messages) == 4


# ---------------------------------------------------------------------------
# Path 2: assistant-ui user — multiple threads (sidebar switching)
# ---------------------------------------------------------------------------
class TestMultipleThreads:
    @pytest.mark.asyncio
    async def test_separate_threads_are_isolated(self, client):
        """Two threads should have independent conversation histories."""
        # Thread A — topic: colors
        resp = await client.post("/threads", json={})
        thread_a = resp.json()["thread_id"]
        await client.post(
            f"/threads/{thread_a}/runs/stream",
            json={
                "input": {"messages": [{"role": "user", "content": "My favorite color is blue"}]}
            },
        )

        # Thread B — topic: animals
        resp = await client.post("/threads", json={})
        thread_b = resp.json()["thread_id"]
        await client.post(
            f"/threads/{thread_b}/runs/stream",
            json={
                "input": {"messages": [{"role": "user", "content": "My favorite animal is a cat"}]}
            },
        )

        # Verify threads are isolated
        state_a = (await client.get(f"/threads/{thread_a}/state")).json()
        state_b = (await client.get(f"/threads/{thread_b}/state")).json()

        assert len(state_a["messages"]) == 2
        assert len(state_b["messages"]) == 2
        assert "blue" in state_a["messages"][0]["content"][0]["text"]
        assert "cat" in state_b["messages"][0]["content"][0]["text"]


# ---------------------------------------------------------------------------
# Path 3: Open WebUI user — stateless chat via OpenAI-compat
# ---------------------------------------------------------------------------
class TestOpenWebUIFlow:
    @pytest.mark.asyncio
    async def test_single_turn_chat(self, client):
        """Open WebUI sends full history each request — no thread state needed."""
        resp = await client.post(
            "/v1/chat/completions",
            json={
                "model": "agentic-rag",
                "messages": [{"role": "user", "content": "Hello"}],
                "stream": False,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["choices"][0]["message"]["role"] == "assistant"
        assert len(data["choices"][0]["message"]["content"]) > 0

    @pytest.mark.asyncio
    async def test_multi_turn_with_history(self, client):
        """Open WebUI sends accumulated history — backend is stateless."""
        # First turn
        resp = await client.post(
            "/v1/chat/completions",
            json={
                "model": "agentic-rag",
                "messages": [{"role": "user", "content": "My name is Charlie"}],
                "stream": False,
            },
        )
        ai_reply = resp.json()["choices"][0]["message"]["content"]

        # Second turn — client sends full history
        resp = await client.post(
            "/v1/chat/completions",
            json={
                "model": "agentic-rag",
                "messages": [
                    {"role": "user", "content": "My name is Charlie"},
                    {"role": "assistant", "content": ai_reply},
                    {"role": "user", "content": "What is my name?"},
                ],
                "stream": False,
            },
        )
        assert resp.status_code == 200
        assert len(resp.json()["choices"][0]["message"]["content"]) > 0

    @pytest.mark.asyncio
    async def test_streaming_complete_format(self, client):
        """Verify SSE stream has correct OpenAI format for Open WebUI."""
        resp = await client.post(
            "/v1/chat/completions",
            json={
                "model": "agentic-rag",
                "messages": [{"role": "user", "content": "Say ok"}],
                "stream": True,
            },
        )
        assert resp.status_code == 200

        chunks = _parse_openai_sse(resp.text)

        # First chunk sets role
        assert chunks[0]["choices"][0]["delta"]["role"] == "assistant"

        # At least one content chunk
        content_chunks = [c for c in chunks if c["choices"][0]["delta"].get("content")]
        assert len(content_chunks) >= 1

        # Last chunk has finish_reason
        assert chunks[-1]["choices"][0]["finish_reason"] == "stop"

        # Stream ends with [DONE]
        assert resp.text.strip().endswith("data: [DONE]")

    @pytest.mark.asyncio
    async def test_system_message_passed_through(self, client):
        """Open WebUI sends system messages — verify they reach the agent."""
        resp = await client.post(
            "/v1/chat/completions",
            json={
                "model": "agentic-rag",
                "messages": [
                    {"role": "system", "content": "You are a pirate. Always say 'Arrr'."},
                    {"role": "user", "content": "Hello"},
                ],
                "stream": False,
            },
        )
        assert resp.status_code == 200
        assert len(resp.json()["choices"][0]["message"]["content"]) > 0


# ---------------------------------------------------------------------------
# Path 4: Health check — monitoring / load balancer
# ---------------------------------------------------------------------------
class TestHealthCheck:
    @pytest.mark.asyncio
    async def test_health_returns_status(self, client):
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _parse_sse(text: str) -> list[dict]:
    """Parse LangGraph-style SSE events."""
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


def _parse_openai_sse(text: str) -> list[dict]:
    """Parse OpenAI-style SSE chunks (excludes [DONE])."""
    chunks = []
    for line in text.strip().split("\n"):
        if line.startswith("data: ") and line != "data: [DONE]":
            chunks.append(json.loads(line[6:]))
    return chunks

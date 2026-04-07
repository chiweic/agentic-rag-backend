import json

import pytest


@pytest.mark.asyncio
async def test_list_models(client):
    resp = await client.get("/v1/models")
    assert resp.status_code == 200
    data = resp.json()
    assert data["object"] == "list"
    assert len(data["data"]) >= 1
    assert data["data"][0]["id"] == "agentic-rag"


@pytest.mark.asyncio
async def test_chat_completions_non_streaming(client):
    resp = await client.post(
        "/v1/chat/completions",
        json={
            "model": "agentic-rag",
            "messages": [{"role": "user", "content": "Say hi briefly"}],
            "stream": False,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["object"] == "chat.completion"
    assert len(data["choices"]) == 1
    assert data["choices"][0]["message"]["role"] == "assistant"
    assert len(data["choices"][0]["message"]["content"]) > 0
    assert data["choices"][0]["finish_reason"] == "stop"


@pytest.mark.asyncio
async def test_chat_completions_streaming(client):
    resp = await client.post(
        "/v1/chat/completions",
        json={
            "model": "agentic-rag",
            "messages": [{"role": "user", "content": "Say hi briefly"}],
            "stream": True,
        },
    )
    assert resp.status_code == 200

    # Parse SSE chunks
    chunks = []
    for line in resp.text.strip().split("\n"):
        if line.startswith("data: ") and line != "data: [DONE]":
            chunks.append(json.loads(line[6:]))

    assert len(chunks) >= 2  # at least role chunk + content chunk
    # First chunk has role
    assert chunks[0]["choices"][0]["delta"]["role"] == "assistant"
    # Last real chunk has finish_reason
    last_data_line = [
        line
        for line in resp.text.strip().split("\n")
        if line.startswith("data: ") and line != "data: [DONE]"
    ][-1]
    last_chunk = json.loads(last_data_line[6:])
    assert last_chunk["choices"][0]["finish_reason"] == "stop"
    # Ends with [DONE]
    assert resp.text.strip().endswith("data: [DONE]")

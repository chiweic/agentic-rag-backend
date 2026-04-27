"""End-to-end demo against the Changpt backend API.

Usage:
    export CLIENT_ID=...        # from your partner onboarding
    export CLIENT_SECRET=...
    python demo.py

What it does:
    1. Health check (no auth)
    2. Create a thread
    3. Stream one user turn, print assistant text as it arrives
    4. Print follow-up suggestions if any
    5. List recent threads
    6. Clean up (delete the demo thread)
"""

from __future__ import annotations

from client import BackendClient


def main() -> None:
    c = BackendClient.from_env()

    print("1. Health:", c.health())

    thread = c.create_thread(metadata={"kind": "partner_demo"})
    thread_id = thread["thread_id"]
    print(f"2. Created thread: {thread_id}")

    user_message = "請用一兩句話介紹法鼓山。"
    print(f"3. Streaming turn for: {user_message!r}\n")

    assistant_text = ""
    citations: list[dict] = []
    suggestions: list[dict] = []
    for event, data in c.stream_run(thread_id, user_message):
        if event == "messages/partial":
            # `data.content` is the full running message; re-render each tick.
            new_text = _extract_text(data)
            # Print only the newly appended tail for a token-stream feel.
            if new_text.startswith(assistant_text):
                delta = new_text[len(assistant_text) :]
                print(delta, end="", flush=True)
            else:
                print(new_text, end="", flush=True)
            assistant_text = new_text
        elif event == "messages/complete":
            assistant_text = _extract_text(data)
        elif event == "values":
            # Full thread state after settle — last assistant message carries
            # the citations block (messages/complete is text-only).
            msgs = data.get("messages") or []
            for m in reversed(msgs):
                if m.get("role") == "assistant":
                    citations = _extract_citations(m)
                    break
        elif event == "suggestions/final":
            suggestions = data.get("suggestions", [])
        elif event == "error":
            print(f"\n!! error event: {data}")
        elif event == "end":
            print("\n[stream end]")
            break

    if citations:
        print(f"\n4. Citations ({len(citations)}):")
        for i, ci in enumerate(citations, 1):
            title = ci.get("title") or "(untitled)"
            src = (ci.get("metadata") or {}).get("source_type") or "?"
            url = ci.get("source_url") or ""
            score = ci.get("score")
            score_str = f" score={score:.3f}" if isinstance(score, (int, float)) else ""
            print(f"   [{i}] ({src}) {title}{score_str}")
            if url:
                print(f"       {url}")

    if suggestions:
        print("\n5. Follow-up suggestions:")
        for s in suggestions:
            print(f"   - {s.get('text')}")

    print("\n6. Recent threads:")
    for t in c.list_threads()[:5]:
        print(f"   - {t['thread_id']}  title={t.get('title')!r}")

    print(f"\n7. Deleting demo thread {thread_id} ...")
    c.delete_thread(thread_id)
    print("   ok")


def _extract_text(message: dict) -> str:
    """Pull the concatenated text out of a normalized message's content array."""
    parts = message.get("content") or []
    return "".join(p.get("text", "") for p in parts if p.get("type") == "text")


def _extract_citations(message: dict) -> list[dict]:
    """Pull retrieved citations out of a normalized assistant message."""
    parts = message.get("content") or []
    for p in parts:
        if p.get("type") == "citations":
            return p.get("citations") or []
    return []


if __name__ == "__main__":
    main()

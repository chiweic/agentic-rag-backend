"""Non-streaming demo — one turn, block until settled, print final answer + citations.

Same prerequisites as demo.py:
    export CLIENT_ID=...
    export CLIENT_SECRET=...
    python demo_blocking.py
"""

from __future__ import annotations

from client import BackendClient


def main() -> None:
    c = BackendClient.from_env()

    thread = c.create_thread(metadata={"kind": "partner_blocking_demo"})
    thread_id = thread["thread_id"]
    print(f"Thread: {thread_id}\n")

    result = c.run_turn(thread_id, "請用一兩句話介紹法鼓山。")

    print("=== Final answer ===")
    print(result["text"])

    print(f"\n=== Citations ({len(result['citations'])}) ===")
    for i, ci in enumerate(result["citations"], 1):
        src = (ci.get("metadata") or {}).get("source_type") or "?"
        title = ci.get("title") or "(untitled)"
        score = ci.get("score")
        print(f"[{i}] ({src}) {title}  score={score}")
        if ci.get("source_url"):
            print(f"    {ci['source_url']}")

    print(f"\n=== Follow-ups ({len(result['suggestions'])}) ===")
    for s in result["suggestions"]:
        print(f"- {s.get('text')}")

    # Full dict dump if you want to pipe into jq:
    # print(json.dumps(result, ensure_ascii=False, indent=2))

    c.delete_thread(thread_id)
    print(f"\nDeleted {thread_id}")


if __name__ == "__main__":
    main()

"""OpenAI-SDK demo against the /v1/chat/completions compat endpoint.

The backend exposes an OpenAI-compatible surface for clients that already
speak that protocol (Open WebUI, LangChain OpenAI wrapper, etc.).
Citations are flattened into a `Sources:` footer inside the assistant
text — if you need them as structured data, use /threads instead.

Prerequisites:
    pip install -r requirements.txt
    export CLIENT_ID=...
    export CLIENT_SECRET=...
    python demo_openai_compat.py
"""

from __future__ import annotations

import os

import requests
from openai import OpenAI

BASE_URL = "https://app.changpt.org/api/v1"
TOKEN_URL = "https://auth.changpt.org/oidc/token"
AUDIENCE = "https://api.myapp.local"


def fetch_access_token() -> str:
    """One-shot token fetch. For long-running code use BackendClient (client.py)
    which caches and auto-refreshes."""
    r = requests.post(
        TOKEN_URL,
        auth=(os.environ["CLIENT_ID"], os.environ["CLIENT_SECRET"]),
        data={
            "grant_type": "client_credentials",
            "resource": AUDIENCE,
            "scope": "all",
        },
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def main() -> None:
    token = fetch_access_token()

    # OpenAI SDK sends `api_key` as `Authorization: Bearer <value>` — feed
    # the M2M access token in directly.
    #
    # User-Agent override: Cloudflare (our public ingress) blocks the
    # default `OpenAI/Python x.y` UA as a bot. Send something generic.
    client = OpenAI(
        base_url=BASE_URL,
        api_key=token,
        default_headers={"User-Agent": "partner-demo/1.0"},
    )

    print("=== non-streaming ===")
    resp = client.chat.completions.create(
        model="agentic-rag",
        messages=[{"role": "user", "content": "請用一兩句話介紹法鼓山。"}],
    )
    print(resp.choices[0].message.content)

    print("\n=== streaming ===")
    stream = client.chat.completions.create(
        model="agentic-rag",
        messages=[{"role": "user", "content": "再用一句話說明。"}],
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            print(delta, end="", flush=True)
    print()


if __name__ == "__main__":
    main()

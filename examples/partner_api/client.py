"""Minimal partner-facing client for the Changpt backend API.

Handles:
- OAuth2 client_credentials token fetch against Logto
- In-memory token cache, refresh 60 s before expiry
- One automatic retry on 401 (covers clock skew / early-rotated tokens)
- SSE parsing for the streaming run endpoint

Drop this file into your project and do:

    from client import BackendClient
    c = BackendClient.from_env()
    thread = c.create_thread()
    for event, data in c.stream_run(thread["thread_id"], "hello"):
        print(event, data)
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any, Iterator

import requests

DEFAULT_API_BASE = "https://app.changpt.org/api"
DEFAULT_TOKEN_URL = "https://auth.changpt.org/oidc/token"
DEFAULT_AUDIENCE = "https://api.myapp.local"
DEFAULT_SCOPE = "all"

# Refresh this many seconds before the token actually expires, so an
# in-flight call doesn't 401 right as the TTL crosses zero.
_REFRESH_LEAD_SECONDS = 60


@dataclass
class CachedToken:
    access_token: str
    expires_at: float  # epoch seconds

    def is_fresh(self) -> bool:
        return time.time() < self.expires_at - _REFRESH_LEAD_SECONDS


class BackendClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        *,
        api_base: str = DEFAULT_API_BASE,
        token_url: str = DEFAULT_TOKEN_URL,
        audience: str = DEFAULT_AUDIENCE,
        scope: str = DEFAULT_SCOPE,
        timeout: float = 30.0,
    ):
        self._client_id = client_id
        self._client_secret = client_secret
        self._api_base = api_base.rstrip("/")
        self._token_url = token_url
        self._audience = audience
        self._scope = scope
        self._timeout = timeout
        self._session = requests.Session()
        self._cached: CachedToken | None = None

    @classmethod
    def from_env(cls) -> "BackendClient":
        client_id = os.environ.get("CLIENT_ID") or os.environ.get("LOGTO_CLIENT_ID")
        client_secret = os.environ.get("CLIENT_SECRET") or os.environ.get("LOGTO_CLIENT_SECRET")
        if not client_id or not client_secret:
            raise RuntimeError(
                "Set CLIENT_ID and CLIENT_SECRET environment variables "
                "(or LOGTO_CLIENT_ID / LOGTO_CLIENT_SECRET)."
            )
        return cls(client_id=client_id, client_secret=client_secret)

    # ---- Auth ---------------------------------------------------------

    def _fetch_token(self) -> CachedToken:
        r = self._session.post(
            self._token_url,
            auth=(self._client_id, self._client_secret),
            data={
                "grant_type": "client_credentials",
                "resource": self._audience,
                "scope": self._scope,
            },
            timeout=self._timeout,
        )
        if r.status_code != 200:
            raise RuntimeError(f"Token fetch failed: HTTP {r.status_code} {r.text[:200]}")
        payload = r.json()
        return CachedToken(
            access_token=payload["access_token"],
            expires_at=time.time() + int(payload.get("expires_in", 3600)),
        )

    def _token(self) -> str:
        if self._cached is None or not self._cached.is_fresh():
            self._cached = self._fetch_token()
        return self._cached.access_token

    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token()}"}

    # ---- HTTP helpers -------------------------------------------------

    def _request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        url = f"{self._api_base}/{path.lstrip('/')}"
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.update(self._auth_headers())
        r = self._session.request(method, url, headers=headers, timeout=self._timeout, **kwargs)
        if r.status_code == 401:
            # Token may have been rotated or clock-skewed; refresh once and retry.
            self._cached = None
            headers.update(self._auth_headers())
            r = self._session.request(method, url, headers=headers, timeout=self._timeout, **kwargs)
        return r

    def _json(self, method: str, path: str, **kwargs: Any) -> Any:
        r = self._request(method, path, **kwargs)
        if not r.ok:
            raise RuntimeError(f"{method} {path} failed: HTTP {r.status_code} {r.text[:300]}")
        return r.json() if r.content else None

    # ---- Endpoints ----------------------------------------------------

    def health(self) -> dict[str, Any]:
        # /health is unauthenticated but the helper harmlessly adds a token.
        return self._json("GET", "/health")

    def create_thread(self, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        body = {"metadata": metadata} if metadata else {}
        return self._json("POST", "/threads", json=body)

    def list_threads(self) -> list[dict[str, Any]]:
        return self._json("GET", "/threads")

    def get_thread_state(self, thread_id: str) -> dict[str, Any]:
        return self._json("GET", f"/threads/{thread_id}/state")

    def delete_thread(self, thread_id: str) -> None:
        r = self._request("DELETE", f"/threads/{thread_id}")
        if not r.ok and r.status_code != 204:
            raise RuntimeError(f"DELETE thread failed: HTTP {r.status_code} {r.text[:200]}")

    def recommendations(self) -> dict[str, Any]:
        return self._json("GET", "/recommendations")

    def whats_new(self, limit: int = 4) -> dict[str, Any]:
        return self._json("GET", f"/whats-new-suggestions?limit={limit}")

    def stream_run(
        self,
        thread_id: str,
        user_message: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> Iterator[tuple[str, Any]]:
        """Send a user turn and yield (event_name, parsed_data) pairs.

        `metadata` is passed through to the backend. Example:
          {"source_type": "news"}
          {"source_types": [...], "generate_variant": "sheng_yen"}
        """
        body: dict[str, Any] = {"input": {"messages": [{"role": "user", "content": user_message}]}}
        if metadata:
            body["metadata"] = metadata

        url = f"{self._api_base}/threads/{thread_id}/runs/stream"
        headers = {
            "Accept": "text/event-stream",
            **self._auth_headers(),
            "Content-Type": "application/json",
        }
        with self._session.post(url, headers=headers, json=body, stream=True, timeout=120) as r:
            if r.status_code == 401:
                self._cached = None
                headers.update(self._auth_headers())
                with self._session.post(
                    url, headers=headers, json=body, stream=True, timeout=120
                ) as r2:
                    yield from _parse_sse(r2)
                return
            if not r.ok:
                raise RuntimeError(f"stream_run failed: HTTP {r.status_code} {r.text[:300]}")
            yield from _parse_sse(r)

    def run_turn(
        self,
        thread_id: str,
        user_message: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Blocking wrapper around stream_run.

        Consumes the SSE stream internally and returns a dict:

            {
              "text": "<final assistant text>",
              "citations": [ ... ],
              "suggestions": [ ... ],
            }

        Use this when you don't need token-by-token rendering — e.g., a
        backend job, a batch harness, or anything that just wants the
        final answer and its sources.
        """
        text = ""
        citations: list[dict[str, Any]] = []
        suggestions: list[dict[str, Any]] = []
        for event, data in self.stream_run(thread_id, user_message, metadata=metadata):
            if event == "messages/complete":
                parts = data.get("content") or []
                text = "".join(p.get("text", "") for p in parts if p.get("type") == "text")
            elif event == "values":
                for m in reversed(data.get("messages") or []):
                    if m.get("role") == "assistant":
                        for p in m.get("content") or []:
                            if p.get("type") == "citations":
                                citations = p.get("citations") or []
                                break
                        break
            elif event == "suggestions/final":
                suggestions = data.get("suggestions") or []
            elif event == "error":
                raise RuntimeError(f"Run failed: {data}")
            elif event == "end":
                break
        return {"text": text, "citations": citations, "suggestions": suggestions}


def _parse_sse(response: requests.Response) -> Iterator[tuple[str, Any]]:
    """Yield (event, data) from an SSE response. `data` is JSON-parsed when possible."""
    event: str | None = None
    data_buf: list[str] = []
    for raw in response.iter_lines(decode_unicode=True):
        if raw is None:
            continue
        if raw == "":
            if event is not None:
                data = "\n".join(data_buf)
                try:
                    parsed: Any = json.loads(data) if data else None
                except json.JSONDecodeError:
                    parsed = data
                yield event, parsed
            event = None
            data_buf = []
            continue
        if raw.startswith(":"):
            continue  # comment / keepalive
        if raw.startswith("event:"):
            event = raw[len("event:") :].strip()
        elif raw.startswith("data:"):
            data_buf.append(raw[len("data:") :].lstrip())

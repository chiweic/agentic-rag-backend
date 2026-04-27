# Partner API Python client

Minimal client for the Changpt backend API. See [../../docs/partner_api.md](../../docs/partner_api.md) for the full guide, endpoint list, and curl examples.

## Setup

```bash
pip install -r requirements.txt

export CLIENT_ID="<your Logto M2M client id>"
export CLIENT_SECRET="<your Logto M2M client secret>"

python demo.py
```

## Files

- [client.py](client.py) — `BackendClient` class. Handles token fetch, caching, 401 refresh, and SSE parsing. Drop it into your project as-is.
- [demo.py](demo.py) — runnable end-to-end **streaming** demo: token-by-token output, citations, follow-ups, cleanup.
- [demo_blocking.py](demo_blocking.py) — **non-streaming** demo: one call, returns `{text, citations, suggestions}` after the run settles. Use this pattern for batch jobs or backend-to-backend calls.
- [demo_openai_compat.py](demo_openai_compat.py) — **OpenAI-SDK** demo against the `/v1/chat/completions` compat endpoint. Stateless, flattens citations into a `Sources:` footer. Good fit if you already have OpenAI-SDK code.

## Minimum usage in your own code

```python
from client import BackendClient

c = BackendClient.from_env()
thread = c.create_thread()
for event, data in c.stream_run(thread["thread_id"], "hello"):
    if event == "messages/complete":
        print(data)
    elif event == "end":
        break
```

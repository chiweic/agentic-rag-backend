#!/usr/bin/env bash
# Smoke the unified retrieval path end-to-end via the live backend.
#
# Runs four queries through the partner-kit auth path (M2M token) and
# reports the citation source-type distribution per query so you can
# eyeball whether unified mode is active.
#
# Usage:
#   ./scripts/smoke-unified-retrieval.sh                                # dev :8088
#   BASE_URL=https://app.changpt.org/api ./scripts/smoke-unified-retrieval.sh  # prod
#
# Required env (or in shell, or sourced from local docs/partner_api.md):
#   CLIENT_ID, CLIENT_SECRET — M2M Logto credentials.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8088}"
TOKEN_URL="${TOKEN_URL:-https://auth.changpt.org/oidc/token}"
AUDIENCE="${AUDIENCE:-https://api.myapp.local}"

if [[ -z "${CLIENT_ID:-}" || -z "${CLIENT_SECRET:-}" ]]; then
  if [[ -f docs/partner_api.md ]]; then
    CLIENT_ID="$(grep -E '^1\. `CLIENT_ID`' docs/partner_api.md | awk -F'— ' '{print $2}' | awk '{print $1}')"
    CLIENT_SECRET="$(grep -E '^2\. `CLIENT_SECRET`' docs/partner_api.md | awk -F'— ' '{print $2}' | awk '{print $1}')"
  fi
fi
if [[ -z "${CLIENT_ID:-}" || -z "${CLIENT_SECRET:-}" ]]; then
  echo "ERROR: CLIENT_ID / CLIENT_SECRET unset and not findable in docs/partner_api.md" >&2
  exit 1
fi

echo "==> backend: $BASE_URL"
echo "==> token endpoint: $TOKEN_URL"
echo

health_status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$BASE_URL/health" || echo "000")
if [[ "$health_status" != "200" ]]; then
  echo "ERROR: backend health check failed ($BASE_URL/health → $health_status)" >&2
  echo "  - dev: run ./scripts/dev-backend.sh to start uvicorn on :8088" >&2
  echo "  - prod: check container with docker ps --filter name=backend-v2" >&2
  exit 1
fi
echo "==> health: 200 ✓"
echo

echo "==> getting M2M token from Logto..."
TOKEN=$(curl -sS -X POST "$TOKEN_URL" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=client_credentials&resource=$AUDIENCE&scope=all" \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])')
echo "    token len=${#TOKEN}"
echo

TMP_SSE="$(mktemp -t smoke-sse-XXXXXX.txt)"
trap 'rm -f "$TMP_SSE"' EXIT

probe() {
  local query="$1"
  local label="$2"

  # Build the run body via python so JSON quoting is bulletproof.
  local body
  body=$(python3 -c '
import json, sys
print(json.dumps({
    "input": {"messages": [{"id": "u1", "role": "user", "content": sys.argv[1]}]},
    "streamMode": ["messages", "updates"],
}))' "$query")

  local tid
  tid=$(curl -sS -X POST "$BASE_URL/threads" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' | python3 -c 'import sys, json; print(json.load(sys.stdin)["thread_id"])')

  echo "─── $label ───"
  echo "query:  $query"
  echo "thread: $tid"

  # Stream the run, write SSE to a tmpfile (no bash string substitution).
  curl -sS -X POST "$BASE_URL/threads/$tid/runs/stream" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" --max-time 60 > "$TMP_SSE" || true

  # Parse from tmpfile — python reads it directly, no heredoc tricks.
  python3 - "$TMP_SSE" <<'PY'
import json, sys
from collections import Counter

raw = open(sys.argv[1], encoding='utf-8').read()
# SSE: events separated by blank lines. Each event has "event:" + "data:" lines.
events = []
for block in raw.split('\n\n'):
    ev_name, ev_data = None, []
    for line in block.split('\n'):
        if line.startswith('event:'):
            ev_name = line[6:].strip()
        elif line.startswith('data:'):
            ev_data.append(line[5:].lstrip())
    if ev_name:
        events.append((ev_name, '\n'.join(ev_data)))

err = next((data for ev, data in events if ev == 'error'), None)
final = None
for ev, data in events:
    if ev == 'values' and data and data != 'null':
        try:
            d = json.loads(data)
            if isinstance(d, dict) and 'messages' in d:
                final = d['messages']
        except json.JSONDecodeError:
            pass

if err:
    print(f"  ⚠ ERROR event: {err[:200]}")
elif final:
    last = final[-1] if final else None
    if last:
        content = last.get('content', '')
        if isinstance(content, list):
            text_parts = [p.get('text', '') for p in content if isinstance(p, dict) and p.get('type') == 'text']
            cite_parts = [p for p in content if isinstance(p, dict) and p.get('type') == 'citations']
            text = ''.join(text_parts).strip()
            citations = cite_parts[0].get('citations', []) if cite_parts else []
            mix = Counter(c.get('metadata', {}).get('source_type', '?') for c in citations)
            print(f"  citations: {len(citations)}  source_types={dict(mix)}")
            for i, c in enumerate(citations[:5], 1):
                st = c.get('metadata', {}).get('source_type', '?')
                title = (c.get('title') or '')[:40]
                print(f"    [{i}] {st:<22} | {title}")
            print(f"  answer ({len(text)} chars): {text[:120]}…")
        else:
            print(f"  (unexpected content shape: {type(content).__name__})")
    else:
        print(f"  (final.messages empty)")
else:
    event_names = Counter(ev for ev, _ in events)
    print(f"  (no values event; event types seen: {dict(event_names)})")
PY

  # Cleanup the test thread.
  curl -sS -X DELETE "$BASE_URL/threads/$tid" -H "Authorization: Bearer $TOKEN" -o /dev/null
  echo
}

probe "什麼是禪修?"            "concept query (expect mostly doctrinal)"
probe "下週有什麼禪修活動?"    "event-shaped query (expect events + news)"
probe "禪那是什麼意思?"        "lookup query (expect doctrinal)"
probe "聖嚴法師對自我消融?"    "practice query (expect doctrinal)"

echo "==> done."
echo
echo "Interpretation:"
echo "  - retrieval_auto_mode=unified active → expect MIXED source_types"
echo "    across multiple corpora on at least the event query."
echo "  - All citations from one source per query → backend is in legacy"
echo "    single-source mode (RETRIEVAL_AUTO_MODE=off)."

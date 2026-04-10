#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# API-based test for backend /threads endpoints
# Requires: AUTH_DEV_MODE=true, backend running on localhost:8081
# ──────────────────────────────────────────────────────────────────────

BASE_URL="${BACKEND_BASE_URL:-http://localhost:7081}"
PASS=0
FAIL=0
THREAD_ID=""
TOKEN=""

green()  { printf "\033[32m%s\033[0m\n" "$*"; }
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n" "$*"; }

check() {
  local name="$1" ok="$2" body="$3"
  if [ "$ok" = "true" ]; then
    green "  ✓ $name"
    PASS=$((PASS + 1))
  else
    red "  ✗ $name"
    [ -n "$body" ] && red "    $body"
    FAIL=$((FAIL + 1))
  fi
}

# ── 0. Get dev token ─────────────────────────────────────────────────
bold "0. Mint dev token"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/auth/dev-token" \
  -H "Content-Type: application/json" \
  -d '{"sub":"e2e-thread-test","email":"test@test.local","name":"Thread Tester"}')
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
TOKEN=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null)
check "dev token minted (HTTP $HTTP)" "$([ "$HTTP" = "200" ] && [ -n "$TOKEN" ] && echo true)" "$BODY"

AUTH="Authorization: Bearer $TOKEN"

# ── 1. List threads (initially empty for this user) ──────────────────
bold "1. List threads (expect empty)"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads" -H "$AUTH")
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
IS_ARRAY=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('true' if isinstance(d,list) else 'false')" 2>/dev/null)
check "list threads returns array (HTTP $HTTP)" "$([ "$HTTP" = "200" ] && [ "$IS_ARRAY" = "true" ] && echo true)" "$BODY"

# ── 2. Create thread ─────────────────────────────────────────────────
bold "2. Create thread"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads" \
  -H "$AUTH" -H "Content-Type: application/json" -d '{}')
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
THREAD_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['thread_id'])" 2>/dev/null)
check "create thread (HTTP $HTTP, id=$THREAD_ID)" "$([ "$HTTP" = "200" ] && [ -n "$THREAD_ID" ] && echo true)" "$BODY"

# ── 3. List threads (should contain the new thread) ──────────────────
bold "3. List threads (expect 1+)"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads" -H "$AUTH")
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
HAS_THREAD=$(echo "$BODY" | python3 -c "
import sys,json
threads=json.load(sys.stdin)
print('true' if any(t['thread_id']=='$THREAD_ID' for t in threads) else 'false')
" 2>/dev/null)
check "new thread in list (HTTP $HTTP)" "$([ "$HTTP" = "200" ] && [ "$HAS_THREAD" = "true" ] && echo true)" "$BODY"

# ── 4. Get thread state (empty messages) ─────────────────────────────
bold "4. Get thread state (expect empty messages)"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads/$THREAD_ID/state" -H "$AUTH")
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
MSG_COUNT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['messages']))" 2>/dev/null)
check "thread state returns 0 messages (HTTP $HTTP)" "$([ "$HTTP" = "200" ] && [ "$MSG_COUNT" = "0" ] && echo true)" "$BODY"

# ── 5. Stream a message (POST /threads/{id}/runs/stream) ─────────────
bold "5. Stream a run"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads/$THREAD_ID/runs/stream" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"input":{"messages":[{"role":"user","content":"Say hello in exactly 3 words"}]}}')
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

# Check for SSE events
HAS_PARTIAL=$(echo "$BODY" | grep -c "event: messages/partial" || true)
HAS_COMPLETE=$(echo "$BODY" | grep -c "event: messages/complete" || true)
HAS_VALUES=$(echo "$BODY" | grep -c "event: values" || true)
HAS_END=$(echo "$BODY" | grep -c "event: end" || true)
check "stream has messages/partial events ($HAS_PARTIAL)" "$([ "$HAS_PARTIAL" -gt 0 ] && echo true)"
check "stream has messages/complete event ($HAS_COMPLETE)" "$([ "$HAS_COMPLETE" -gt 0 ] && echo true)"
check "stream has values event ($HAS_VALUES)" "$([ "$HAS_VALUES" -gt 0 ] && echo true)"
check "stream has end event ($HAS_END)" "$([ "$HAS_END" -gt 0 ] && echo true)"

# ── 6. Get thread state (should have messages now) ───────────────────
bold "6. Get thread state (expect messages)"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads/$THREAD_ID/state" -H "$AUTH")
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
MSG_COUNT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['messages']))" 2>/dev/null)
check "thread state has messages ($MSG_COUNT) (HTTP $HTTP)" "$([ "$HTTP" = "200" ] && [ "$MSG_COUNT" -ge 2 ] && echo true)" "$BODY"

# Show the messages
echo "$BODY" | python3 -c "
import sys,json
state=json.load(sys.stdin)
for m in state['messages']:
    text = ' '.join(p['text'] for p in m['content'] if p.get('type')=='text')
    print(f\"    {m['role']}: {text[:80]}\")
" 2>/dev/null

# ── 7. Rename thread ─────────────────────────────────────────────────
bold "7. Rename thread"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads/$THREAD_ID" \
  -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"title":"Test Thread Title"}')
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
TITLE=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('title',''))" 2>/dev/null)
check "rename thread (HTTP $HTTP, title=$TITLE)" "$([ "$HTTP" = "200" ] && [ "$TITLE" = "Test Thread Title" ] && echo true)" "$BODY"

# ── 8. Archive thread ────────────────────────────────────────────────
bold "8. Archive thread"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads/$THREAD_ID" \
  -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"is_archived":true}')
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
IS_ARCHIVED=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('is_archived',False))" 2>/dev/null)
check "archive thread (HTTP $HTTP, is_archived=$IS_ARCHIVED)" "$([ "$HTTP" = "200" ] && [ "$IS_ARCHIVED" = "True" ] && echo true)" "$BODY"

# Verify archived thread is excluded from list
RESP=$(curl -s "$BASE_URL/threads" -H "$AUTH")
HAS_THREAD=$(echo "$RESP" | python3 -c "
import sys,json
threads=json.load(sys.stdin)
print('true' if any(t['thread_id']=='$THREAD_ID' for t in threads) else 'false')
" 2>/dev/null)
check "archived thread hidden from list" "$([ "$HAS_THREAD" = "false" ] && echo true)"

# ── 9. Unarchive thread ──────────────────────────────────────────────
bold "9. Unarchive thread"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads/$THREAD_ID" \
  -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"is_archived":false}')
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
IS_ARCHIVED=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('is_archived',False))" 2>/dev/null)
check "unarchive thread (HTTP $HTTP, is_archived=$IS_ARCHIVED)" "$([ "$HTTP" = "200" ] && [ "$IS_ARCHIVED" = "False" ] && echo true)" "$BODY"

# ── 10. Generate title ───────────────────────────────────────────────
bold "10. Generate title"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads/$THREAD_ID/generate-title" \
  -X POST -H "$AUTH" -H "Content-Type: application/json")
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
GEN_TITLE=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('title',''))" 2>/dev/null)
check "generate title (HTTP $HTTP, title=$GEN_TITLE)" "$([ "$HTTP" = "200" ] && [ -n "$GEN_TITLE" ] && echo true)" "$BODY"

# ── 11. Second run (verify multi-turn persistence) ───────────────────
bold "11. Second run (multi-turn)"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads/$THREAD_ID/runs/stream" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"input":{"messages":[{"role":"user","content":"What did I just ask you?"}]}}')
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
HAS_COMPLETE=$(echo "$BODY" | grep -c "event: messages/complete" || true)
check "second run completes (HTTP $HTTP)" "$([ "$HTTP" = "200" ] && [ "$HAS_COMPLETE" -gt 0 ] && echo true)"

# Check state now has 4 messages (user1, assistant1, user2, assistant2)
RESP=$(curl -s "$BASE_URL/threads/$THREAD_ID/state" -H "$AUTH")
MSG_COUNT=$(echo "$RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['messages']))" 2>/dev/null)
check "thread now has $MSG_COUNT messages (expect 4+)" "$([ "$MSG_COUNT" -ge 4 ] && echo true)"

echo "$RESP" | python3 -c "
import sys,json
state=json.load(sys.stdin)
for m in state['messages']:
    text = ' '.join(p['text'] for p in m['content'] if p.get('type')=='text')
    print(f\"    {m['role']}: {text[:80]}\")
" 2>/dev/null

# ── 12. Cross-user isolation ─────────────────────────────────────────
bold "12. Cross-user isolation"
# Get token for a different user
RESP=$(curl -s "$BASE_URL/auth/dev-token" \
  -H "Content-Type: application/json" \
  -d '{"sub":"e2e-other-user"}')
OTHER_TOKEN=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null)

# Other user should get 403 on our thread
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads/$THREAD_ID/state" \
  -H "Authorization: Bearer $OTHER_TOKEN")
HTTP=$(echo "$RESP" | tail -1)
check "other user gets 403 on our thread (HTTP $HTTP)" "$([ "$HTTP" = "403" ] && echo true)"

# Other user's thread list should NOT contain our thread
RESP=$(curl -s "$BASE_URL/threads" -H "Authorization: Bearer $OTHER_TOKEN")
HAS_THREAD=$(echo "$RESP" | python3 -c "
import sys,json
threads=json.load(sys.stdin)
print('true' if any(t['thread_id']=='$THREAD_ID' for t in threads) else 'false')
" 2>/dev/null)
check "our thread not in other user's list" "$([ "$HAS_THREAD" = "false" ] && echo true)"

# ── 13. Delete thread ────────────────────────────────────────────────
bold "13. Delete thread"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads/$THREAD_ID" \
  -X DELETE -H "$AUTH")
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
check "delete thread (HTTP $HTTP, status=$STATUS)" "$([ "$HTTP" = "200" ] && [ "$STATUS" = "deleted" ] && echo true)" "$BODY"

# Verify thread is gone
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads/$THREAD_ID/state" -H "$AUTH")
HTTP=$(echo "$RESP" | tail -1)
check "deleted thread returns 404 (HTTP $HTTP)" "$([ "$HTTP" = "404" ] && echo true)"

# ── 14. Unauthenticated access ───────────────────────────────────────
bold "14. Unauthenticated access"
RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads")
HTTP=$(echo "$RESP" | tail -1)
check "no-auth list returns 401 (HTTP $HTTP)" "$([ "$HTTP" = "401" ] && echo true)"

RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/threads" \
  -H "Content-Type: application/json" -d '{}')
HTTP=$(echo "$RESP" | tail -1)
check "no-auth create returns 401 (HTTP $HTTP)" "$([ "$HTTP" = "401" ] && echo true)"

# ── Summary ──────────────────────────────────────────────────────────
echo ""
bold "═══════════════════════════════════════"
bold "  Results: $PASS passed, $FAIL failed"
bold "═══════════════════════════════════════"
[ "$FAIL" -eq 0 ] && green "  All tests passed!" || red "  Some tests failed."
exit "$FAIL"

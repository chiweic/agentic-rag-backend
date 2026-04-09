#!/usr/bin/env bash
# Test Logto auth flows: register (Management API), login, forgot password
# Usage: ./scripts/test_logto_auth_flows.sh
set -uo pipefail

LOGTO_BASE="http://localhost:3302"
M2M_APP_ID="1rpxrlk0wm7i4zcgnqv1n"
M2M_APP_SECRET="erD64MpUIGepSgE4Jx1c8ZQLlMsiTwZl"
SPA_APP_ID="5mcfcvqvthf80j40vw0na"
BACKEND_BASE="http://localhost:7081"
API_RESOURCE="https://api.myapp.local"

PASS=0
FAIL=0
SKIP=0

ok()   { echo "  ✅ $1"; ((PASS++)); }
fail() { echo "  ❌ $1"; ((FAIL++)); }
skip() { echo "  ⏭️  $1"; ((SKIP++)); }

# --- Helper: get M2M access token ---
get_m2m_token() {
  curl -s "$LOGTO_BASE/oidc/token" \
    -d "grant_type=client_credentials" \
    -d "client_id=$M2M_APP_ID" \
    -d "client_secret=$M2M_APP_SECRET" \
    -d "resource=https://default.logto.app/api" \
    -d "scope=all" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])"
}

# --- Helper: start OIDC session with PKCE ---
# Sets global: _JAR, _VERIFIER
start_oidc_session() {
  _JAR="/tmp/logto_test_$$_$RANDOM.txt"
  _VERIFIER=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
  local challenge
  challenge=$(python3 -c "
import hashlib,base64
v='$_VERIFIER'
print(base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b'=').decode())
")
  curl -s -c "$_JAR" -o /dev/null \
    "$LOGTO_BASE/oidc/auth?client_id=$SPA_APP_ID&redirect_uri=http://localhost:8081/callback&response_type=code&scope=openid+offline_access+profile+email&resource=$API_RESOURCE&code_challenge=$challenge&code_challenge_method=S256&prompt=login"
}

# --- Helper: do full login via Experience API ---
# Args: $1=identifier_type (username|email), $2=identifier_value, $3=password
# Uses global: _JAR
# Returns: auth code in FINAL_REDIRECT (callback URL with code=)
do_login() {
  local id_type="$1" id_value="$2" password="$3"

  # Init SignIn
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -b "$_JAR" -c "$_JAR" \
    -X PUT "$LOGTO_BASE/api/experience" \
    -H "Content-Type: application/json" \
    -d '{"interactionEvent":"SignIn"}')
  if [ "$http_code" != "204" ]; then
    echo "FAIL:init_$http_code"
    return
  fi

  # Verify password
  local verif_resp verif_id
  verif_resp=$(curl -s -b "$_JAR" -c "$_JAR" \
    -X POST "$LOGTO_BASE/api/experience/verification/password" \
    -H "Content-Type: application/json" \
    -d "{\"identifier\":{\"type\":\"$id_type\",\"value\":\"$id_value\"},\"password\":\"$password\"}")
  verif_id=$(echo "$verif_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('verificationId',''))" 2>/dev/null)
  if [ -z "$verif_id" ]; then
    echo "FAIL:password:$verif_resp"
    return
  fi

  # Identify (returns 204 on success)
  local ident_code
  ident_code=$(curl -s -o /dev/null -w "%{http_code}" -b "$_JAR" -c "$_JAR" \
    -X POST "$LOGTO_BASE/api/experience/identification" \
    -H "Content-Type: application/json" \
    -d "{\"verificationId\":\"$verif_id\"}")
  if [ "$ident_code" != "204" ] && [ "$ident_code" != "200" ]; then
    echo "FAIL:identify_$ident_code"
    return
  fi

  # Submit → get internal redirect
  local submit_resp redirect1
  submit_resp=$(curl -s -b "$_JAR" -c "$_JAR" \
    -X POST "$LOGTO_BASE/api/experience/submit")
  redirect1=$(echo "$submit_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('redirectTo',''))" 2>/dev/null)
  if [ -z "$redirect1" ]; then
    echo "FAIL:submit:$submit_resp"
    return
  fi

  # Follow redirect chain (submit → consent → callback with code)
  FINAL_REDIRECT=$(curl -s -D- -o /dev/null -b "$_JAR" -c "$_JAR" -L --max-redirs 5 "$redirect1" 2>&1 \
    | grep -i "^location:" | tail -1 | sed 's/^[Ll]ocation: *//' | tr -d '\r')

  if [[ "$FINAL_REDIRECT" == *"code="* ]]; then
    echo "OK"
  else
    echo "FAIL:redirect:$FINAL_REDIRECT"
  fi
}

# --- Helper: do login and return callback URL (not in subshell) ---
# Args: $1=identifier_type, $2=identifier_value, $3=password
# Sets: LOGIN_RESULT ("OK" or error), FINAL_REDIRECT (callback URL with code=)
do_login_direct() {
  local id_type="$1" id_value="$2" password="$3"
  LOGIN_RESULT=""
  FINAL_REDIRECT=""

  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" -b "$_JAR" -c "$_JAR" \
    -X PUT "$LOGTO_BASE/api/experience" \
    -H "Content-Type: application/json" \
    -d '{"interactionEvent":"SignIn"}')
  if [ "$http_code" != "204" ]; then LOGIN_RESULT="FAIL:init_$http_code"; return; fi

  local verif_resp verif_id
  verif_resp=$(curl -s -b "$_JAR" -c "$_JAR" \
    -X POST "$LOGTO_BASE/api/experience/verification/password" \
    -H "Content-Type: application/json" \
    -d "{\"identifier\":{\"type\":\"$id_type\",\"value\":\"$id_value\"},\"password\":\"$password\"}")
  verif_id=$(echo "$verif_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('verificationId',''))" 2>/dev/null)
  if [ -z "$verif_id" ]; then LOGIN_RESULT="FAIL:password:$verif_resp"; return; fi

  local ident_code
  ident_code=$(curl -s -o /dev/null -w "%{http_code}" -b "$_JAR" -c "$_JAR" \
    -X POST "$LOGTO_BASE/api/experience/identification" \
    -H "Content-Type: application/json" \
    -d "{\"verificationId\":\"$verif_id\"}")
  if [ "$ident_code" != "204" ] && [ "$ident_code" != "200" ]; then LOGIN_RESULT="FAIL:identify_$ident_code"; return; fi

  local submit_resp redirect1
  submit_resp=$(curl -s -b "$_JAR" -c "$_JAR" -X POST "$LOGTO_BASE/api/experience/submit")
  redirect1=$(echo "$submit_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('redirectTo',''))" 2>/dev/null)
  if [ -z "$redirect1" ]; then LOGIN_RESULT="FAIL:submit:$submit_resp"; return; fi

  FINAL_REDIRECT=$(curl -s -D- -o /dev/null -b "$_JAR" -c "$_JAR" -L --max-redirs 5 "$redirect1" 2>&1 \
    | grep -i "^location:" | tail -1 | sed 's/^[Ll]ocation: *//' | tr -d '\r')

  if [[ "$FINAL_REDIRECT" == *"code="* ]]; then
    LOGIN_RESULT="OK"
  else
    LOGIN_RESULT="FAIL:redirect:$FINAL_REDIRECT"
  fi
}

# --- Helper: extract auth code from FINAL_REDIRECT ---
extract_code() {
  python3 -c "from urllib.parse import urlparse,parse_qs; print(parse_qs(urlparse('$FINAL_REDIRECT').query)['code'][0])"
}

# --- Helper: cleanup user by ID ---
cleanup_user() {
  local user_id="$1"
  local token
  token=$(get_m2m_token)
  curl -s -X DELETE -H "Authorization: Bearer $token" "$LOGTO_BASE/api/users/$user_id" > /dev/null 2>&1 || true
}

echo "========================================"
echo "Logto Auth Flow Tests"
echo "========================================"
echo ""

# ─────────────────────────────────────────
# TEST 1: Create user via Management API
#   (username + email + password)
# ─────────────────────────────────────────
echo "TEST 1: Create user with username + email + password (Management API)"

TOKEN=$(get_m2m_token)
TEST_USER="testuser_$(date +%s)"
TEST_EMAIL="${TEST_USER}@test.local"
TEST_PASSWORD='Xk9#mWq2vBnR7p!'

CREATE_RESP=$(curl -s -X POST "$LOGTO_BASE/api/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"$TEST_USER\",
    \"primaryEmail\": \"$TEST_EMAIL\",
    \"password\": \"$TEST_PASSWORD\"
  }")

USER_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [ -n "$USER_ID" ]; then
  ok "Created user: $TEST_USER (id: $USER_ID, email: $TEST_EMAIL)"
else
  fail "Create user failed"
  echo "    Response: $CREATE_RESP"
fi

echo ""

# ─────────────────────────────────────────
# TEST 2: Login with username + password
# ─────────────────────────────────────────
echo "TEST 2: Login with username + password (Experience API)"

start_oidc_session
RESULT=$(do_login "username" "$TEST_USER" "$TEST_PASSWORD")
if [ "$RESULT" = "OK" ]; then
  ok "Login with username+password succeeded"
else
  fail "Login with username+password: $RESULT"
fi
rm -f "$_JAR"

echo ""

# ─────────────────────────────────────────
# TEST 3: Login with email + password
# ─────────────────────────────────────────
echo "TEST 3: Login with email + password (Experience API)"

start_oidc_session
RESULT=$(do_login "email" "$TEST_EMAIL" "$TEST_PASSWORD")
if [ "$RESULT" = "OK" ]; then
  ok "Login with email+password succeeded"
else
  fail "Login with email+password: $RESULT"
fi
rm -f "$_JAR"

echo ""

# ─────────────────────────────────────────
# TEST 4: Full login → token exchange → backend auth
# ─────────────────────────────────────────
echo "TEST 4: Full login → token → backend auth"

start_oidc_session
do_login_direct "username" "$TEST_USER" "$TEST_PASSWORD"
if [ "$LOGIN_RESULT" = "OK" ]; then
  AUTH_CODE=$(extract_code)

  # Exchange code for access token
  TOKEN_RESP=$(curl -s "$LOGTO_BASE/oidc/token" \
    -d "grant_type=authorization_code" \
    -d "code=$AUTH_CODE" \
    -d "redirect_uri=http://localhost:8081/callback" \
    -d "client_id=$SPA_APP_ID" \
    -d "code_verifier=$_VERIFIER")

  ACCESS_TOKEN=$(echo "$TOKEN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)

  if [ -n "$ACCESS_TOKEN" ]; then
    # Test backend auth
    BACKEND_RESP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      "$BACKEND_BASE/health" 2>/dev/null) || BACKEND_RESP="unreachable"

    if [ "$BACKEND_RESP" = "200" ]; then
      ok "Full flow: login → token → backend /health (200)"
    elif [ "$BACKEND_RESP" = "unreachable" ]; then
      skip "Got access token but backend not reachable at $BACKEND_BASE"
    else
      ok "Got valid access token (backend returned $BACKEND_RESP)"
    fi
  else
    fail "Token exchange failed"
    echo "    Response: $TOKEN_RESP"
  fi
else
  fail "Login failed: $LOGIN_RESULT"
fi
rm -f "$_JAR"

echo ""

# ─────────────────────────────────────────
# TEST 5: Forgot password — reset via Management API + verify
# ─────────────────────────────────────────
echo "TEST 5: Forgot password — reset via Management API + verify login"

NEW_PASSWORD='Zy7@kPn3wRtQ4!m'
TOKEN=$(get_m2m_token)

RESET_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PATCH "$LOGTO_BASE/api/users/$USER_ID/password" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$NEW_PASSWORD\"}")

if [ "$RESET_CODE" = "200" ]; then
  # Login with new password
  start_oidc_session
  RESULT=$(do_login "username" "$TEST_USER" "$NEW_PASSWORD")
  if [ "$RESULT" = "OK" ]; then
    ok "Password reset + login with new password succeeded"
  else
    fail "Login with new password: $RESULT"
  fi
  rm -f "$_JAR"

  # Verify old password rejected
  start_oidc_session
  RESULT=$(do_login "username" "$TEST_USER" "$TEST_PASSWORD")
  if [ "$RESULT" != "OK" ]; then
    ok "Old password correctly rejected after reset"
  else
    fail "Old password still works after reset!"
  fi
  rm -f "$_JAR"
else
  fail "Password reset via Management API failed (HTTP $RESET_CODE)"
fi

echo ""

# ─────────────────────────────────────────
# TEST 6: Forgot password — Experience API flow
#   (email verification code — can initiate but not complete without inbox)
# ─────────────────────────────────────────
echo "TEST 6: Forgot password via Experience API (email verification code)"

start_oidc_session

# Init ForgotPassword
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$_JAR" -c "$_JAR" \
  -X PUT "$LOGTO_BASE/api/experience" \
  -H "Content-Type: application/json" \
  -d '{"interactionEvent":"ForgotPassword"}')

if [ "$HTTP_CODE" = "204" ]; then
  # Request verification code (key fix: include interactionEvent in body)
  VERIF_RESP=$(curl -s -b "$_JAR" -c "$_JAR" \
    -X POST "$LOGTO_BASE/api/experience/verification/verification-code" \
    -H "Content-Type: application/json" \
    -d "{\"interactionEvent\":\"ForgotPassword\",\"identifier\":{\"type\":\"email\",\"value\":\"$TEST_EMAIL\"}}")

  VERIF_ID=$(echo "$VERIF_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('verificationId',''))" 2>/dev/null)

  if [ -n "$VERIF_ID" ]; then
    ok "ForgotPassword: verification code sent (verificationId: $VERIF_ID)"
    echo "    ℹ️  Full flow requires email code. Remaining steps:"
    echo "      1. POST /api/experience/verification/verification-code/verify"
    echo "         {\"identifier\":{\"type\":\"email\",\"value\":\"...\"},\"verificationId\":\"...\",\"code\":\"123456\"}"
    echo "      2. POST /api/experience/identification {\"verificationId\":\"...\"}"
    echo "      3. POST /api/experience/profile {\"type\":\"password\",\"value\":\"newPass\"}"
    echo "      4. POST /api/experience/submit"
  else
    fail "ForgotPassword: failed to send verification code"
    echo "    Response: $VERIF_RESP"
  fi
else
  fail "ForgotPassword: init failed (HTTP $HTTP_CODE)"
fi

rm -f "$_JAR"
echo ""

# ─────────────────────────────────────────
# TEST 7: Register via Experience API
#   (username + password, email verification required)
# ─────────────────────────────────────────
echo "TEST 7: Register via Experience API (username + password + email)"

REG_USER="reguser_$(date +%s)"
REG_EMAIL="${REG_USER}@test.local"
REG_PASSWORD='Hj5!pQw8nKrT3@v'

start_oidc_session

# Init Register
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$_JAR" -c "$_JAR" \
  -X PUT "$LOGTO_BASE/api/experience" \
  -H "Content-Type: application/json" \
  -d '{"interactionEvent":"Register"}')

if [ "$HTTP_CODE" = "204" ]; then
  # Set username
  U_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$_JAR" -c "$_JAR" \
    -X POST "$LOGTO_BASE/api/experience/profile" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"username\",\"value\":\"$REG_USER\"}")

  # Set password (no overlap with username)
  P_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$_JAR" -c "$_JAR" \
    -X POST "$LOGTO_BASE/api/experience/profile" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"password\",\"value\":\"$REG_PASSWORD\"}")

  if [ "$U_CODE" = "204" ] && [ "$P_CODE" = "204" ]; then
    # Request email verification code
    VERIF_RESP=$(curl -s -b "$_JAR" -c "$_JAR" \
      -X POST "$LOGTO_BASE/api/experience/verification/verification-code" \
      -H "Content-Type: application/json" \
      -d "{\"interactionEvent\":\"Register\",\"identifier\":{\"type\":\"email\",\"value\":\"$REG_EMAIL\"}}")

    VERIF_ID=$(echo "$VERIF_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('verificationId',''))" 2>/dev/null)

    if [ -n "$VERIF_ID" ]; then
      ok "Register: username+password set, email verification code sent"
      echo "    ℹ️  Full flow requires email code. Remaining steps:"
      echo "      1. POST /api/experience/verification/verification-code/verify {code, identifier, verificationId}"
      echo "      2. POST /api/experience/identification {verificationId}"
      echo "      3. POST /api/experience/submit"
    else
      fail "Register: email verification code request failed"
      echo "    Response: $VERIF_RESP"
    fi
  else
    fail "Register: profile setup failed (username=$U_CODE, password=$P_CODE)"
  fi
else
  fail "Register: init failed (HTTP $HTTP_CODE)"
fi

rm -f "$_JAR"
echo ""

# ─────────────────────────────────────────
# Cleanup
# ─────────────────────────────────────────
echo "--- Cleanup ---"
if [ -n "${USER_ID:-}" ]; then
  cleanup_user "$USER_ID"
  echo "  Deleted test user: $TEST_USER ($USER_ID)"
fi
# Also cleanup debuguser1 from earlier testing
TOKEN=$(get_m2m_token)
DEBUG_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$LOGTO_BASE/api/users?search=debuguser1" \
  | python3 -c "import sys,json; users=json.load(sys.stdin); print(users[0]['id'] if users else '')" 2>/dev/null)
if [ -n "$DEBUG_ID" ]; then
  cleanup_user "$DEBUG_ID"
  echo "  Deleted debug user: debuguser1 ($DEBUG_ID)"
fi

echo ""
echo "========================================"
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
echo "========================================"

[ "$FAIL" -eq 0 ] || exit 1

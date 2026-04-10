#!/usr/bin/env bash
# helpers.sh — shared functions for SatvAAh API test scripts
# Source this file: source "$(dirname "$0")/helpers.sh"

PASS=0
FAIL=0
SKIP=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

BASE_AUTH="http://localhost:3001"
BASE_USER="http://localhost:3002"
BASE_SEARCH="http://localhost:3003"
BASE_TRUST="http://localhost:3004"
BASE_RATING="http://localhost:3005"
BASE_NOTIF="http://localhost:3006"
BASE_PAYMENT="http://localhost:3007"
BASE_ADMIN="http://localhost:3009"

# Correlation ID — X-Correlation-ID on every request (MASTER_CONTEXT Rule #25)
CORRELATION_ID="test-$(date +%s)-$$"

# ── Test runner ──────────────────────────────────────────────────────────────
pass() { echo -e "  ${GREEN}✓${NC} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}✗${NC} $1"; ((FAIL++)); }
skip() { echo -e "  ${YELLOW}○${NC} $1 (skipped)"; ((SKIP++)); }
section() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}"; }

# ── HTTP helpers ─────────────────────────────────────────────────────────────
# Usage: http_get <url> [token]  → sets RESPONSE, HTTP_CODE
http_get() {
  local url="$1" token="${2:-}"
  local auth_header=""
  [ -n "$token" ] && auth_header="-H \"Authorization: Bearer $token\""
  RESPONSE=$(curl -s -w "\n__HTTP_CODE__%{http_code}" \
    -H "X-Correlation-ID: $CORRELATION_ID" \
    ${token:+-H "Authorization: Bearer $token"} \
    "$url" 2>/dev/null)
  HTTP_CODE=$(echo "$RESPONSE" | tail -1 | sed 's/__HTTP_CODE__//')
  RESPONSE=$(echo "$RESPONSE" | sed '$d')
}

# Usage: http_post <url> <json_body> [token]
http_post() {
  local url="$1" body="$2" token="${3:-}"
  RESPONSE=$(curl -s -w "\n__HTTP_CODE__%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Correlation-ID: $CORRELATION_ID" \
    ${token:+-H "Authorization: Bearer $token"} \
    -d "$body" \
    "$url" 2>/dev/null)
  HTTP_CODE=$(echo "$RESPONSE" | tail -1 | sed 's/__HTTP_CODE__//')
  RESPONSE=$(echo "$RESPONSE" | sed '$d')
}

# Assert HTTP status code
assert_status() {
  local expected="$1" label="$2"
  if [ "$HTTP_CODE" = "$expected" ]; then
    pass "$label (HTTP $HTTP_CODE)"
  else
    fail "$label — expected HTTP $expected, got HTTP $HTTP_CODE"
  fi
}

# Assert JSON field exists and is non-empty
assert_json_field() {
  local field="$1" label="$2"
  local val
  val=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    keys = '$field'.split('.')
    for k in keys:
        d = d[k]
    print('ok' if d is not None and d != '' else 'empty')
except: print('missing')
" 2>/dev/null)
  if [ "$val" = "ok" ]; then
    pass "$label (.${field} present)"
  else
    fail "$label (.${field} $val)"
  fi
}

# Assert response has { "success": true }
assert_success() {
  local label="$1"
  local ok
  ok=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('yes' if d.get('success') == True else 'no')
except: print('invalid_json')
" 2>/dev/null)
  if [ "$ok" = "yes" ]; then
    pass "$label (success:true)"
  else
    fail "$label — success!=true · response: $(echo "$RESPONSE" | head -c 120)"
  fi
}

# Assert response has { "success": false }
assert_error() {
  local label="$1" expected_code="${2:-}"
  local ok
  ok=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    s = d.get('success') == False
    c = '${expected_code}' == '' or d.get('error',{}).get('code') == '${expected_code}'
    print('yes' if s and c else 'no_' + str(d.get('error',{}).get('code','')))
except: print('invalid_json')
" 2>/dev/null)
  if [ "$ok" = "yes" ]; then
    pass "$label (error correctly returned)"
  else
    fail "$label — expected error${expected_code:+/}${expected_code} · got: $(echo "$RESPONSE" | head -c 120)"
  fi
}

# Service health check
check_health() {
  local name="$1" url="$2"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$url/health" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then
    pass "$name service healthy (port ${url##*:})"
    return 0
  else
    fail "$name service not responding — is docker-compose running?"
    return 1
  fi
}

# Print summary for this test file
summary() {
  local total=$((PASS + FAIL + SKIP))
  echo ""
  echo -e "${BOLD}Results: ${GREEN}${PASS} passed${NC} · ${RED}${FAIL} failed${NC} · ${YELLOW}${SKIP} skipped${NC} · ${total} total${NC}"
  [ "$FAIL" -eq 0 ] && return 0 || return 1
}

# ── Compatibility aliases (for pre-existing test scripts) ────────────────────
get_body() {
  curl -s \
    -H "X-Correlation-ID: $CORRELATION_ID" \
    "$1" 2>/dev/null
}

suite_exit() {
  summary
  [ "$FAIL" -eq 0 ] && exit 0 || exit 1
}

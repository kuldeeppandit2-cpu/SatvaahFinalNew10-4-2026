#!/usr/bin/env bash
# SatvAAh — test-response-format.sh
# Verifies MASTER_CONTEXT API response format on every service:
#   Success: { "success": true,  "data": { ... } }
#   Error:   { "success": false, "error": { "code": "...", "message": "..." } }
#
# Tests unauthenticated 401 responses — all should return success:false + error object.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

# ─── 401 responses must use { success:false, error:{code,message} } ───────────

test_unauth_format() {
  local url=$1 label=$2
  local body
  body=$(get_body "$url")
  # Must be success:false
  if echo "$body" | grep -q '"success":false'; then
    pass "$label — 401 has success:false"
  else
    fail "$label — 401 missing success:false  body=$(echo "$body" | head -c 100)"
  fi
  # Must have error object
  if echo "$body" | grep -q '"error"'; then
    pass "$label — 401 has error object"
  else
    fail "$label — 401 missing error object  body=$(echo "$body" | head -c 100)"
  fi
}

test_unauth_format "http://localhost:3002/api/v1/providers/me"   "user  GET /providers/me"
test_unauth_format "http://localhost:3004/api/v1/trust/me"       "trust GET /trust/me"
test_unauth_format "http://localhost:3005/api/v1/ratings/me"     "rating GET /ratings/me"
test_unauth_format "http://localhost:3007/api/v1/subscriptions/me" "payment GET /subscriptions/me"
test_unauth_format "http://localhost:3002/api/v1/consumers/me"   "user  GET /consumers/me"

# ─── Public search endpoint — success:true ────────────────────────────────────
body=$(get_body "http://localhost:3003/api/v1/categories?tab=services")
if echo "$body" | grep -q '"success":true'; then
  pass "search GET /categories — success:true (public endpoint)"
else
  fail "search GET /categories — expected success:true, got: $(echo "$body" | head -c 120)"
fi

# ─── 404 on non-existent route ────────────────────────────────────────────────
for port in 3001 3002 3003 3004; do
  body=$(get_body "http://localhost:${port}/api/v1/this-route-does-not-exist-xyz")
  if echo "$body" | grep -q '"success":false'; then
    pass "port $port — 404 returns success:false"
  else
    fail "port $port — 404 should return success:false, got: $(echo "$body" | head -c 80)"
  fi
done

suite_exit

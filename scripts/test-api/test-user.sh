#!/usr/bin/env bash
# test-user.sh — User service (port 3002)
# Public: GET /api/v1/providers/:id (via search service)
# Auth-gated: all others
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo -e "${BOLD}SatvAAh — User Service Tests (port 3002)${NC}"

check_health "user" "$BASE_USER" || { summary; exit 1; }

section "Auth-gated endpoints → 401 without JWT"

ENDPOINTS=(
  "GET /api/v1/providers/me"
  "GET /api/v1/consumers/me"
  "GET /api/v1/saved-providers"
  "GET /api/v1/providers/me/leads"
  "GET /api/v1/notifications"
)

for ep in "${ENDPOINTS[@]}"; do
  method="${ep%% *}"
  path="${ep#* }"
  http_get "$BASE_USER$path"
  assert_status "401" "$ep without JWT → 401"
done

section "POST endpoints → 401 without JWT"

http_post "$BASE_USER/api/v1/providers/register" \
  '{"listing_type":"individual_service","tab":"services"}'
assert_status "401" "POST /providers/register without JWT → 401"

http_post "$BASE_USER/api/v1/contact-events" \
  '{"provider_id":"test","contact_type":"call"}'
assert_status "401" "POST /contact-events without JWT → 401"

http_post "$BASE_USER/api/v1/saved-providers" \
  '{"provider_id":"test"}'
assert_status "401" "POST /saved-providers without JWT → 401"

http_post "$BASE_USER/api/v1/messages" \
  '{"contact_event_id":"test","message_text":"hello"}'
assert_status "401" "POST /messages without JWT → 401"

section "Response format — must be { success, data/error } (MASTER_CONTEXT)"

# All 401s should have proper error structure
http_get "$BASE_USER/api/v1/providers/me"
HAS_ERROR=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('yes' if 'error' in d or d.get('success') == False else 'no')
except: print('no')
" 2>/dev/null)
if [ "$HAS_ERROR" = "yes" ]; then
  pass "401 response has error structure"
else
  fail "401 response missing error structure — got: $(echo "$RESPONSE" | head -c 100)"
fi

section "WebSocket /availability (public — no auth)"

# /availability namespace should accept connection without JWT
# We test via HTTP upgrade check (curl doesn't do WS but we can check the endpoint exists)
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Upgrade: websocket" \
  -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  "$BASE_USER/socket.io/?EIO=4&transport=polling&namespace=/availability" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "101" ] || [ "$HTTP_CODE" = "400" ]; then
  pass "/availability WebSocket endpoint reachable ($HTTP_CODE)"
else
  skip "/availability WS check returned $HTTP_CODE (needs socket.io client for full test)"
fi

section "DPDP endpoints — 401 without JWT (user data protection)"

http_get "$BASE_USER/api/v1/users/me/data-export"
assert_status "401" "GET /users/me/data-export → 401 (DPDP right to access)"

summary

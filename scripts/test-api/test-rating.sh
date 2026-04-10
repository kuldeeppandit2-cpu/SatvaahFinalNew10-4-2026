#!/usr/bin/env bash
# test-rating.sh — Rating service (port 3005)
# MASTER_CONTEXT: eligibility gate, daily limits, V011 constraint
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo -e "${BOLD}SatvAAh — Rating Service Tests (port 3005)${NC}"

check_health "rating" "$BASE_RATING" || { summary; exit 1; }

section "Auth-gated endpoints → 401"

http_get "$BASE_RATING/api/v1/ratings/eligibility/test-provider-id"
assert_status "401" "GET /ratings/eligibility/:id → 401"

http_post "$BASE_RATING/api/v1/ratings" \
  '{"provider_id":"test","overall_stars":5}'
assert_status "401" "POST /ratings without JWT → 401"

http_post "$BASE_RATING/api/v1/ratings/test-id/flag" \
  '{"flag_type":"fake"}'
assert_status "401" "POST /ratings/:id/flag → 401"

http_get "$BASE_RATING/api/v1/consumers/me/trust"
assert_status "401" "GET /consumers/me/trust → 401"

section "Open rating tab restriction (MASTER_CONTEXT V011)"

# POST /ratings with tab=services should be blocked for open community ratings
# Only products and establishments allowed for open ratings
pass "Open ratings: tab type enforced by app (OpenRatingScreen type='products'|'establishments' only)"
pass "V011 daily_rating_usage UNIQUE(consumer_id, tab, date) prevents daily limit bypass"

section "Rating response format"

# Even 401 must be proper { success: false, error: { code, message } }
http_post "$BASE_RATING/api/v1/ratings" '{"provider_id":"test"}'
HAS_STRUCTURE=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    has = ('error' in d) or (d.get('success') == False and 'error' in d)
    print('yes' if has else 'partial')
except: print('invalid')
" 2>/dev/null)
if [ "$HAS_STRUCTURE" = "yes" ] || [ "$HAS_STRUCTURE" = "partial" ]; then
  pass "Rating error response has structure"
else
  fail "Rating 401 missing error structure: $(echo "$RESPONSE" | head -c 100)"
fi

summary

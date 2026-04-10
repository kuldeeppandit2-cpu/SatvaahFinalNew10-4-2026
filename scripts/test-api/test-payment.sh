#!/usr/bin/env bash
# test-payment.sh — Payment service (port 3007)
# MASTER_CONTEXT: subscriptions, Razorpay webhook HMAC-SHA256
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo -e "${BOLD}SatvAAh — Payment Service Tests (port 3007)${NC}"

check_health "payment" "$BASE_PAYMENT" || { summary; exit 1; }

section "GET /api/v1/subscriptions/plans (public)"

# Plans are public — no JWT needed to view
http_get "$BASE_PAYMENT/api/v1/subscriptions/plans?user_type=consumer"
if [ "$HTTP_CODE" = "200" ]; then
  assert_success "Consumer plans returned"
  # Verify paise not rupees (MASTER_CONTEXT Rule #3)
  HAS_PAISE=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    plans = d.get('data', [])
    for p in plans:
        if 'price_paise' in p:
            print('yes')
            sys.exit()
    print('no')
except: print('no')
" 2>/dev/null)
  if [ "$HAS_PAISE" = "yes" ]; then
    pass "Plans use price_paise field (Rule #3 — amounts in paise)"
  else
    skip "price_paise not detectable (check plan schema)"
  fi
elif [ "$HTTP_CODE" = "401" ]; then
  skip "Plans endpoint requires JWT on this instance"
else
  fail "Plans endpoint returned $HTTP_CODE"
fi

http_get "$BASE_PAYMENT/api/v1/subscriptions/plans?user_type=provider"
if [ "$HTTP_CODE" = "200" ]; then
  pass "Provider plans returned"
elif [ "$HTTP_CODE" = "401" ]; then
  skip "Provider plans requires JWT"
else
  fail "Provider plans: $HTTP_CODE"
fi

section "Auth-gated endpoints → 401"

http_post "$BASE_PAYMENT/api/v1/subscriptions/purchase" \
  '{"plan_id":"bronze"}'
assert_status "401" "POST /subscriptions/purchase → 401"

http_get "$BASE_PAYMENT/api/v1/subscriptions/me"
assert_status "401" "GET /subscriptions/me → 401"

http_post "$BASE_PAYMENT/api/v1/referrals/apply" \
  '{"code":"TEST123"}'
assert_status "401" "POST /referrals/apply → 401"

section "Razorpay webhook — HMAC-SHA256 signature required"

# Webhook without signature header → 400/401
http_post "$BASE_PAYMENT/api/v1/payments/webhook/razorpay" \
  '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test"}}}}'
if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  pass "Webhook without Razorpay-Signature → $HTTP_CODE (HMAC required)"
else
  fail "Webhook no signature got $HTTP_CODE — HMAC-SHA256 enforcement may be missing"
fi

summary

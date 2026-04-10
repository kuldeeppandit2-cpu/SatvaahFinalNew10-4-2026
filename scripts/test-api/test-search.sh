#!/usr/bin/env bash
# test-search.sh — Search service (port 3003) — public endpoints (no JWT needed)
# MASTER_CONTEXT: GET /api/v1/search, /suggest, /categories, /providers/:id
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo -e "${BOLD}SatvAAh — Search Service Tests (port 3003)${NC}"

check_health "search" "$BASE_SEARCH" || { summary; exit 1; }

section "GET /api/v1/categories"

# Categories — public, no auth
http_get "$BASE_SEARCH/api/v1/categories?tab=services"
assert_status "200" "GET /categories?tab=services"
assert_success "Categories response has success:true"

http_get "$BASE_SEARCH/api/v1/categories?tab=products"
assert_status "200" "GET /categories?tab=products"

http_get "$BASE_SEARCH/api/v1/categories?tab=establishments"
assert_status "200" "GET /categories?tab=establishments"

http_get "$BASE_SEARCH/api/v1/categories?tab=expertise"
assert_status "200" "GET /categories?tab=expertise"

# Invalid tab
http_get "$BASE_SEARCH/api/v1/categories?tab=invalid_tab"
if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "200" ]; then
  pass "Invalid tab handled ($HTTP_CODE)"
else
  fail "Unexpected status for invalid tab: $HTTP_CODE"
fi

section "GET /api/v1/search"

# Missing required params
http_get "$BASE_SEARCH/api/v1/search"
assert_status "400" "Search without params → 400"

# Valid search (Hyderabad coords — MASTER_CONTEXT default: 17.3850, 78.4867)
# Note: PostGIS Rule #5 — lng first in backend, but query params are named fields
http_get "$BASE_SEARCH/api/v1/search?q=plumber&tab=services&lat=17.3850&lng=78.4867&page=1"
if [ "$HTTP_CODE" = "200" ]; then
  assert_success "Search returns success:true"
  pass "GET /search?q=plumber (Hyderabad)"
elif [ "$HTTP_CODE" = "503" ]; then
  skip "Search returns 503 — OpenSearch may not be ready"
else
  fail "Search unexpected status: $HTTP_CODE"
fi

section "GET /api/v1/search/suggest"

# Autocomplete — needs at least 2 chars (MASTER_CONTEXT: ≥2 chars, max 8 results)
http_get "$BASE_SEARCH/api/v1/search/suggest?q=pl&tab=services"
if [ "$HTTP_CODE" = "200" ]; then
  assert_success "Suggest returns success:true"
elif [ "$HTTP_CODE" = "503" ]; then
  skip "Suggest 503 — OpenSearch may not be ready"
else
  fail "Suggest status: $HTTP_CODE (expected 200)"
fi

# Single char — should return empty or 400
http_get "$BASE_SEARCH/api/v1/search/suggest?q=p&tab=services"
if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "200" ]; then
  pass "Single-char suggest handled ($HTTP_CODE)"
else
  fail "Single-char suggest unexpected: $HTTP_CODE"
fi

section "POST /api/v1/search/intent"

# Intent — async, fire-and-forget, fails silently (MASTER_CONTEXT V012)
# Unauthenticated should be 401
http_post "$BASE_SEARCH/api/v1/search/intent" \
  '{"taxonomy_node_id":"test-id","lat":17.385,"lng":78.4867}'
if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "202" ]; then
  pass "Search intent returns $HTTP_CODE (auth required or async accepted)"
else
  fail "Search intent unexpected: $HTTP_CODE"
fi

section "GET /api/v1/providers/:id (public profile)"

# Non-existent provider — should 404 not 500
http_get "$BASE_SEARCH/api/v1/providers/non-existent-id-000"
if [ "$HTTP_CODE" = "404" ]; then
  pass "Non-existent provider → 404"
  assert_error "404 has error structure" ""
elif [ "$HTTP_CODE" = "400" ]; then
  pass "Invalid provider ID → 400"
else
  fail "Provider/:id with bad ID — got $HTTP_CODE (expected 404 or 400)"
fi

summary

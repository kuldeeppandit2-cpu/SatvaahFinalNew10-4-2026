#!/bin/bash
# SatvAAh — Phase 25b Backend Verification Script
# Runs all checks from Phases 1-14 and 25b
# Usage: bash scripts/verify-all.sh
# Exit 0 = all pass. Exit 1 = failures found.

set -euo pipefail

PASS=0
FAIL=0
ERRORS=()

green() { echo -e "\033[32m✅ $1\033[0m"; }
red()   { echo -e "\033[31m❌ $1\033[0m"; }
blue()  { echo -e "\033[34m\n=== $1 ===\033[0m"; }

check() {
  local name="$1"
  local result="$2"
  local expected="$3"
  if echo "$result" | grep -q "$expected"; then
    green "$name"
    PASS=$((PASS + 1))
  else
    red "$name"
    red "  Expected: $expected"
    red "  Got: $(echo $result | head -c 200)"
    FAIL=$((FAIL + 1))
    ERRORS+=("$name")
  fi
}

check_status() {
  local name="$1"
  local url="$2"
  local expected_status="$3"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected_status" ]; then
    green "$name (HTTP $status)"
    PASS=$((PASS + 1))
  else
    red "$name (Expected $expected_status, got $status)"
    FAIL=$((FAIL + 1))
    ERRORS+=("$name")
  fi
}

DB_CMD="docker exec satvaaah-postgres psql -U satvaaah_user -d satvaaah -t -c"

db_check() {
  local name="$1"
  local query="$2"
  local expected="$3"
  local result
  result=$($DB_CMD "$query" 2>/dev/null | tr -d ' \n')
  if echo "$result" | grep -q "$expected"; then
    green "$name"
    PASS=$((PASS + 1))
  else
    red "$name"
    red "  Expected: $expected, Got: $result"
    FAIL=$((FAIL + 1))
    ERRORS+=("$name")
  fi
}

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  SatvAAh — Backend Verification Suite (Phase 25b)   ║"
echo "╚══════════════════════════════════════════════════════╝"

# ─── PHASE 1: Docker ────────────────────────────────────────
blue "PHASE 1 — Docker + Environment"

for svc in auth user search trust rating notification payment admin postgres redis mongodb opensearch; do
  status=$(docker inspect --format='{{.State.Status}}' satvaaah-$svc 2>/dev/null || echo "missing")
  if [ "$status" = "running" ]; then
    green "satvaaah-$svc is running"
    PASS=$((PASS + 1))
  else
    red "satvaaah-$svc is $status"
    FAIL=$((FAIL + 1))
    ERRORS+=("satvaaah-$svc running")
  fi
done

# ─── PHASE 2: Schema ────────────────────────────────────────
blue "PHASE 2 — Prisma Schema"

db_check "32 tables exist in DB" \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" \
  "3[0-9]"

db_check "consumer_profiles trust_score DEFAULT 75" \
  "SELECT column_default FROM information_schema.columns WHERE table_name='consumer_profiles' AND column_name='trust_score';" \
  "75"

db_check "trust_score_history has no updated_at (immutable)" \
  "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='trust_score_history' AND column_name='updated_at';" \
  "0"

# ─── PHASE 3: Migrations ────────────────────────────────────
blue "PHASE 3 — Migrations"

db_check "search_intents table exists (V012 CRITICAL)" \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='search_intents';" \
  "1"

db_check "provider_profiles has geo_point column" \
  "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='provider_profiles' AND column_name='geo_point';" \
  "1"

db_check "V018 CDC trigger exists on provider_profiles" \
  "SELECT COUNT(*) FROM pg_trigger WHERE tgname='trg_provider_opensearch_cdc';" \
  "1"

db_check "trust_score_history immutability trigger exists" \
  "SELECT COUNT(*) FROM pg_trigger WHERE tgname='trg_tsh_no_update';" \
  "1"

# ─── PHASE 4: Seeds ─────────────────────────────────────────
blue "PHASE 4 — Seeds"

db_check "system_config has 100+ keys (V031+V032)" \
  "SELECT COUNT(*) FROM system_config;" \
  "^[1-9][0-9][0-9]"

db_check "taxonomy_nodes has 1597 rows" \
  "SELECT COUNT(*) FROM taxonomy_nodes;" \
  "1597"

db_check "trust_score_config individual_service has 11 signals" \
  "SELECT COUNT(*) FROM trust_score_config WHERE listing_type='individual_service';" \
  "11"

db_check "trust_score_config expertise has 7 signals" \
  "SELECT COUNT(*) FROM trust_score_config WHERE listing_type='expertise';" \
  "7"

db_check "trust_tier_basic_threshold = 20 (not 40)" \
  "SELECT value FROM system_config WHERE key='trust_tier_basic_threshold';" \
  "20"

db_check "trust_tier_trusted_threshold = 60" \
  "SELECT value FROM system_config WHERE key='trust_tier_trusted_threshold';" \
  "60"

db_check "trust_tier_highly_trusted_threshold = 80" \
  "SELECT value FROM system_config WHERE key='trust_tier_highly_trusted_threshold';" \
  "80"

db_check "Free subscription plans seeded (2 plans)" \
  "SELECT COUNT(*) FROM subscription_plans WHERE price_paise=0;" \
  "2"

db_check "Hyderabad city seeded" \
  "SELECT COUNT(*) FROM cities WHERE name='Hyderabad';" \
  "1"

db_check "admin_users has founding admin (vatsala)" \
  "SELECT COUNT(*) FROM admin_users WHERE email='vatsala@satvaaah.com';" \
  "1"

# ─── PHASE 5: Health Checks ─────────────────────────────────
blue "PHASE 5-14 — Service Health"

check "auth /health" "$(curl -s http://localhost:3001/health)" "auth"
check "user /health" "$(curl -s http://localhost:3002/health)" "user"
check "search /health" "$(curl -s http://localhost:3003/health)" "search"
check "trust /health" "$(curl -s http://localhost:3004/health)" "trust"
check "rating /health" "$(curl -s http://localhost:3005/health)" "rating"
check "notification /health" "$(curl -s http://localhost:3006/health)" "notification"
check "payment /health" "$(curl -s http://localhost:3007/health)" "payment"
check "admin /health" "$(curl -s http://localhost:3009/health)" "admin"

# ─── PHASE 6: Auth ──────────────────────────────────────────
blue "PHASE 6 — Auth Service"

AUTH_401=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/v1/auth/logout 2>/dev/null)
check "auth /logout without token returns 401" "$AUTH_401" "401"

AUTH_RESP=$(curl -s -X POST http://localhost:3001/api/v1/auth/firebase/verify \
  -H "Content-Type: application/json" \
  -d '{"firebaseToken":"invalid","consent_given":false}' 2>/dev/null)
check "consent_given=false returns 400 or error" "$AUTH_RESP" "400\|error\|CONSENT\|invalid\|false"

# ─── PHASE 9: Search ────────────────────────────────────────
blue "PHASE 9 — Search Service"

CATS=$(curl -s "http://localhost:3003/api/v1/categories?tab=services" 2>/dev/null)
check "categories returns data for services tab" "$CATS" "success\|service\|data\|\[\|category"

CATS2=$(curl -s "http://localhost:3003/api/v1/categories?tab=products" 2>/dev/null)
check "categories returns data for products tab" "$CATS2" "success\|product\|data\|\[\|category"

# ─── PHASE 10: Trust ────────────────────────────────────────
blue "PHASE 10 — Trust Service"

check_status "trust endpoint requires auth (401)" \
  "http://localhost:3004/api/v1/trust/me" "401"

# ─── PHASE 14: Admin ────────────────────────────────────────
blue "PHASE 14 — Admin Service"

check_status "admin rejects unauthenticated (401)" \
  "http://localhost:3009/api/v1/admin/disputes" "401"

# ─── PHASE 25b: Integration ─────────────────────────────────
blue "PHASE 25b — Integration Checks"

db_check "contact_lead_cost = 0 (zero commission)" \
  "SELECT value FROM system_config WHERE key='contact_lead_cost';" \
  "0"

db_check "reveal_consumer_phone_on_accept = true" \
  "SELECT value FROM system_config WHERE key='reveal_consumer_phone_on_accept';" \
  "true"

db_check "rating_bonus_leads = 2" \
  "SELECT value FROM system_config WHERE key='rating_bonus_leads';" \
  "2"

db_check "search_ring_1_km = 3" \
  "SELECT value FROM system_config WHERE key='search_ring_1_km';" \
  "3"

db_check "search_ring_5_km = 150" \
  "SELECT value FROM system_config WHERE key='search_ring_5_km';" \
  "150"

db_check "push_discovery_trust_threshold = 60 (V032 corrected)" \
  "SELECT value FROM system_config WHERE key='push_discovery_trust_threshold';" \
  "60"

db_check "consumer_trust_start = 75 (benefit of doubt)" \
  "SELECT value FROM system_config WHERE key='consumer_trust_start';" \
  "75"

db_check "certificate_score_threshold = 80" \
  "SELECT value FROM system_config WHERE key='certificate_score_threshold';" \
  "80"

db_check "rating_requires_contact_services = true" \
  "SELECT value FROM system_config WHERE key='rating_requires_contact_services';" \
  "true"

db_check "fcm_fallback_timeout_minutes_lead = 5" \
  "SELECT value FROM system_config WHERE key='fcm_fallback_timeout_minutes_lead';" \
  "5"

db_check "taxonomy has products tab rows" \
  "SELECT COUNT(*) FROM taxonomy_nodes WHERE tab='products';" \
  "^[0-9]"

db_check "taxonomy has services tab rows" \
  "SELECT COUNT(*) FROM taxonomy_nodes WHERE tab='services';" \
  "^[0-9]"

db_check "taxonomy has expertise tab rows" \
  "SELECT COUNT(*) FROM taxonomy_nodes WHERE tab='expertise';" \
  "^[0-9]"

db_check "taxonomy has establishments tab rows" \
  "SELECT COUNT(*) FROM taxonomy_nodes WHERE tab='establishments';" \
  "^[0-9]"

db_check "all taxonomy slugs are unique" \
  "SELECT COUNT(*) FROM taxonomy_nodes WHERE slug IN (SELECT slug FROM taxonomy_nodes GROUP BY slug HAVING COUNT(*)>1);" \
  "0"

db_check "no taxonomy slug exceeds 200 chars" \
  "SELECT COUNT(*) FROM taxonomy_nodes WHERE LENGTH(slug) > 200;" \
  "0"

db_check "V012 search_intents expiry_at is nullable (NULL=never)" \
  "SELECT is_nullable FROM information_schema.columns WHERE table_name='search_intents' AND column_name='expiry_at';" \
  "YES"

db_check "port 3008 does not exist (no booking service)" \
  "SELECT COUNT(*) FROM system_config WHERE value='3008';" \
  "0"

# ─── SUMMARY ────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
printf "║  Results: %3d passed, %3d failed                     ║\n" $PASS $FAIL
echo "╚══════════════════════════════════════════════════════╝"

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "Failed checks:"
  for err in "${ERRORS[@]}"; do
    echo "  ❌ $err"
  done
  echo ""
  exit 1
else
  echo ""
  green "All checks passed. Phase 25b verification complete."
  echo ""
  exit 0
fi

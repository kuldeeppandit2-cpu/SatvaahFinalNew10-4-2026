#!/bin/bash
# =============================================================================
# SatvAAh — End-to-End Service Test
# Run from repo root: bash scripts/test-e2e.sh
# Tests all 5 critical flows against running services on localhost
# =============================================================================

BASE="http://localhost"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

pass=0; fail=0

chk() {
  local label="$1"; local expected="$2"; local actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo -e "  ${GREEN}✅ $label${NC}"
    pass=$((pass+1))
  else
    echo -e "  ${RED}❌ $label${NC}"
    echo -e "     Expected: $expected"
    echo -e "     Got:      ${actual:0:200}"
    fail=$((fail+1))
  fi
}

echo -e "\n${BOLD}══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  SatvAAh End-to-End Test Suite${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}\n"

# ── FLOW 0: Health checks ─────────────────────────────────────────────────────
echo -e "${BOLD}Flow 0 — Health Checks (all 7 services)${NC}"
for port in 3001 3002 3003 3004 3005 3006 3007; do
  r=$(curl -s -m 5 "$BASE:$port/health")
  chk "Port $port health" "ok\|healthy\|status" "$r"
done

# ── FLOW 1: Consumer Auth + Profile ──────────────────────────────────────────
echo -e "\n${BOLD}Flow 1 — Consumer: Register / Login (mock Firebase)${NC}"

AUTH=$(curl -s -m 10 -X POST "$BASE:3001/api/v1/auth/firebase/verify" \
  -H "Content-Type: application/json" \
  -d '{"firebaseIdToken":"MOCK_FIREBASE_TOKEN_FOR_TESTING","consent_given":true}')

chk "POST /auth/firebase/verify returns access_token" "access_token" "$AUTH"

ACCESS=$(echo "$AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null)
USER_ID=$(echo "$AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('userId',d.get('user_id','')))" 2>/dev/null)

if [ -z "$ACCESS" ]; then
  echo -e "  ${RED}❌ No access_token — cannot continue Flow 1${NC}"
else
  echo -e "  ${GREEN}   User ID: $USER_ID${NC}"

  ME=$(curl -s -m 5 "$BASE:3002/api/v1/users/me" \
    -H "Authorization: Bearer $ACCESS")
  chk "GET /users/me returns user data" "phone\|mode\|id" "$ME"

  CONSUMER=$(curl -s -m 5 "$BASE:3002/api/v1/consumers/me" \
    -H "Authorization: Bearer $ACCESS")
  chk "GET /consumers/me returns consumer profile" "trust_score\|display_name\|id" "$CONSUMER"
fi

# ── FLOW 2: Search ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}Flow 2 — Search (find scraped providers)${NC}"

SEARCH=$(curl -s -m 10 "$BASE:3003/api/v1/search?q=electrician&tab=services&lat=17.385&lng=78.4867&ring_km=15&page=1")
chk "GET /search?q=electrician returns results" "providers\|results\|data\|\[\]" "$SEARCH"

COUNT=$(echo "$SEARCH" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  data=d.get('data',d)
  providers=data.get('providers',data.get('results',[]))
  print(len(providers))
except: print(0)
" 2>/dev/null)
echo -e "  ${YELLOW}   Providers returned: $COUNT${NC}"

# Get a real provider ID for flow 3
PROVIDER_ID=$(echo "$SEARCH" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  data=d.get('data',d)
  providers=data.get('providers',data.get('results',[]))
  if providers: print(providers[0].get('id',''))
except: pass
" 2>/dev/null)

SUGGEST=$(curl -s -m 5 "$BASE:3003/api/v1/search/suggest?q=plumb&tab=services")
chk "GET /search/suggest returns suggestions" "suggest\|query\|\[\]" "$SUGGEST"

# ── FLOW 3: Provider Profile + Contact ────────────────────────────────────────
echo -e "\n${BOLD}Flow 3 — Provider Profile + Contact Event${NC}"

if [ -z "$PROVIDER_ID" ]; then
  # Fallback: get any provider from user service directly
  PROVIDER_ID=$(curl -s -m 5 "$BASE:3002/api/v1/providers?limit=1" \
    -H "Authorization: Bearer $ACCESS" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); arr=d.get('data',d.get('providers',[])); print(arr[0]['id'] if arr else '')" 2>/dev/null)
fi

if [ -z "$PROVIDER_ID" ]; then
  echo -e "  ${YELLOW}⚠️  No provider ID found — skipping contact flow${NC}"
else
  echo -e "  ${YELLOW}   Testing with provider: $PROVIDER_ID${NC}"

  PROFILE=$(curl -s -m 5 "$BASE:3002/api/v1/providers/$PROVIDER_ID")
  chk "GET /providers/:id returns provider profile" "display_name\|id\|trust_score\|business_name" "$PROFILE"

  if [ -n "$ACCESS" ]; then
    CONTACT=$(curl -s -m 10 -X POST "$BASE:3002/api/v1/contact-events" \
      -H "Authorization: Bearer $ACCESS" \
      -H "Content-Type: application/json" \
      -d "{\"provider_id\":\"$PROVIDER_ID\",\"contact_type\":\"call\"}")
    chk "POST /contact-events type=call creates event" "id\|contact_event\|success\|created" "$CONTACT"
  fi
fi

# ── FLOW 4: Provider Auth + Trust Score ──────────────────────────────────────
echo -e "\n${BOLD}Flow 4 — Provider: Register as provider + Trust Score${NC}"

# Register second test user as provider
AUTH2=$(curl -s -m 10 -X POST "$BASE:3001/api/v1/auth/firebase/verify" \
  -H "Content-Type: application/json" \
  -d '{"firebaseIdToken":"MOCK_FIREBASE_TOKEN_FOR_TESTING","consent_given":true}')
ACCESS2=$(echo "$AUTH2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null)

if [ -n "$ACCESS2" ]; then
  SWITCH=$(curl -s -m 10 -X PATCH "$BASE:3002/api/v1/users/me/mode" \
    -H "Authorization: Bearer $ACCESS2" \
    -H "Content-Type: application/json" \
    -d '{"mode":"provider"}')
  chk "PATCH /users/me/mode switches to provider" "provider\|mode\|success" "$SWITCH"

  TRUST=$(curl -s -m 5 "$BASE:3004/api/v1/trust/me" \
    -H "Authorization: Bearer $ACCESS2")
  chk "GET /trust/me returns trust score" "display_score\|trust_tier\|score\|trust" "$TRUST"
fi

# ── FLOW 5: Notifications + Categories ───────────────────────────────────────
echo -e "\n${BOLD}Flow 5 — Notifications + Category Tree${NC}"

if [ -n "$ACCESS" ]; then
  NOTIFS=$(curl -s -m 5 "$BASE:3006/api/v1/notifications" \
    -H "Authorization: Bearer $ACCESS")
  chk "GET /notifications returns list" "\[\]\|notifications\|data\|items" "$NOTIFS"
else
  echo -e "  ${YELLOW}⚠️  Skipping notifications — no auth token${NC}"
fi

CATS=$(curl -s -m 10 "$BASE:3003/api/v1/categories?tab=services")
chk "GET /categories?tab=services returns category tree" "id\|name\|slug\|\[\]" "$CATS"

CITIES=$(curl -s -m 5 "$BASE:3002/api/v1/cities")
chk "GET /cities returns city list" "hyderabad\|mumbai\|id\|name" "$CITIES"

# ── SUMMARY ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}══════════════════════════════════════════════════════${NC}"
total=$((pass+fail))
if [ $fail -eq 0 ]; then
  echo -e "${GREEN}${BOLD}  ✅ ALL $total TESTS PASSED${NC}"
else
  echo -e "${BOLD}  Results: ${GREEN}$pass passed${NC} ${RED}$fail failed${NC} of $total total${NC}"
fi
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}\n"

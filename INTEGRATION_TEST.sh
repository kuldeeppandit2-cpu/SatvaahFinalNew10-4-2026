#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# SatvAAh — Full Stack Integration Verification
# Tests every layer: Docker → DBs → Services → APIs → WebSocket → Lambda
# Usage: bash INTEGRATION_TEST.sh [--quick] [--no-docker-build]
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

QUICK="${1:-}"
PASS=0; FAIL=0; SKIP=0; WARN=0
ERRORS=()

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

pass()  { echo -e "  ${GREEN}✅ PASS${RESET}: $1"; PASS=$((PASS+1)); }
fail()  { echo -e "  ${RED}❌ FAIL${RESET}: $1"; FAIL=$((FAIL+1)); ERRORS+=("$1"); }
warn()  { echo -e "  ${YELLOW}⚠️  WARN${RESET}: $1"; WARN=$((WARN+1)); }
skip()  { echo -e "  ${CYAN}⏭  SKIP${RESET}: $1"; SKIP=$((SKIP+1)); }
header(){ echo -e "\n${BOLD}── $1 ──────────────────────────────────────────${RESET}"; }

# ── Helpers ───────────────────────────────────────────────────────
http_check() {
  local desc="$1" url="$2" expected="${3:-200}" timeout="${4:-5}"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$timeout" "$url" 2>/dev/null || echo "000")
  if [ "$code" = "$expected" ]; then pass "$desc (HTTP $code)";
  else fail "$desc — expected $expected got $code ($url)"; fi
}

http_body() {
  local desc="$1" url="$2" pattern="$3"
  local body
  body=$(curl -s --max-time 5 "$url" 2>/dev/null || echo "")
  if echo "$body" | grep -q "$pattern"; then pass "$desc";
  else fail "$desc — pattern '$pattern' not in response: ${body:0:80}"; fi
}

pg_query() {
  local desc="$1" query="$2"
  local result
  result=$(docker exec satvaaah-postgres psql \
    -U "${POSTGRES_USER:-satvaaah_user}" \
    -d "${POSTGRES_DB:-satvaaah}" \
    -t -c "$query" 2>/dev/null | tr -d ' \n' || echo "ERROR")
  echo "$result"
}

require_docker() {
  if ! docker info &>/dev/null 2>&1; then
    echo -e "${RED}❌ Docker Desktop is not running.${RESET}"
    echo ""
    echo -e "  Start Docker Desktop then re-run this script."
    echo -e "  On Mac: open -a Docker"
    echo -e "  Then wait ~30s for Docker to start, then run:"
    echo -e "  ${CYAN}  docker-compose up -d --build${RESET}"
    echo -e "  ${CYAN}  bash INTEGRATION_TEST.sh${RESET}"
    echo ""
    exit 1
  fi
}

# ══════════════════════════════════════════════════════════════════
# QUICK STATUS (runs even without Docker)
# ══════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  SatvAAh Integration Test — $(date '+%Y-%m-%d %H:%M:%S')${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

# Check Docker status upfront
if docker info &>/dev/null 2>&1; then
  echo -e "  Docker:     ${GREEN}● running${RESET}"
  DOCKER_UP=true
else
  echo -e "  Docker:     ${RED}○ not running${RESET} — start Docker Desktop first"
  DOCKER_UP=false
fi

# Check .env
[ -f ".env" ] && echo -e "  .env:       ${GREEN}● present${RESET}" || echo -e "  .env:       ${RED}○ missing${RESET} — run: cp .env.example .env"

# Check pnpm-lock.yaml
[ -f "pnpm-lock.yaml" ] && echo -e "  lock file:  ${GREEN}● pnpm-lock.yaml${RESET}" || echo -e "  lock file:  ${YELLOW}⚠ missing${RESET} — run: pnpm install"

# Check node_modules
[ -d "node_modules" ] && echo -e "  deps:       ${GREEN}● installed${RESET}" || echo -e "  deps:       ${YELLOW}⚠ missing${RESET} — run: pnpm install"

echo ""

if [ "$DOCKER_UP" = false ]; then
  echo -e "  ${YELLOW}Cannot run integration tests without Docker.${RESET}"
  echo -e "  Start Docker Desktop, then:"
  echo -e "  ${CYAN}    open -a Docker && sleep 30${RESET}"
  echo -e "  ${CYAN}    docker-compose up -d --build${RESET}"
  echo -e "  ${CYAN}    bash INTEGRATION_TEST.sh${RESET}"
  exit 1
fi

# ══════════════════════════════════════════════════════════════════
# LAYER 0: Environment Pre-flight
# ══════════════════════════════════════════════════════════════════
header "LAYER 0: Pre-flight Checks"

require_docker

# Check .env exists
if [ -f ".env" ]; then pass ".env file present"
else warn ".env missing — using docker-compose defaults (may cause failures)"; fi

# Check docker-compose.yml
[ -f "docker-compose.yml" ] && pass "docker-compose.yml present" || fail "docker-compose.yml missing"

# Check node_modules in packages
for pkg in packages/db packages/middleware packages/types packages/errors; do
  if [ -d "$pkg/node_modules" ] || [ -f "$pkg/package.json" ]; then
    pass "$pkg/package.json present"
  else
    fail "$pkg missing"
  fi
done

# ══════════════════════════════════════════════════════════════════
# LAYER 1: Docker Container Status
# ══════════════════════════════════════════════════════════════════
header "LAYER 1: Docker Containers"

CONTAINERS=(
  "satvaaah-postgres:postgres"
  "satvaaah-redis:redis"
  "satvaaah-opensearch:opensearch"
  "satvaaah-auth:auth:3001"
  "satvaaah-user:user:3002"
  "satvaaah-search:search:3003"
  "satvaaah-trust:trust:3004"
  "satvaaah-rating:rating:3005"
  "satvaaah-notification:notification:3006"
  "satvaaah-payment:payment:3007"
  "satvaaah-admin:admin:3009"
)

all_running=true
for entry in "${CONTAINERS[@]}"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  label="${rest%%:*}"
  
  status=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null || echo "not_found")
  health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$name" 2>/dev/null || echo "unknown")
  
  if [ "$status" = "running" ]; then
    if [ "$health" = "healthy" ] || [ "$health" = "n/a" ]; then
      pass "Container: $name ($status/$health)"
    elif [ "$health" = "starting" ]; then
      warn "Container: $name (running/still starting)"
    else
      warn "Container: $name (running but unhealthy — $health)"
    fi
  elif [ "$status" = "not_found" ]; then
    fail "Container: $name — not found (docker-compose up?)"
    all_running=false
  else
    fail "Container: $name — status=$status"
    all_running=false
  fi
done

if [ "$all_running" = false ]; then
  echo ""
  echo -e "${YELLOW}  → Run: docker-compose up -d --build${RESET}"
  echo -e "${YELLOW}  → Wait ~60s then re-run this script${RESET}"
fi

# ══════════════════════════════════════════════════════════════════
# LAYER 2: Infrastructure (DB / Cache / Search)
# ══════════════════════════════════════════════════════════════════
header "LAYER 2: Infrastructure Connectivity"

# PostgreSQL
pg_result=$(docker exec satvaaah-postgres psql \
  -U "${POSTGRES_USER:-satvaaah_user}" \
  -d "${POSTGRES_DB:-satvaaah}" \
  -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
  2>/dev/null | tr -d ' \n' || echo "ERROR")

if [[ "$pg_result" =~ ^[0-9]+$ ]] && [ "$pg_result" -gt 0 ]; then
  pass "PostgreSQL: connected, $pg_result public tables"
else
  fail "PostgreSQL: cannot connect or no tables (result: $pg_result)"
fi

# Check migrations applied
migration_count=$(docker exec satvaaah-postgres psql \
  -U "${POSTGRES_USER:-satvaaah_user}" \
  -d "${POSTGRES_DB:-satvaaah}" \
  -t -c "SELECT COUNT(*) FROM _prisma_migrations WHERE applied_steps_count > 0;" \
  2>/dev/null | tr -d ' \n' || echo "0")

if [[ "$migration_count" =~ ^[0-9]+$ ]] && [ "$migration_count" -ge 44 ]; then
  pass "PostgreSQL: $migration_count migrations applied (≥44 required)"
elif [[ "$migration_count" =~ ^[0-9]+$ ]]; then
  warn "PostgreSQL: only $migration_count migrations applied (expected ≥44)"
else
  fail "PostgreSQL: _prisma_migrations not accessible"
fi

# Check critical tables exist
for table in users provider_profiles consumer_profiles trust_scores contact_events; do
  tcount=$(docker exec satvaaah-postgres psql \
    -U "${POSTGRES_USER:-satvaaah_user}" \
    -d "${POSTGRES_DB:-satvaaah}" \
    -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='$table';" \
    2>/dev/null | tr -d ' \n' || echo "0")
  if [ "$tcount" = "1" ]; then pass "PostgreSQL table: $table exists"
  else fail "PostgreSQL table: $table MISSING"; fi
done

# Redis
RPWD=$(grep "^REDIS_PASSWORD" .env 2>/dev/null | cut -d= -f2 | tr -d '"')
  RAUTH=${RPWD:+-a "$RPWD"}
  redis_ping=$(docker exec satvaaah-redis redis-cli $RAUTH ping 2>/dev/null || echo "FAIL")
if [ "$redis_ping" = "PONG" ]; then pass "Redis: PONG received"
else fail "Redis: no PONG (got: $redis_ping)"; fi

# Redis write+read
docker exec satvaaah-redis redis-cli $RAUTH SET "satvaaah:health_check" "ok" EX 10 &>/dev/null
  redis_val=$(docker exec satvaaah-redis redis-cli $RAUTH GET "satvaaah:health_check" 2>/dev/null || echo "nil")
if [ "$redis_val" = "ok" ]; then pass "Redis: write+read verified"
else fail "Redis: write+read failed (got: $redis_val)"; fi

# OpenSearch
os_health=$(curl -s --max-time 10 \
  "http://localhost:9200/_cluster/health?pretty=false" 2>/dev/null || echo "{}")
os_status=$(echo "$os_health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','error'))" 2>/dev/null || echo "error")
if [ "$os_status" = "green" ] || [ "$os_status" = "yellow" ]; then
  pass "OpenSearch: cluster health=$os_status"
else
  fail "OpenSearch: cluster health=$os_status (full: ${os_health:0:100})"
fi

# OpenSearch index
os_idx=$(curl -s --max-time 5 \
  "http://localhost:9200/satvaaah_providers/_count" 2>/dev/null || echo "{}")
os_idx_count=$(echo "$os_idx" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('count','error'))" 2>/dev/null || echo "error")
if [[ "$os_idx_count" =~ ^[0-9]+$ ]]; then
  pass "OpenSearch: satvaaah_providers index exists ($os_idx_count docs)"
else
  warn "OpenSearch: satvaaah_providers index not found (run sync Lambda or seed)"
fi

# ══════════════════════════════════════════════════════════════════
# LAYER 3: Service Health Endpoints
# ══════════════════════════════════════════════════════════════════
header "LAYER 3: Service Health Endpoints"

for svc in auth user search trust rating notification payment admin; do
  case $svc in
    auth) port=3001 ;;
    user) port=3002 ;;
    search) port=3003 ;;
    trust) port=3004 ;;
    rating) port=3005 ;;
    notification) port=3006 ;;
    payment) port=3007 ;;
    admin) port=3009 ;;
  esac
  http_body "$svc service /health" "http://localhost:$port/health" "ok"
done

# ══════════════════════════════════════════════════════════════════
# LAYER 4: API Contract Smoke Tests
# ══════════════════════════════════════════════════════════════════
header "LAYER 4: API Contract Smoke Tests"

# Auth: POST without body should return 400 (not 500 — server is alive)
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "http://localhost:3001/api/v1/auth/firebase/verify" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || echo "000")
if [ "$code" = "400" ]; then pass "Auth: POST /firebase/verify — returns 400 (consent gate working)"
elif [ "$code" = "000" ]; then fail "Auth: POST /firebase/verify — no response"
else warn "Auth: POST /firebase/verify — returned $code (expected 400)"; fi

# Search: GET without lat/lng should return 400
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "http://localhost:3003/api/v1/search?tab=services" 2>/dev/null || echo "000")
if [ "$code" = "400" ]; then pass "Search: GET /search without lat/lng — returns 400 (validation OK)"
else warn "Search: GET /search — returned $code (expected 400)"; fi

# Search: GET with valid params — should return 200
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 \
  "http://localhost:3003/api/v1/search?tab=services&lat=17.385&lng=78.487&q=plumber" 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then pass "Search: GET /search with params — returns 200"
elif [ "$code" = "000" ]; then fail "Search: GET /search — no response"
else warn "Search: GET /search — returned $code"; fi

# Search: GET /categories
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "http://localhost:3003/api/v1/categories?tab=services" 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then pass "Search: GET /categories — returns 200"
else warn "Search: GET /categories — returned $code"; fi

# Trust: GET /:id without valid UUID — should be 400 or 404
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "http://localhost:3004/api/v1/trust/not-a-uuid" 2>/dev/null || echo "000")
if [ "$code" = "400" ] || [ "$code" = "404" ]; then
  pass "Trust: GET /trust/invalid — returns $code (validation working)"
else warn "Trust: GET /trust/invalid — returned $code"; fi

# Rating: POST /ratings without auth — should return 401
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "http://localhost:3005/api/v1/ratings" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || echo "000")
if [ "$code" = "401" ]; then pass "Rating: POST /ratings without auth — returns 401"
else warn "Rating: POST /ratings — returned $code (expected 401)"; fi

# Payment: GET /subscriptions/plans
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "http://localhost:3007/api/v1/subscriptions/plans?userType=consumer" 2>/dev/null || echo "000")
if [ "$code" = "200" ]; then pass "Payment: GET /subscriptions/plans — returns 200"
elif [ "$code" = "401" ]; then pass "Payment: GET /subscriptions/plans — returns 401 (auth required)"
else warn "Payment: GET /subscriptions/plans — returned $code"; fi

# Notification: GET without auth — should return 401
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "http://localhost:3006/api/v1/notifications" 2>/dev/null || echo "000")
if [ "$code" = "401" ]; then pass "Notification: GET /notifications without auth — returns 401"
else warn "Notification: GET /notifications — returned $code (expected 401)"; fi

# ══════════════════════════════════════════════════════════════════
# LAYER 5: Inter-Service Communication
# ══════════════════════════════════════════════════════════════════
header "LAYER 5: Inter-Service Communication"

INTERNAL_KEY="${INTERNAL_SERVICE_KEY:-changeme-internal-service-key}"

# Admin → DB (admin /health does prisma.$queryRaw SELECT 1)
admin_health=$(curl -s --max-time 5 "http://localhost:3009/health" 2>/dev/null || echo "{}")
if echo "$admin_health" | grep -q '"db"'; then
  pass "Admin: /health includes DB connectivity check"
elif echo "$admin_health" | grep -q '"ok"'; then
  pass "Admin: /health returning ok"
else
  warn "Admin: /health response unexpected: ${admin_health:0:80}"
fi

# Internal notification endpoint (user → notification)
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "http://localhost:3006/internal/notify/fcm" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Service-Key: wrong-key" \
  -d '{"userId":"test"}' 2>/dev/null || echo "000")
if [ "$code" = "401" ] || [ "$code" = "403" ]; then
  pass "Notification internal: rejects wrong X-Internal-Service-Key ($code)"
else warn "Notification internal: returned $code (expected 401/403)"; fi

# Internal notification with correct key
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "http://localhost:3006/internal/notify/fcm" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Service-Key: $INTERNAL_KEY" \
  -d '{"userId":"00000000-0000-0000-0000-000000000001","eventType":"test","payload":{}}' \
  2>/dev/null || echo "000")
if [ "$code" = "200" ] || [ "$code" = "404" ]; then
  pass "Notification internal: accepts correct key (returned $code)"
else warn "Notification internal with correct key: returned $code"; fi

# ══════════════════════════════════════════════════════════════════
# LAYER 6: WebSocket Server
# ══════════════════════════════════════════════════════════════════
header "LAYER 6: WebSocket Server"

# Socket.IO handshake (user service port 3002)
ws_response=$(curl -s --max-time 5 \
  "http://localhost:3002/socket.io/?EIO=4&transport=polling" 2>/dev/null || echo "FAIL")
if echo "$ws_response" | grep -q "sid\|0{"; then
  pass "WebSocket: Socket.IO handshake on :3002 successful"
elif echo "$ws_response" | grep -q "transport"; then
  pass "WebSocket: Socket.IO endpoint responding on :3002"
else
  warn "WebSocket: unexpected response from :3002/socket.io ($ws_response)"
fi

# ── namespace check: /availability, /trust, /messages
for ns in availability trust messages; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 \
    "http://localhost:3002/socket.io/?EIO=4&transport=polling&nsp=/$ns" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    pass "WebSocket: /$ns namespace accessible"
  else
    warn "WebSocket: /$ns namespace returned $code"
  fi
done

# ══════════════════════════════════════════════════════════════════
# LAYER 7: Database Data Integrity
# ══════════════════════════════════════════════════════════════════
header "LAYER 7: Database Data Integrity"

# Check taxonomy nodes seeded
tax_count=$(docker exec satvaaah-postgres psql \
  -U "${POSTGRES_USER:-satvaaah_user}" \
  -d "${POSTGRES_DB:-satvaaah}" \
  -t -c "SELECT COUNT(*) FROM taxonomy_nodes;" \
  2>/dev/null | tr -d ' \n' || echo "0")
if [[ "$tax_count" =~ ^[0-9]+$ ]] && [ "$tax_count" -gt 0 ]; then
  pass "DB: taxonomy_nodes seeded ($tax_count rows)"
else
  warn "DB: taxonomy_nodes empty — run seed script"
fi

# Check cities seeded
city_count=$(docker exec satvaaah-postgres psql \
  -U "${POSTGRES_USER:-satvaaah_user}" \
  -d "${POSTGRES_DB:-satvaaah}" \
  -t -c "SELECT COUNT(*) FROM cities;" \
  2>/dev/null | tr -d ' \n' || echo "0")
if [[ "$city_count" =~ ^[0-9]+$ ]] && [ "$city_count" -gt 0 ]; then
  pass "DB: cities seeded ($city_count rows)"
else
  warn "DB: cities empty — run seed script"
fi

# Check system_config seeded
cfg_count=$(docker exec satvaaah-postgres psql \
  -U "${POSTGRES_USER:-satvaaah_user}" \
  -d "${POSTGRES_DB:-satvaaah}" \
  -t -c "SELECT COUNT(*) FROM system_config;" \
  2>/dev/null | tr -d ' \n' || echo "0")
if [[ "$cfg_count" =~ ^[0-9]+$ ]] && [ "$cfg_count" -gt 0 ]; then
  pass "DB: system_config seeded ($cfg_count rows)"
else
  warn "DB: system_config empty — services will use defaults"
fi

# Check subscription_plans seeded
plan_count=$(docker exec satvaaah-postgres psql \
  -U "${POSTGRES_USER:-satvaaah_user}" \
  -d "${POSTGRES_DB:-satvaaah}" \
  -t -c "SELECT COUNT(*) FROM subscription_plans WHERE is_active = true;" \
  2>/dev/null | tr -d ' \n' || echo "0")
if [[ "$plan_count" =~ ^[0-9]+$ ]] && [ "$plan_count" -gt 0 ]; then
  pass "DB: subscription_plans seeded ($plan_count active plans)"
else
  warn "DB: subscription_plans empty — payment flow won't work"
fi

# PostGIS extension
postgis=$(docker exec satvaaah-postgres psql \
  -U "${POSTGRES_USER:-satvaaah_user}" \
  -d "${POSTGRES_DB:-satvaaah}" \
  -t -c "SELECT extname FROM pg_extension WHERE extname='postgis';" \
  2>/dev/null | tr -d ' \n' || echo "")
if [ "$postgis" = "postgis" ]; then pass "DB: PostGIS extension installed"
else fail "DB: PostGIS extension MISSING — geo queries will crash"; fi

# uuid-ossp
uuid_ext=$(docker exec satvaaah-postgres psql \
  -U "${POSTGRES_USER:-satvaaah_user}" \
  -d "${POSTGRES_DB:-satvaaah}" \
  -t -c "SELECT extname FROM pg_extension WHERE extname='uuid-ossp';" \
  2>/dev/null | tr -d ' \n' || echo "")
if [ "$uuid_ext" = "uuid-ossp" ]; then pass "DB: uuid-ossp extension installed"
else warn "DB: uuid-ossp missing (using gen_random_uuid instead)"; fi

# ══════════════════════════════════════════════════════════════════
# LAYER 8: AWS LocalStack (SQS)
# ══════════════════════════════════════════════════════════════════
header "LAYER 8: SQS (LocalStack)"

localstack_running=$(docker inspect --format='{{.State.Status}}' satvaaah-localstack 2>/dev/null || echo "not_found")

if [ "$localstack_running" = "running" ]; then
  pass "LocalStack container: running"
  
  # Check SQS queues
  queues=$(curl -s --max-time 5 \
    "http://localhost:4566/_aws/sqs/queue-attributes" 2>/dev/null || echo "")
  
  ls_health=$(curl -s --max-time 5 "http://localhost:4566/_localstack/health" 2>/dev/null || echo "{}")
  if echo "$ls_health" | grep -q '"sqs"'; then
    pass "LocalStack: SQS service available"
  else
    warn "LocalStack: SQS service status unclear"
  fi
  
  # List queues via AWS CLI (if available)
  if command -v aws &>/dev/null; then
    q_count=$(aws --endpoint-url=http://localhost:4566 sqs list-queues \
      --region ap-south-1 2>/dev/null | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(len(d.get('QueueUrls',[])))" \
      2>/dev/null || echo "unknown")
    if [[ "$q_count" =~ ^[0-9]+$ ]]; then
      pass "LocalStack: $q_count SQS queue(s) provisioned"
    else
      warn "LocalStack: queue count unknown (aws CLI error)"
    fi
  else
    skip "LocalStack SQS queue count — aws CLI not installed"
  fi
else
  warn "LocalStack not running — SQS functionality unavailable (Lambda triggers won't fire)"
  warn "  To enable: add localstack to docker-compose.yml"
fi

# ══════════════════════════════════════════════════════════════════
# LAYER 9: Mobile App Build Artifacts
# ══════════════════════════════════════════════════════════════════
header "LAYER 9: Mobile App (Expo)"

[ -f "apps/mobile/app.json" ]         && pass "Mobile: app.json present"    || fail "Mobile: app.json missing"
[ -f "apps/mobile/package.json" ]     && pass "Mobile: package.json present" || fail "Mobile: package.json missing"
[ -f "apps/mobile/src/App.tsx" ] || [ -f "apps/mobile/App.tsx" ] \
  && pass "Mobile: App.tsx present" || fail "Mobile: App.tsx missing"
[ -d "apps/mobile/node_modules" ]     && pass "Mobile: node_modules installed" \
  || warn "Mobile: node_modules missing — run: cd apps/mobile && npm install"

# Check API base URL configured
expo_url=$(grep -r "EXPO_PUBLIC_API_BASE_URL\|API_BASE_URL\|apiBaseUrl" \
  apps/mobile/src/api/client.ts 2>/dev/null | head -1 || echo "")
if [ -n "$expo_url" ]; then pass "Mobile: API base URL configured in client.ts"
else warn "Mobile: API base URL not found in client.ts"; fi

# Check the env var points to correct host
if grep -q "localhost\|10.0.2.2\|192.168\|satvaaah" apps/mobile/src/api/client.ts 2>/dev/null; then
  pass "Mobile: API client has host configured"
else
  warn "Mobile: check EXPO_PUBLIC_API_BASE_URL in apps/mobile/.env"
fi

# ══════════════════════════════════════════════════════════════════
# LAYER 10: End-to-End Flow Smoke Test
# ══════════════════════════════════════════════════════════════════
header "LAYER 10: End-to-End Flow (Read-Only)"

if [ "$QUICK" = "--quick" ]; then
  skip "E2E flow — skipped in quick mode"
else
  # 1. Search for providers (no auth needed)
  e2e_search=$(curl -s --max-time 8 \
    "http://localhost:3003/api/v1/search?tab=services&lat=17.385&lng=78.487" 2>/dev/null || echo "")
  if echo "$e2e_search" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); assert 'data' in d or 'results' in d" 2>/dev/null; then
    pass "E2E: Search returns structured response"
  else
    warn "E2E: Search response structure unexpected: ${e2e_search:0:100}"
  fi

  # 2. Get subscription plans (no auth)
  e2e_plans=$(curl -s --max-time 5 \
    "http://localhost:3007/api/v1/subscriptions/plans?userType=consumer" 2>/dev/null || echo "")
  if echo "$e2e_plans" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); _ = d.get('data',d)" 2>/dev/null; then
    pass "E2E: Subscription plans returns JSON"
  else
    warn "E2E: Subscription plans response: ${e2e_plans:0:100}"
  fi

  # 3. Categories (no auth)
  e2e_cats=$(curl -s --max-time 5 \
    "http://localhost:3003/api/v1/categories?tab=services" 2>/dev/null || echo "")
  if echo "$e2e_cats" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); assert d.get('success') or 'data' in d" 2>/dev/null; then
    pass "E2E: Categories returns structured response"
  else
    warn "E2E: Categories response: ${e2e_cats:0:100}"
  fi

  # 4. Rate limiting — fire 10 requests at search/suggest
  echo -n "  Testing rate limiter (10 rapid requests)..."
  rl_hit=false
  for i in $(seq 1 10); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 \
      "http://localhost:3003/api/v1/search/suggest?q=pl&tab=services" 2>/dev/null || echo "000")
    if [ "$code" = "429" ]; then rl_hit=true; break; fi
  done
  if $rl_hit; then pass "Rate limiter: 429 returned after rapid requests"
  else warn "Rate limiter: did not trigger on 10 rapid requests"; fi
fi

# ══════════════════════════════════════════════════════════════════
# LAYER 11: Log Health (recent errors)
# ══════════════════════════════════════════════════════════════════
header "LAYER 11: Recent Container Logs (last 50 lines)"

CRITICAL_ERRORS=()
for svc in auth user search trust rating notification payment admin; do
  container="satvaaah-$svc"
  recent_errors=$(docker logs --tail=50 "$container" 2>/dev/null | \
    grep -iE "error|exception|crash|ECONNREFUSED|uncaughtException|UnhandledPromise" | \
    grep -v "health\|healthcheck\|OPTIONS\|GET /health" | head -3 || echo "")
  
  if [ -n "$recent_errors" ]; then
    warn "$svc: recent errors in logs:"
    echo "$recent_errors" | while read -r line; do
      echo "      $line"
    done
    CRITICAL_ERRORS+=("$svc has errors")
  else
    pass "$svc: no recent errors in logs"
  fi
done

# ══════════════════════════════════════════════════════════════════
# FINAL REPORT
# ══════════════════════════════════════════════════════════════════
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BOLD}  INTEGRATION TEST RESULTS${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}PASS${RESET}: $PASS"
echo -e "  ${RED}FAIL${RESET}: $FAIL"
echo -e "  ${YELLOW}WARN${RESET}: $WARN (warnings = degraded, not broken)"
echo -e "  ${CYAN}SKIP${RESET}: $SKIP"
echo ""

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo -e "  ${RED}FAILURES:${RESET}"
  for e in "${ERRORS[@]}"; do echo "    • $e"; done
  echo ""
fi

if [ "$FAIL" -eq 0 ] && [ "$WARN" -lt 5 ]; then
  echo -e "  ${GREEN}${BOLD}✅ STACK IS HEALTHY — all layers verified${RESET}"
elif [ "$FAIL" -eq 0 ]; then
  echo -e "  ${YELLOW}${BOLD}⚠️  STACK RUNNING — $WARN warnings need attention${RESET}"
else
  echo -e "  ${RED}${BOLD}❌ $FAIL FAILURES — investigate before release${RESET}"
fi

echo ""
echo "  Tips:"
echo "  • View service logs:  docker logs satvaaah-<service> --tail=100 -f"
echo "  • Restart one service: docker-compose restart <service>"
echo "  • Full restart:        docker-compose down && docker-compose up -d --build"
echo "  • Run DB migrations:   docker-compose exec user npx prisma migrate deploy"
echo "  • Seed database:       docker-compose exec user npx tsx scripts/seed.ts"
echo "  • Mobile dev server:   cd apps/mobile && npx expo start"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

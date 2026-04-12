#!/bin/bash
# =============================================================================
# SatvAAh — Clean Restart Script
# Stops all containers, restarts in correct order, verifies health.
# Run from repo root: bash restart.sh
# =============================================================================

set -e
REPO="$HOME/SatvaahFinalNew10-4-2026"
cd "$REPO"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; }

echo "======================================================"
echo "  SatvAAh — Clean Restart"
echo "  $(date)"
echo "======================================================"

# ── 1. Stop ALL running satvaaah containers ────────────────────────────────
echo ""
echo "▶ Stopping all satvaaah containers..."
docker ps --filter "name=satvaaah" -q | xargs -r docker stop 2>/dev/null || true
docker ps --filter "name=satvaaah" -q | xargs -r docker rm 2>/dev/null || true
ok "All containers stopped and removed"

# ── 2. Start infrastructure (postgres, redis, opensearch, localstack) ──────
echo ""
echo "▶ Starting infrastructure..."
docker-compose -p satvaahfinal up -d postgres satvaaah-redis opensearch localstack

echo "  Waiting for postgres to be healthy..."
for i in $(seq 1 30); do
  if docker exec satvaaah-postgres psql -U satvaaah_user -d satvaaah -c "SELECT 1" -q --no-align -t 2>/dev/null | grep -q 1; then
    ok "Postgres healthy"
    break
  fi
  sleep 2
  if [ $i -eq 30 ]; then err "Postgres did not become healthy in 60s"; exit 1; fi
done

echo "  Waiting for redis to be healthy..."
for i in $(seq 1 20); do
  if docker exec satvaaah-redis redis-cli -a "${REDIS_PASSWORD:-S@tvAAh_Redis_S3cur3_2026!}" --no-auth-warning ping 2>/dev/null | grep -q PONG; then
    ok "Redis healthy"
    break
  fi
  sleep 2
  if [ $i -eq 20 ]; then warn "Redis not responding — continuing anyway (fail-open mode)"; break; fi
done

# ── 3. Run installer (pnpm install) ───────────────────────────────────────
echo ""
echo "▶ Running installer..."
docker-compose -p satvaahfinal up installer
ok "Installer complete"

# ── 4. Start all 7 microservices ──────────────────────────────────────────
echo ""
echo "▶ Starting microservices..."
docker-compose -p satvaahfinal up -d auth user search trust rating notification payment admin

echo "  Waiting 15s for services to initialise..."
sleep 15

# ── 5. Health check all services ──────────────────────────────────────────
echo ""
echo "▶ Checking service health..."
ALL_OK=true
for port_svc in "3001:auth" "3002:user" "3003:search" "3004:trust" "3005:rating" "3006:notification" "3007:payment"; do
  port="${port_svc%%:*}"
  svc="${port_svc##*:}"
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$port/health 2>/dev/null)
  if [ "$STATUS" = "200" ]; then
    ok "$svc (:$port) → 200"
  else
    err "$svc (:$port) → $STATUS"
    ALL_OK=false
  fi
done

if [ "$ALL_OK" = "false" ]; then
  err "Some services are not healthy. Check logs: docker logs satvaaah-<service>"
  exit 1
fi

# ── 6. Start gateway LAST (after all upstreams confirmed healthy) ──────────
echo ""
echo "▶ Starting gateway (nginx)..."
# Force recreate so it picks up fresh nginx.conf and fresh DNS
docker-compose -p satvaahfinal up -d --force-recreate gateway
sleep 3

# ── 7. Reload nginx to ensure fresh DNS resolution ────────────────────────
docker exec satvaaah-gateway nginx -s reload 2>/dev/null || true
sleep 2
ok "Gateway started and nginx reloaded"

# ── 8. Test gateway end-to-end ────────────────────────────────────────────
echo ""
echo "▶ Testing gateway end-to-end..."
RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:3000/api/v1/auth/firebase/verify \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"firebaseIdToken":"MOCK_FIREBASE_TOKEN_FOR_TESTING","phone":"+919000000001","mode":"consumer","consent_given":true}' \
  2>/dev/null)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
  ok "Gateway auth test → 200 ✅"
  echo "  JWT issued successfully"
elif [ "$HTTP_CODE" = "502" ]; then
  err "Gateway → 502 Bad Gateway"
  echo "  nginx error log:"
  docker logs satvaaah-gateway 2>&1 | grep "error" | tail -5
else
  warn "Gateway → $HTTP_CODE"
  echo "  Response: $BODY"
fi

# ── 9. Final status summary ───────────────────────────────────────────────
echo ""
echo "======================================================"
echo "  FINAL STATUS"
echo "======================================================"
docker ps --filter "name=satvaaah" --format "table {{.Names}}\t{{.Status}}" | grep -v "satvaaah-installer\|satvaaah-migrate"

echo ""
echo "  Gateway:   http://localhost:3000"
echo "  Auth:      http://localhost:3001/health"
echo "  Search:    http://localhost:3003/health"
echo ""
echo "  To start Expo:"
echo "  cd ~/SatvaahFinalNew10-4-2026/apps/mobile && npx expo start --clear"
echo "======================================================"

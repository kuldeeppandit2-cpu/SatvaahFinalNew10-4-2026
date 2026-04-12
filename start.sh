#!/bin/bash
# SatvAAh — clean start script
# Run this once: bash start.sh
# Everything comes up healthy in correct order

set -e
cd "$(dirname "$0")"

echo "══════════════════════════════════════════"
echo "  SatvAAh — Starting all services"
echo "══════════════════════════════════════════"

# Step 1 — infrastructure
echo "▶ Starting infrastructure (postgres, redis, opensearch, localstack)..."
docker-compose -p satvaahfinal up -d postgres redis opensearch localstack

echo "⏳ Waiting for postgres..."
until docker exec satvaaah-postgres pg_isready -U satvaaah_user -d satvaaah -q 2>/dev/null; do sleep 2; done
echo "  ✅ postgres ready"

echo "⏳ Waiting for redis..."
until docker exec satvaaah-redis redis-cli ping 2>/dev/null | grep -q PONG; do sleep 2; done
echo "  ✅ redis ready"

echo "⏳ Waiting for opensearch..."
until curl -sf http://localhost:9200/_cluster/health 2>/dev/null | grep -q '"status"'; do sleep 3; done
echo "  ✅ opensearch ready"

# Step 2 — core services
echo "▶ Starting core services..."
docker-compose -p satvaahfinal up -d auth user search trust rating notification payment admin

echo "⏳ Waiting for auth (port 3001)..."
until curl -sf http://localhost:3001/health 2>/dev/null | grep -q '"ok"'; do sleep 3; done
echo "  ✅ auth ready"

echo "⏳ Waiting for user (port 3002)..."
until curl -sf http://localhost:3002/health 2>/dev/null | grep -q '"ok"'; do sleep 3; done
echo "  ✅ user ready"

echo "⏳ Waiting for search (port 3003)..."
until curl -sf http://localhost:3003/health 2>/dev/null | grep -q '"ok"'; do sleep 5; done
echo "  ✅ search ready"

# Step 3 — gateway LAST (after all upstreams are ready)
echo "▶ Starting gateway..."
docker-compose -p satvaahfinal up -d gateway

echo "⏳ Waiting for gateway (port 3000)..."
until curl -sf http://localhost:3001/health 2>/dev/null | grep -q '"ok"'; do sleep 2; done
echo "  ✅ gateway ready"

echo ""
echo "══════════════════════════════════════════"
echo "  ✅ All services up. Run the app:"
echo "  cd apps/mobile && npx expo start --clear"
echo "══════════════════════════════════════════"
docker-compose -p satvaahfinal ps --format "table {{.Name}}\t{{.Status}}"

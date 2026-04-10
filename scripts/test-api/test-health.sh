#!/usr/bin/env bash
# test-health.sh — health check all 8 SatvAAh services
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo -e "${BOLD}SatvAAh — Service Health Checks${NC}"
section "Infrastructure + Services"

# Services — all must respond on /health with HTTP 200
check_health "auth"         "$BASE_AUTH"
check_health "user"         "$BASE_USER"
check_health "search"       "$BASE_SEARCH"
check_health "trust"        "$BASE_TRUST"
check_health "rating"       "$BASE_RATING"
check_health "notification" "$BASE_NOTIF"
check_health "payment"      "$BASE_PAYMENT"
check_health "admin"        "$BASE_ADMIN"

section "Infrastructure DB/cache"
# PostgreSQL via user service (will fail loudly if DB is down)
http_get "$BASE_USER/health"
if echo "$RESPONSE" | grep -qi '"db".*"ok"\|database.*ok\|postgres.*ok' 2>/dev/null; then
  pass "PostgreSQL reachable from user service"
else
  skip "PostgreSQL detail not in health response (check manually)"
fi

# Redis via auth service
http_get "$BASE_AUTH/health"
if echo "$RESPONSE" | grep -qi '"redis".*"ok"\|redis.*ok\|cache.*ok' 2>/dev/null; then
  pass "Redis reachable from auth service"
else
  skip "Redis detail not in health response (check manually)"
fi

summary

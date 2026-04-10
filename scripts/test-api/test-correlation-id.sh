#!/usr/bin/env bash
# SatvAAh — test-correlation-id.sh
# MASTER_CONTEXT Rule #25: X-Correlation-ID header on every request.
# Verifies services echo back X-Correlation-ID in response headers.

source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

SERVICES=(
  "auth:3001:/health"
  "user:3002:/health"
  "search:3003:/health"
  "trust:3004:/health"
  "rating:3005:/health"
  "notification:3006:/health"
  "payment:3007:/health"
  "admin:3009:/health"
)

TEST_CORR="satvaaah-test-corr-$(date +%s)"

for entry in "${SERVICES[@]}"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  port="${rest%%:*}"
  path="${rest##*:}"

  headers=$(curl -s -I \
    -H "X-Correlation-ID: ${TEST_CORR}" \
    "http://localhost:${port}${path}" 2>/dev/null)

  if echo "$headers" | grep -qi "x-correlation-id"; then
    pass "$name :$port — X-Correlation-ID in response"
  else
    fail "$name :$port — X-Correlation-ID MISSING from response headers"
  fi
done

suite_exit

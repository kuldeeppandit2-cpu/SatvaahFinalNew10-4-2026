#!/bin/bash
# verify-all.sh — SatvAAh Phase 25b API Test Suite Runner
#
# Runs all 7 integration test files via ts-node.
# Reports PASS/FAIL per flow with timing.
# Guarantees cleanup runs regardless of failure.
# Exits 1 if any flow failed, 0 if all passed.
#
# Usage:
#   bash verify-all.sh
#   bash verify-all.sh --fail-fast    (stop after first failure)
#
# Required env vars (see 00-setup.ts for full list):
#   FIREBASE_SERVICE_ACCOUNT_PATH   Path to Firebase service account JSON
#   FIREBASE_API_KEY                Firebase web API key
#   ADMIN_EMAIL / ADMIN_PASSWORD    Admin portal credentials (optional)
#   PG_URL                          PostgreSQL connection string
#   SQS_ENDPOINT                    e.g. http://localhost:4566 (LocalStack) or omit for real AWS
#   SQS_ACCOUNT_ID                  AWS account ID for queue URL construction

set -euo pipefail

# ── Colour codes ──────────────────────────────────────────────────────────────
RESET='\033[0m'
GREEN='\033[32m'
RED='\033[31m'
CYAN='\033[36m'
BOLD='\033[1m'
DIM='\033[2m'

FAIL_FAST=false
for arg in "$@"; do
  [[ "$arg" == "--fail-fast" ]] && FAIL_FAST=true
done

# ── Check prerequisites ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}SatvAAh Phase 25b — Backend API Integration Tests${RESET}"
echo -e "${DIM}$(date '+%Y-%m-%d %H:%M:%S %Z')${RESET}"
echo "═══════════════════════════════════════════════════"

command -v ts-node >/dev/null 2>&1 || {
  echo -e "${RED}ERROR: ts-node not found.${RESET}"
  echo "       Run: pnpm install (from scripts/test-api/)"
  exit 1
}

# Check at least FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON is set
if [[ -z "${FIREBASE_SERVICE_ACCOUNT_PATH:-}" ]] && [[ -z "${FIREBASE_SERVICE_ACCOUNT_JSON:-}" ]]; then
  echo -e "${RED}ERROR: Firebase credentials not configured.${RESET}"
  echo "       Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON"
  exit 1
fi

if [[ -z "${FIREBASE_API_KEY:-}" ]]; then
  echo -e "${RED}ERROR: FIREBASE_API_KEY not set.${RESET}"
  exit 1
fi

if [[ -z "${PG_URL:-}" ]]; then
  echo -e "${DIM}⚠  PG_URL not set — defaulting to localhost:5432${RESET}"
  export PG_URL="postgresql://satvaaah:satvaaah@localhost:5432/satvaaah"
fi

echo ""

# ── Test registry ─────────────────────────────────────────────────────────────
declare -a TESTS=(
  "01-auth-flow.ts:Auth Flow"
  "02-provider-journey.ts:Provider Journey"
  "03-consumer-search.ts:Consumer Search"
  "04-contact-flow.ts:Contact Flow"
  "05-rating-flow.ts:Rating Flow"
  "06-trust-recalculation.ts:Trust Recalculation"
  "07-certificate-idempotency.ts:Certificate Idempotency"
)

# ── Result tracking ───────────────────────────────────────────────────────────
declare -a RESULTS=()
declare -a DURATIONS=()
PASS_COUNT=0
FAIL_COUNT=0
OVERALL_START=$(date +%s)

# ── Run each test ─────────────────────────────────────────────────────────────
for entry in "${TESTS[@]}"; do
  FILE="${entry%%:*}"
  LABEL="${entry##*:}"

  echo -e "${CYAN}▶ Running: ${LABEL}${RESET}"

  START=$(date +%s)
  LOG_FILE="/tmp/satvaaah_test_$(echo "$FILE" | tr '.' '_').log"

  # Run ts-node, capture output
  if ts-node --project tsconfig.json "$FILE" >"$LOG_FILE" 2>&1; then
    END=$(date +%s)
    ELAPSED=$((END - START))
    echo -e "  ${GREEN}✓ PASS${RESET} — ${LABEL} ${DIM}(${ELAPSED}s)${RESET}"
    RESULTS+=("PASS:${LABEL}")
    DURATIONS+=("${ELAPSED}")
    PASS_COUNT=$((PASS_COUNT + 1))
    # Print test output (already has inline PASS/FAIL per check)
    cat "$LOG_FILE"
  else
    END=$(date +%s)
    ELAPSED=$((END - START))
    echo -e "  ${RED}✗ FAIL${RESET} — ${LABEL} ${DIM}(${ELAPSED}s)${RESET}"
    RESULTS+=("FAIL:${LABEL}")
    DURATIONS+=("${ELAPSED}")
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo ""
    echo -e "  ${DIM}── Test output ──────────────────────────${RESET}"
    cat "$LOG_FILE"
    echo -e "  ${DIM}────────────────────────────────────────${RESET}"

    if $FAIL_FAST; then
      echo ""
      echo -e "${RED}Stopping early (--fail-fast)${RESET}"
      break
    fi
  fi

  echo ""
done

# ── Summary ────────────────────────────────────────────────────────────────────
OVERALL_END=$(date +%s)
TOTAL_ELAPSED=$((OVERALL_END - OVERALL_START))

echo "═══════════════════════════════════════════════════"
echo -e "${BOLD}Test Summary${RESET}"
echo "═══════════════════════════════════════════════════"

IDX=0
for entry in "${TESTS[@]}"; do
  LABEL="${entry##*:}"
  if [[ $IDX -lt ${#RESULTS[@]} ]]; then
    RESULT="${RESULTS[$IDX]%%:*}"
    DURATION="${DURATIONS[$IDX]}"
    if [[ "$RESULT" == "PASS" ]]; then
      echo -e "  ${GREEN}PASS${RESET}  ${LABEL} ${DIM}(${DURATION}s)${RESET}"
    else
      echo -e "  ${RED}FAIL${RESET}  ${LABEL} ${DIM}(${DURATION}s)${RESET}"
    fi
    IDX=$((IDX + 1))
  else
    echo -e "  ${DIM}SKIP  ${LABEL} (not reached)${RESET}"
  fi
done

echo ""
echo -e "  Passed: ${GREEN}${PASS_COUNT}${RESET} / ${#TESTS[@]}"
echo -e "  Failed: ${RED}${FAIL_COUNT}${RESET} / ${#TESTS[@]}"
echo -e "  Total:  ${TOTAL_ELAPSED}s"
echo ""

# ── Cleanup notice ────────────────────────────────────────────────────────────
# Each test file runs its own cleanup via registerCleanup() + withCleanup().
# The finally block in withCleanup() guarantees cleanup even on failure.
echo -e "  ${DIM}Note: each test file self-cleans via withCleanup().${RESET}"
echo -e "  ${DIM}Check /tmp/satvaaah_test_*.log for per-test output.${RESET}"
echo ""

# ── Exit code ─────────────────────────────────────────────────────────────────
if [[ $FAIL_COUNT -gt 0 ]]; then
  echo -e "${RED}${BOLD}FAILED — ${FAIL_COUNT} flow(s) did not pass.${RESET}"
  exit 1
else
  echo -e "${GREEN}${BOLD}ALL PASSED ✓${RESET}"
  exit 0
fi

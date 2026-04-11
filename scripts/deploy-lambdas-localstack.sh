#!/bin/bash
# =============================================================================
# scripts/deploy-lambdas-localstack.sh
#
# Builds every Lambda, packages it as a zip, and registers it with LocalStack.
# Also wires SQS event source mappings so each Lambda triggers from its queue.
#
# Pre-requisites (must all be running):
#   docker-compose up -d localstack postgres
#   bash scripts/localstack-init/01-create-queues.sh   (creates the SQS queues)
#
# Usage:
#   bash scripts/deploy-lambdas-localstack.sh            # deploy all
#   bash scripts/deploy-lambdas-localstack.sh trust      # deploy one Lambda
#
# What each Lambda does / which DBs it turns green:
#   BG1 trust-recalculate   → DB4 DB10 DB18 DB19  (trust scores + history + certs)
#   BG2 opensearch-sync     → DB8  DB-EXT-B        (OpenSearch index + sync log)
#   BG3 push-discovery      → DB7                  (search intents acted on)
#   BG4 delivery-monitor    → DB12                 (notification delivery status)
#   BG5 (scraper — python, not Lambda — runs separately)
#   + certificate-generator, anonymisation, outreach-scheduler, ratings-refresh
# =============================================================================

set -euo pipefail

ENDPOINT="http://localhost:4566"
REGION="ap-south-1"
ACCOUNT="000000000000"
ROLE="arn:aws:iam::${ACCOUNT}:role/lambda-role"

# LocalStack queue base URL
Q="http://localhost:4566/${ACCOUNT}"

# Colour helpers
GREEN="\033[0;32m"; AMBER="\033[0;33m"; RED="\033[0;31m"; NC="\033[0m"
ok()   { echo -e "${GREEN}  ✅ $*${NC}"; }
warn() { echo -e "${AMBER}  ⚠️  $*${NC}"; }
err()  { echo -e "${RED}  ❌ $*${NC}"; }
step() { echo -e "\n${GREEN}▶ $*${NC}"; }

# ── Helpers ───────────────────────────────────────────────────────────────────

check_localstack() {
  step "Checking LocalStack health..."
  if ! curl -sf "${ENDPOINT}/_localstack/health" > /dev/null 2>&1; then
    err "LocalStack not reachable at ${ENDPOINT}"
    echo "  Run: docker-compose up -d localstack && sleep 10"
    exit 1
  fi
  ok "LocalStack is up"
}

ensure_lambda_role() {
  step "Ensuring IAM role exists in LocalStack..."
  aws --endpoint-url="${ENDPOINT}" --region="${REGION}" iam create-role \
    --role-name lambda-role \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    2>/dev/null && ok "Created lambda-role" || ok "lambda-role already exists"
}

build_lambda() {
  local name="$1"
  local dir="lambdas/${name}"
  local zip_path="/tmp/lambda-${name}.zip"

  step "Building ${name}..."

  if [ ! -f "${dir}/package.json" ]; then
    err "${dir}/package.json not found — skipping"
    return 1
  fi

  # Use Docker node:18 to install deps and compile TypeScript
  # This avoids needing local node_modules or tsc installed on host
  docker run --rm \
    -v "$(pwd)/${dir}:/app" \
    -v "$(pwd)/tsconfig.base.json:/tsconfig.base.json:ro" \
    -w /app \
    node:18-alpine \
    sh -c "
      # Create tsconfig if missing
      if [ ! -f tsconfig.json ]; then
        cat > tsconfig.json << 'TSEOF'
{
  \"compilerOptions\": {
    \"target\": \"ES2020\",
    \"module\": \"CommonJS\",
    \"lib\": [\"ES2020\"],
    \"outDir\": \"./dist\",
    \"rootDir\": \"./\",
    \"strict\": false,
    \"esModuleInterop\": true,
    \"skipLibCheck\": true,
    \"resolveJsonModule\": true
  },
  \"include\": [\"index.ts\"],
  \"exclude\": [\"dist\", \"node_modules\"]
}
TSEOF
      fi
      # Install deps
      npm install --quiet 2>/dev/null
      # Compile
      npx tsc 2>/dev/null || npx tsc --skipLibCheck 2>/dev/null || {
        echo 'tsc failed, trying direct transpile...'
        npx tsc --noEmit false --skipLibCheck --strict false index.ts --outDir dist 2>/dev/null || true
      }
      echo 'Build done'
    " && ok "Built: ${name}" || { err "Docker build failed for ${name}"; return 1; }

  # Check dist was created
  if [ ! -d "${dir}/dist" ] || [ -z "$(ls -A ${dir}/dist 2>/dev/null)" ]; then
    err "No dist/ output for ${name} — TypeScript compilation failed"
    return 1
  fi

  # Create zip with dist + node_modules
  rm -f "${zip_path}"
  (cd "${dir}" && zip -r "${zip_path}" dist/ node_modules/ package.json \
    -x "*.test.*" "*.spec.*" "node_modules/.cache/*" 2>/dev/null)
  ok "Zip: ${zip_path} ($(du -sh "${zip_path}" | cut -f1))"
  echo "${zip_path}"
}

deploy_lambda() {
  local name="$1"
  local zip_path="$2"
  local handler="${3:-dist/index.handler}"
  local env_vars="${4:-{}}"

  step "Deploying Lambda: ${name}..."

  # Try update first, create if not exists
  if aws --endpoint-url="${ENDPOINT}" --region="${REGION}" lambda update-function-code \
    --function-name "${name}" \
    --zip-file "fileb://${zip_path}" \
    --query 'FunctionName' --output text 2>/dev/null; then
    ok "Updated: ${name}"
  else
    aws --endpoint-url="${ENDPOINT}" --region="${REGION}" lambda create-function \
      --function-name "${name}" \
      --runtime nodejs18.x \
      --role "${ROLE}" \
      --handler "${handler}" \
      --zip-file "fileb://${zip_path}" \
      --timeout 300 \
      --memory-size 512 \
      --environment "Variables=${env_vars}" \
      --query 'FunctionName' --output text 2>/dev/null \
      && ok "Created: ${name}" \
      || { err "Failed to deploy ${name}"; return 1; }
  fi

  # Update env vars if provided
  if [ "${env_vars}" != "{}" ]; then
    aws --endpoint-url="${ENDPOINT}" --region="${REGION}" lambda update-function-configuration \
      --function-name "${name}" \
      --environment "Variables=${env_vars}" \
      --query 'FunctionName' --output text 2>/dev/null && ok "Env vars updated"
  fi
}

wire_sqs_trigger() {
  local function_name="$1"
  local queue_name="$2"
  local batch_size="${3:-10}"

  local queue_arn="arn:aws:sqs:${REGION}:${ACCOUNT}:${queue_name}.fifo"

  step "Wiring SQS trigger: ${queue_name} → ${function_name}..."

  # Check if mapping already exists
  local existing
  existing=$(aws --endpoint-url="${ENDPOINT}" --region="${REGION}" \
    lambda list-event-source-mappings \
    --function-name "${function_name}" \
    --event-source-arn "${queue_arn}" \
    --query 'EventSourceMappings[0].UUID' --output text 2>/dev/null || echo "None")

  if [ "${existing}" != "None" ] && [ -n "${existing}" ]; then
    ok "SQS trigger already wired (UUID: ${existing})"
    return 0
  fi

  aws --endpoint-url="${ENDPOINT}" --region="${REGION}" \
    lambda create-event-source-mapping \
    --function-name "${function_name}" \
    --event-source-arn "${queue_arn}" \
    --batch-size "${batch_size}" \
    --maximum-batching-window-in-seconds 5 \
    --query 'UUID' --output text 2>/dev/null \
    && ok "SQS trigger wired" \
    || warn "SQS trigger wire failed (queue may not exist yet — run 01-create-queues.sh first)"
}

# ── Environment variable sets for each Lambda ─────────────────────────────────

DB_URL="${DATABASE_URL:-postgresql://satvaaah_user:S@tvAAh_PG_S3cur3_P@ssw0rd_2026!@localhost:5432/satvaaah?schema=public}"
OS_URL="${OPENSEARCH_URL:-http://localhost:9200}"
REDIS_URL_VAL="${REDIS_URL:-redis://localhost:6379}"

env_trust() {
  # DB4 DB10 DB18 DB19 — trust recalculation
  echo "{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\",\"PUSH_DISCOVERY_QUEUE_URL\":\"${Q}/satvaaah-push-discovery.fifo\",\"CERTIFICATE_GENERATOR_QUEUE_URL\":\"${Q}/satvaaah-certificate-generate.fifo\"}"
}

env_opensearch() {
  # DB8 DB-EXT-B — OpenSearch sync
  echo "{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\",\"OPENSEARCH_ENDPOINT\":\"${OS_URL}\",\"OPENSEARCH_INDEX\":\"satvaaah_providers\"}"
}

env_push() {
  # DB7 — push discovery (needs Firebase — stub values for dev)
  local fb_proj="${FIREBASE_PROJECT_ID:-satvaahfinal-dev}"
  local fb_email="${FIREBASE_CLIENT_EMAIL:-dev@satvaahfinal-dev.iam.gserviceaccount.com}"
  local fb_key="${FIREBASE_PRIVATE_KEY:-dev-placeholder-key}"
  echo "{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\",\"FIREBASE_PROJECT_ID\":\"${fb_proj}\",\"FIREBASE_CLIENT_EMAIL\":\"${fb_email}\",\"FIREBASE_PRIVATE_KEY\":\"${fb_key}\"}"
}

env_delivery() {
  # DB12 — notification delivery monitor
  echo "{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\",\"GUPSHUP_API_KEY\":\"${GUPSHUP_API_KEY:-dev-stub}\",\"GUPSHUP_APP_NAME\":\"${GUPSHUP_APP_NAME:-satvaaah}\",\"GUPSHUP_SOURCE_PHONE\":\"${GUPSHUP_SOURCE_PHONE:-+919999999999}\"}"
}

env_cert() {
  echo "{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\"}"
}

env_anon() {
  echo "{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\"}"
}

env_outreach() {
  echo "{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\"}"
}

env_ratings() {
  echo "{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\"}"
}

# ── Deploy sequence ───────────────────────────────────────────────────────────

TARGET="${1:-all}"

deploy_bg1() {
  step "=== BG1: trust-recalculate → DB4 DB10 DB18 DB19 ==="
  local zip; zip=$(build_lambda "trust-recalculate")
  deploy_lambda "satvaaah-trust-recalculate" "${zip}" "dist/index.handler" "$(env_trust)"
  wire_sqs_trigger "satvaaah-trust-recalculate" "satvaaah-trust-score-updates"
  ok "BG1 deployed — purge queue before first run:"
  echo "    awslocal sqs purge-queue --queue-url ${Q}/satvaaah-trust-score-updates.fifo"
}

deploy_bg2() {
  step "=== BG2: opensearch-sync → DB8 DB-EXT-B ==="
  local zip; zip=$(build_lambda "opensearch-sync")
  deploy_lambda "satvaaah-opensearch-sync" "${zip}" "dist/index.handler" "$(env_opensearch)"
  wire_sqs_trigger "satvaaah-opensearch-sync" "satvaaah-opensearch-sync"
  ok "BG2 deployed — run admin resync after:"
  echo "    curl -X POST http://localhost:3009/api/v1/admin/opensearch/resync -H 'Authorization: Bearer \$ADMIN_TOKEN'"
}

deploy_bg3() {
  step "=== BG3: push-discovery → DB7 ==="
  local zip; zip=$(build_lambda "push-discovery")
  deploy_lambda "satvaaah-push-discovery" "${zip}" "dist/index.handler" "$(env_push)"
  wire_sqs_trigger "satvaaah-push-discovery" "satvaaah-push-discovery"
  ok "BG3 deployed — triggered automatically by BG1 when provider score ≥ 80"
}

deploy_bg4() {
  step "=== BG4: delivery-monitor → DB12 ==="
  local zip; zip=$(build_lambda "delivery-monitor")
  deploy_lambda "satvaaah-delivery-monitor" "${zip}" "dist/index.handler" "$(env_delivery)"
  # BG4 is EventBridge-triggered (rate 15 min) — in LocalStack dev, invoke manually:
  ok "BG4 deployed — invoke manually in dev (EventBridge not in LocalStack free tier):"
  echo "    awslocal lambda invoke --function-name satvaaah-delivery-monitor /tmp/bg4-out.json"
}

deploy_support() {
  step "=== Support Lambdas: certificate-generator, anonymisation, outreach-scheduler, ratings-refresh ==="
  for name in certificate-generator anonymisation outreach-scheduler ratings-refresh; do
    local zip; zip=$(build_lambda "${name}")
    deploy_lambda "satvaaah-${name}" "${zip}" "dist/index.handler" "$(env_cert)"
    ok "${name} deployed"
  done
  wire_sqs_trigger "satvaaah-certificate-generator" "satvaaah-certificate-generate"
  wire_sqs_trigger "satvaaah-outreach-scheduler"    "satvaaah-outreach-schedule"
}

# ── Main ──────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║    SatvAAh Lambda Deploy → LocalStack                       ║"
echo "║    Target: ${TARGET}                                         ║"
echo "╚══════════════════════════════════════════════════════════════╝"

check_localstack
ensure_lambda_role

case "${TARGET}" in
  trust|bg1)   deploy_bg1 ;;
  opensearch|bg2) deploy_bg2 ;;
  push|bg3)    deploy_bg3 ;;
  delivery|bg4) deploy_bg4 ;;
  support)     deploy_support ;;
  all)
    deploy_bg1
    deploy_bg2
    deploy_bg3
    deploy_bg4
    deploy_support
    ;;
  *)
    err "Unknown target: ${TARGET}"
    echo "  Usage: $0 [all|trust|opensearch|push|delivery|support]"
    exit 1
    ;;
esac

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Deploy complete. Next steps:                                ║"
echo "║  1. Run V050 + V051 migrations against live DB               ║"
echo "║  2. Run pnpm --filter @satvaaah/db generate                  ║"
echo "║  3. Purge SQS then submit a test rating → verify DB4 updated ║"
echo "║  4. POST /admin/opensearch/resync → verify DB8 populated     ║"
echo "║  5. Enable Redis: docker-compose up -d redis                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"

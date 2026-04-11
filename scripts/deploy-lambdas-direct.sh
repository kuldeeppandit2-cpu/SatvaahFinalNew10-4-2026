#!/bin/bash
# =============================================================================
# scripts/deploy-lambdas-direct.sh
#
# Deploys Lambdas one at a time, inline, no background processes.
# Every step prints its result before moving to the next.
# Run from repo root: bash scripts/deploy-lambdas-direct.sh
# =============================================================================

set -euo pipefail

ENDPOINT="http://localhost:4566"
REGION="ap-south-1"
ACCOUNT="000000000000"
Q="${ENDPOINT}/${ACCOUNT}"
DB_URL="postgresql://satvaaah_user:S@tvAAh_PG_S3cur3_P@ssw0rd_2026!@localhost:5432/satvaaah?schema=public"
ROLE="arn:aws:iam::${ACCOUNT}:role/lambda-role"

echo ""
echo "=========================================="
echo " SatvAAh Lambda Deploy — Direct Mode"
echo "=========================================="

# ── Check LocalStack ──────────────────────────────────────────────────────────
echo ""
echo "STEP 1: Checking LocalStack..."
if ! curl -sf "${ENDPOINT}/_localstack/health" > /dev/null 2>&1; then
  echo "ERROR: LocalStack not running. Run: docker-compose -p satvaahfinal up -d localstack"
  exit 1
fi
echo "OK: LocalStack is up"

# ── Ensure IAM role ───────────────────────────────────────────────────────────
echo ""
echo "STEP 2: Ensuring IAM role..."
aws --endpoint-url="${ENDPOINT}" --region="${REGION}" iam create-role \
  --role-name lambda-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  --output text --query 'Role.RoleName' 2>/dev/null && echo "OK: Created lambda-role" \
  || echo "OK: lambda-role already exists"

# ── Build function ────────────────────────────────────────────────────────────
build_one() {
  local name="$1"
  local zip="/tmp/lambda-${name}.zip"

  echo ""
  echo "------------------------------------------"
  echo "BUILDING: ${name}"
  echo "------------------------------------------"

  if [ -f "${zip}" ]; then
    echo "OK: Zip already exists at ${zip} — skipping build"
    return 0
  fi

  local dir="lambdas/${name}"

  # Write tsconfig
  cat > "${dir}/tsconfig.json" << 'TSEOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "outDir": "./dist",
    "rootDir": "./",
    "strict": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["index.ts"],
  "exclude": ["dist", "node_modules"]
}
TSEOF

  # Build inside Docker (inline — no background)
  echo "  Running npm install + tsc in Docker..."
  docker run --rm \
    -v "$(pwd)/${dir}:/app" \
    -w /app \
    node:18-alpine \
    sh -c "npm install --quiet 2>&1 | tail -3 && npx tsc 2>&1 && echo 'COMPILE_OK'" \
    | grep -E "COMPILE_OK|error|Error|warn|npm" | head -10

  if [ ! -d "${dir}/dist" ]; then
    echo "ERROR: dist/ not created for ${name}"
    return 1
  fi

  # Zip
  echo "  Creating zip..."
  rm -f "${zip}"
  (cd "${dir}" && zip -r "${zip}" dist/ node_modules/ package.json \
    -x "*.test.*" "*.spec.*" > /dev/null 2>&1)
  echo "OK: ${zip} ($(du -sh "${zip}" | cut -f1))"
}

# ── Deploy function ───────────────────────────────────────────────────────────
deploy_one() {
  local name="$1"
  local env_vars="$2"
  local zip="/tmp/lambda-${name}.zip"

  echo ""
  echo "DEPLOYING: satvaaah-${name}"

  if [ ! -f "${zip}" ]; then
    echo "ERROR: No zip at ${zip} — build failed"
    return 1
  fi

  # Try update first, then create
  local result
  result=$(aws --endpoint-url="${ENDPOINT}" --region="${REGION}" \
    lambda update-function-code \
    --function-name "satvaaah-${name}" \
    --zip-file "fileb://${zip}" \
    --output text --query 'FunctionName' 2>/dev/null) \
  && echo "OK: Updated satvaaah-${name}" \
  || result=$(aws --endpoint-url="${ENDPOINT}" --region="${REGION}" \
    lambda create-function \
    --function-name "satvaaah-${name}" \
    --runtime nodejs18.x \
    --role "${ROLE}" \
    --handler dist/index.handler \
    --zip-file "fileb://${zip}" \
    --timeout 300 \
    --memory-size 512 \
    --environment "Variables=${env_vars}" \
    --output text --query 'FunctionName' 2>&1) \
  && echo "OK: Created satvaaah-${name}" \
  || { echo "ERROR deploying satvaaah-${name}: ${result}"; return 1; }
}

# ── Wire SQS trigger ──────────────────────────────────────────────────────────
wire_one() {
  local fname="$1"
  local qname="$2"
  local qarn="arn:aws:sqs:${REGION}:${ACCOUNT}:${qname}.fifo"

  echo "  Wiring SQS: ${qname} -> satvaaah-${fname}"
  aws --endpoint-url="${ENDPOINT}" --region="${REGION}" \
    lambda create-event-source-mapping \
    --function-name "satvaaah-${fname}" \
    --event-source-arn "${qarn}" \
    --batch-size 10 \
    --output text --query 'UUID' 2>/dev/null \
  && echo "OK: SQS trigger wired" \
  || echo "OK: SQS trigger already exists"
}

# ── ENV VAR SETS ──────────────────────────────────────────────────────────────
ENV_TRUST="{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\",\"PUSH_DISCOVERY_QUEUE_URL\":\"${Q}/satvaaah-push-discovery.fifo\",\"CERTIFICATE_GENERATOR_QUEUE_URL\":\"${Q}/satvaaah-certificate-generate.fifo\"}"

ENV_OS="{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\",\"OPENSEARCH_ENDPOINT\":\"http://localhost:9200\",\"OPENSEARCH_INDEX\":\"satvaaah_providers\"}"

ENV_PUSH="{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\",\"FIREBASE_PROJECT_ID\":\"dev\",\"FIREBASE_CLIENT_EMAIL\":\"dev@dev.com\",\"FIREBASE_PRIVATE_KEY\":\"dev\"}"

ENV_BASE="{\"DATABASE_URL\":\"${DB_URL}\",\"AWS_REGION\":\"${REGION}\",\"AWS_ACCESS_KEY_ID\":\"test\",\"AWS_SECRET_ACCESS_KEY\":\"test\",\"AWS_ENDPOINT_URL\":\"${ENDPOINT}\"}"

# ── MAIN: Build + Deploy each Lambda ─────────────────────────────────────────

echo ""
echo "=========================================="
echo " Phase 1: Build all Lambdas"
echo "=========================================="

build_one "trust-recalculate"
build_one "opensearch-sync"
build_one "push-discovery"
build_one "delivery-monitor"
build_one "certificate-generator"
build_one "anonymisation"
build_one "outreach-scheduler"
build_one "ratings-refresh"

echo ""
echo "=========================================="
echo " Phase 2: Deploy all Lambdas"
echo "=========================================="

deploy_one "trust-recalculate"    "${ENV_TRUST}"
wire_one   "trust-recalculate"    "satvaaah-trust-score-updates"

deploy_one "opensearch-sync"      "${ENV_OS}"
wire_one   "opensearch-sync"      "satvaaah-opensearch-sync"

deploy_one "push-discovery"       "${ENV_PUSH}"
wire_one   "push-discovery"       "satvaaah-push-discovery"

deploy_one "delivery-monitor"     "${ENV_BASE}"
deploy_one "certificate-generator" "${ENV_BASE}"
wire_one   "certificate-generator" "satvaaah-certificate-generate"

deploy_one "anonymisation"        "${ENV_BASE}"
deploy_one "outreach-scheduler"   "${ENV_BASE}"
wire_one   "outreach-scheduler"   "satvaaah-outreach-schedule"

deploy_one "ratings-refresh"      "${ENV_BASE}"

echo ""
echo "=========================================="
echo " Phase 3: Verify"
echo "=========================================="
echo ""
echo "Registered Lambdas:"
aws --endpoint-url="${ENDPOINT}" --region="${REGION}" \
  lambda list-functions \
  --output text --query 'Functions[*].FunctionName' 2>/dev/null \
  | tr '\t' '\n' | sort

echo ""
echo "DONE. Check output above for any ERRORs."

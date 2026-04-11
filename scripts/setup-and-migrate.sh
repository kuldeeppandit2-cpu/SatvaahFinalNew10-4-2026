#!/bin/bash
# =============================================================================
# scripts/setup-and-migrate.sh
#
# Run from repo root: bash scripts/setup-and-migrate.sh
#
# Does in order:
#   1. Creates .env from .env.example if missing
#   2. Starts postgres + waits for it to be healthy
#   3. Runs V050 migration  (geo fields + slot tables)
#   4. Runs V051 migration  (consumer_lead_usage FK fix)
#   5. Runs prisma generate (fixes schema drift in Prisma client)
#   6. Starts localstack + creates SQS queues
#   7. Starts redis
# =============================================================================

set -euo pipefail

GREEN="\033[0;32m"; AMBER="\033[0;33m"; RED="\033[0;31m"; NC="\033[0m"
ok()   { echo -e "${GREEN}  ✅ $*${NC}"; }
warn() { echo -e "${AMBER}  ⚠️  $*${NC}"; }
err()  { echo -e "${RED}  ❌ $*${NC}"; exit 1; }
step() { echo -e "\n${GREEN}▶ $*${NC}"; }

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║    SatvAAh — setup-and-migrate.sh                           ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ── Step 1: Create .env if missing ───────────────────────────────────────────
step "Step 1: Checking .env..."
if [ ! -f ".env" ]; then
  cp .env.example .env
  ok ".env created from .env.example"
  warn "Review .env and fill in real secrets before production."
else
  ok ".env already exists"
fi

# Load env vars so docker-compose stops warning
set -a
source .env
set +a
ok "Env vars loaded"

# ── Step 2: Start postgres ────────────────────────────────────────────────────
step "Step 2: Starting postgres..."
docker-compose up -d postgres
ok "postgres container started"

echo "  Waiting for postgres to be healthy..."
for i in $(seq 1 30); do
  if docker-compose exec -T postgres psql \
      -U "${POSTGRES_USER:-satvaaah_user}" \
      -d "${POSTGRES_DB:-satvaaah}" \
      -c "SELECT 1" -q --no-align -t 2>/dev/null | grep -q 1; then
    ok "postgres is ready (${i}s)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    err "postgres did not become healthy after 30s. Check: docker-compose logs postgres"
  fi
  sleep 1
  echo -n "."
done

# ── Step 3: Run V050 migration ────────────────────────────────────────────────
step "Step 3: Running V050 migration (geo fields + slot tables)..."
docker-compose exec -T postgres psql \
  -U "${POSTGRES_USER:-satvaaah_user}" \
  -d "${POSTGRES_DB:-satvaaah}" \
  -v ON_ERROR_STOP=1 \
  < packages/db/prisma/migrations/V050_schema_additions/migration.sql \
  && ok "V050 applied — DB2 DB3 DB-V050-A DB-V050-B ready" \
  || err "V050 failed. Check output above."

# ── Step 4: Run V051 migration ────────────────────────────────────────────────
step "Step 4: Running V051 migration (consumer_lead_usage FK)..."
docker-compose exec -T postgres psql \
  -U "${POSTGRES_USER:-satvaaah_user}" \
  -d "${POSTGRES_DB:-satvaaah}" \
  -v ON_ERROR_STOP=1 \
  < packages/db/prisma/migrations/V051_align_consumer_lead_usage_fk/migration.sql \
  && ok "V051 applied — DB21 FK aligned" \
  || err "V051 failed. Check output above."

# ── Step 5: Prisma generate ───────────────────────────────────────────────────
step "Step 5: Running prisma generate (fixes V048 + V049 schema drift)..."
pnpm --filter @satvaaah/db db:generate \
  && ok "Prisma client regenerated — DB6 DB23 ORM drift fixed" \
  || err "prisma generate failed."

# ── Step 6: Start LocalStack + create SQS queues ─────────────────────────────
step "Step 6: Starting LocalStack..."
docker-compose up -d localstack
ok "LocalStack container started"

echo "  Waiting for LocalStack to be healthy..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:4566/_localstack/health" > /dev/null 2>&1; then
    ok "LocalStack is ready (${i}s)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    warn "LocalStack not ready after 30s — skipping queue creation. Run manually:"
    warn "  bash scripts/localstack-init/01-create-queues.sh"
    break
  fi
  sleep 1
  echo -n "."
done

if curl -sf "http://localhost:4566/_localstack/health" > /dev/null 2>&1; then
  bash scripts/localstack-init/01-create-queues.sh \
    && ok "SQS queues created" \
    || warn "Queue creation had errors — check above"
fi

# ── Step 7: Start Redis ───────────────────────────────────────────────────────
step "Step 7: Starting Redis..."
docker-compose up -d redis
ok "Redis container started — R1 R2 R3 now active"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Migrations done. What to do next:                          ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Deploy Lambdas (turns DB4 DB7 DB8 DB10 DB12 DB18 DB19      ║"
echo "║  DB-EXT-B green):                                           ║"
echo "║    bash scripts/deploy-lambdas-localstack.sh                ║"
echo "║                                                              ║"
echo "║  Then purge SQS + submit a test rating to verify BG1:       ║"
echo "║    docker-compose exec localstack awslocal sqs purge-queue  ║"
echo "║      --queue-url http://localhost:4566/000000000000/         ║"
echo "║        satvaaah-trust-score-updates.fifo                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"

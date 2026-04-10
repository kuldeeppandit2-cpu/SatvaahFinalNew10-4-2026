#!/bin/sh
# docker-migrate.sh — Runs SQL migrations ONLY.
# Prisma client generation is handled by each service in docker-start.sh.
set -e

echo "[migrate] Installing pg dependency..."
npm install --prefix /tmp/migrate-deps pg 2>&1 | tail -3
export NODE_PATH=/tmp/migrate-deps/node_modules
echo "[migrate] pg installed"

echo "[migrate] Waiting for postgres to accept connections..."
# pg_isready passes before network port is fully bound - retry actual connection
RETRIES=30
until node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -eq 0 ]; then
    echo "[migrate] FATAL: postgres not reachable after 30 retries"
    exit 1
  fi
  echo "[migrate] Postgres not ready, retrying in 2s... ($RETRIES left)"
  sleep 2
done
echo "[migrate] Postgres connection confirmed"

echo "[migrate] Running database migrations..."
cd /workspace
node scripts/run-migrations.js

echo "[migrate] SQL migrations complete."

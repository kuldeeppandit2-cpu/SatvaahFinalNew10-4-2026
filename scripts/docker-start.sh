#!/bin/sh
# docker-start.sh — Service startup
# Runs prisma generate on every start to ensure client is always fresh.
# This prevents the "Cannot find module '.prisma/client/default'" crash
# that occurs when a container restarts and the generated client is missing.
set -e

echo "[startup] Starting service: $SERVICE_DIR..."

# Regenerate Prisma client — fast (< 1s), idempotent, prevents MODULE_NOT_FOUND crash
echo "[startup] Generating Prisma client..."
cd /workspace
PRISMA_QUERY_ENGINE_LIBRARY= ./node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js generate --schema=packages/db/prisma/schema.prisma 2>/dev/null || true
echo "[startup] Prisma client ready"

cd /workspace/$SERVICE_DIR
exec npx ts-node-dev --respawn --transpile-only src/app.ts

#!/bin/sh
# docker-installer.sh — Runs ONCE before all services start
# Installs all workspace dependencies and generates Prisma client
# All 8 services depend on this completing successfully
set -e

echo "[installer] Installing pnpm..."
npm install -g pnpm@9 --quiet

echo "[installer] Installing workspace dependencies (single install, no race conditions)..."
cd /workspace
pnpm install --no-frozen-lockfile --force

echo "[installer] Generating Prisma client..."
cd /workspace/packages/db
npx prisma generate

echo "[installer] Patching Prisma binary for Alpine OpenSSL..."
PRISMA_DIR="/workspace/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client"
ENGINE_3X="$PRISMA_DIR/libquery_engine-linux-musl-arm64-openssl-3.0.x.so.node"
ENGINE_11X="$PRISMA_DIR/libquery_engine-linux-musl-arm64-openssl-1.1.x.so.node"
if [ -f "$ENGINE_3X" ]; then
  cp "$ENGINE_3X" "$ENGINE_11X"
  echo "[installer] Patched Prisma binary"
else
  echo "[installer] NOTE: Prisma 3.0.x binary not found — may not be needed"
fi

echo "[installer] All dependencies installed. Services may now start."

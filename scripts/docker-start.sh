#!/bin/sh
# docker-start.sh — Service startup
# pnpm install and prisma generate are handled by the installer service
# This script only starts the TypeScript service
set -e

echo "[startup] Starting service: $SERVICE_DIR..."
cd /workspace/$SERVICE_DIR
exec npx ts-node-dev --respawn --transpile-only src/app.ts

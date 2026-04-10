# SatvAAh — Runbook: Start Everything + Verify

## 0. Install pnpm (one-time)

This project uses **pnpm** (not npm or yarn).

```bash
# Install pnpm via corepack (comes with Node.js 16.9+)
corepack enable
corepack prepare pnpm@9.0.0 --activate

# OR via npm (if corepack isn't available)
npm install -g pnpm@9.0.0

# Verify
pnpm --version   # should print 9.0.0
```

## 1. First-Time Setup

```bash
cd ~/SatvaahFinal

# Copy environment template
cp .env.example .env        # then fill in FIREBASE_*, RAZORPAY_*, GUPSHUP_* etc.

# Install root dependencies (use pnpm — NOT npm)
pnpm install

# Build and start all containers
docker-compose up -d --build

# Wait for containers to be healthy (~60-90 seconds)
docker-compose ps
```

## 2. Database Setup (first time only)

```bash
# Run all 44 migrations
docker-compose exec user npx prisma migrate deploy

# Seed: cities, taxonomy_nodes, system_config, subscription_plans
docker-compose exec user npx tsx scripts/seed.ts

# Verify migration count
docker-compose exec postgres psql -U satvaaah_user -d satvaaah \
  -c "SELECT COUNT(*) FROM _prisma_migrations WHERE applied_steps_count > 0;"
# → should return 44
```

## 3. Verify Everything Works

```bash
# Static code checks (273 checks, no runtime needed)
bash HEALTH_CHECK.sh

# Live integration tests (needs docker-compose up)
bash INTEGRATION_TEST.sh

# Quick mode (skip rate limiter + E2E tests)
bash INTEGRATION_TEST.sh --quick
```

## 4. Mobile App

```bash
cd apps/mobile

# Create mobile .env
echo "EXPO_PUBLIC_API_BASE_URL=http://localhost:3002" > .env
# For Android emulator:
echo "EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3002" > .env

npm install
npx expo start

# Or for specific platform:
npx expo start --ios
npx expo start --android
```

## 5. Service Ports

| Service      | Port | URL                              |
|--------------|------|----------------------------------|
| auth         | 3001 | http://localhost:3001/health     |
| user         | 3002 | http://localhost:3002/health     |
| search       | 3003 | http://localhost:3003/health     |
| trust        | 3004 | http://localhost:3004/health     |
| rating       | 3005 | http://localhost:3005/health     |
| notification | 3006 | http://localhost:3006/health     |
| payment      | 3007 | http://localhost:3007/health     |
| admin        | 3009 | http://localhost:3009/health     |
| PostgreSQL   | 5432 |                                  |
| Redis        | 6379 |                                  |
| OpenSearch   | 9200 | http://localhost:9200/_cluster/health |
| MongoDB      | 27017|                                  |

## 6. Common Problems

### Container won't start
```bash
docker-compose logs satvaaah-auth --tail=50
# Look for: missing env vars, port conflicts, DB not ready
```

### Prisma errors ("field not found")
```bash
# Regenerate Prisma client
docker-compose exec user npx prisma generate
docker-compose restart user
```

### OpenSearch empty / search returns nothing
```bash
# Trigger a manual sync (syncs all provider profiles)
# POST to admin service internal endpoint, or run:
docker-compose exec user npx tsx scripts/sync-opensearch.ts
```

### JWT errors ("RS256 public key not configured")
```bash
# Generate RS256 key pair
openssl genrsa -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem

# Add to .env (replace newlines with \n)
JWT_PRIVATE_KEY="$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' jwt_private.pem)"
JWT_PUBLIC_KEY="$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' jwt_public.pem)"
```

### WhatsApp/FCM not sending
- Check GUPSHUP_API_KEY and GUPSHUP_SOURCE_PHONE in .env
- Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
- These are non-blocking — payment/search still works without them

## 7. Logs

```bash
# All services
docker-compose logs -f

# One service
docker logs satvaaah-auth -f --tail=100

# Filter errors only
docker logs satvaaah-user 2>&1 | grep -i error
```

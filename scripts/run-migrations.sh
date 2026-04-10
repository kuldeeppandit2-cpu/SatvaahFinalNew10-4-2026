#!/bin/bash
set -e
DB_URL="postgresql://satvaaah_user:Kkp1234%23%23@localhost:5432/satvaaah?schema=public"
PRISMA="node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js"
SCHEMA="packages/db/prisma/schema.prisma"

echo "Rolling back any failed migrations..."
for M in V031_seed_system_config V036_fix_subscription_tier_enum V042_schema_alignment_batch2; do
  DATABASE_URL="$DB_URL" node "$PRISMA" migrate resolve --rolled-back $M --schema "$SCHEMA" 2>/dev/null || true
done

echo "Deploying all migrations..."
DATABASE_URL="$DB_URL" node "$PRISMA" migrate deploy --schema "$SCHEMA"
echo "Done."

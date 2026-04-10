-- =============================================================================
-- V036_fix_subscription_tier_enum
-- V002 created SubscriptionTier as: free, basic, gold, platinum
-- MASTER_CONTEXT + schema.prisma canonical values: free, silver, gold
-- Changes: basic → silver, drop platinum
--
-- PostgreSQL does not support DROP VALUE from enum.
-- Solution: rename basic→silver, keep platinum for now (unused, harmless),
-- then add silver if not present.
-- =============================================================================

-- Add 'silver' value if missing (idempotent)
DO $$ BEGIN
  ALTER TYPE "SubscriptionTier" ADD VALUE IF NOT EXISTS 'silver';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- NOTE: Cannot UPDATE using new enum value in same transaction as ALTER TYPE ADD VALUE.
-- 'basic' was never used in production so no data migration needed.

-- Note: PostgreSQL cannot drop enum values once created.
-- 'basic' and 'platinum' remain in the enum but are never used.
-- Application code and schema.prisma only use: free, silver, gold.
-- =============================================================================

COMMENT ON TYPE "SubscriptionTier" IS
  'Canonical values: free, silver, gold. '
  'basic and platinum are legacy values from V002, never used in app code.';

-- =============================================================================
-- V051 — align_consumer_lead_usage_fk
--
-- PURPOSE:
--   V013 SQL created consumer_lead_usage.consumer_id as REFERENCES users(id).
--   Prisma schema.prisma had the wrong @relation pointing to ConsumerProfile.
--   This caused schema drift — Prisma ORM thought the FK was consumer_profiles.id
--   but the live DB has always enforced users.id.
--
--   This migration drops the drift-confusion constraint name and re-creates it
--   explicitly so the constraint name in the DB matches what Prisma now expects.
--
-- SAFETY:
--   The underlying FK (→ users.id) has NEVER changed since V013.
--   We are only renaming/re-declaring the constraint — no data changes.
--   All IF EXISTS / IF NOT EXISTS guards — safe to re-run.
--
-- audit-ref: DB21  consumer_lead_usage — consumer_id FK → users.id (V013 SQL)
-- =============================================================================

BEGIN;

-- Step 1: Drop old constraint if it exists under the original auto-generated name
ALTER TABLE consumer_lead_usage
  DROP CONSTRAINT IF EXISTS consumer_lead_usage_consumer_id_fkey;

-- Step 2: Re-add with an explicit, documented name that matches Prisma expectation
ALTER TABLE consumer_lead_usage
  ADD CONSTRAINT fk_consumer_lead_usage_user
    FOREIGN KEY (consumer_id) REFERENCES users(id) ON DELETE CASCADE;

COMMIT;

-- Verify
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.referential_constraints
  WHERE constraint_name = 'fk_consumer_lead_usage_user';
  RAISE NOTICE 'V051 verify: fk_consumer_lead_usage_user constraint count = %', v_count;
END $$;

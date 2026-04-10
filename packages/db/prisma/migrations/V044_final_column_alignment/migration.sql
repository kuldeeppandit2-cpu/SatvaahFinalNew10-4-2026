-- =============================================================================
-- V044_final_column_alignment
-- Final alignment pass — adds all columns present in schema.prisma but
-- missing from earlier migrations. Discovered by automated column scanner.
-- Rule #23: schema.prisma is canonical. This migration makes the DB match it.
-- =============================================================================

-- ─── contact_events: 12 missing columns ─────────────────────────────────────
-- V009 created an older version of this table. Schema evolved significantly.
ALTER TABLE contact_events
  ADD COLUMN IF NOT EXISTS provider_responded_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expiry_at                        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_lead_counted            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS provider_phone_revealed_to_consumer BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS consumer_phone_revealed          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS slot_date                        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS slot_duration_minutes            INT,
  ADD COLUMN IF NOT EXISTS no_show_reported_by_consumer     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS no_show_resolved                 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rating_prompt_skipped_count      INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_submitted                 BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS initial_message                  TEXT;

-- Rename old column names to match schema
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contact_events' AND column_name='provider_phone_revealed')
  THEN
    ALTER TABLE contact_events RENAME COLUMN provider_phone_revealed
      TO provider_phone_revealed_old;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contact_events' AND column_name='no_show_reported_by')
  THEN
    ALTER TABLE contact_events RENAME COLUMN no_show_reported_by
      TO no_show_reported_by_old;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='contact_events' AND column_name='slot_at')
  THEN
    ALTER TABLE contact_events RENAME COLUMN slot_at TO slot_at_old;
  END IF;
END $$;

-- ─── ratings: 5 missing columns ──────────────────────────────────────────────
-- V010 created older version. V039 adds some but not all.
ALTER TABLE ratings
  ADD COLUMN IF NOT EXISTS weight_type            VARCHAR(30),
  ADD COLUMN IF NOT EXISTS auto_moderation_passed BOOLEAN,
  ADD COLUMN IF NOT EXISTS admin_reviewed_by      UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_reviewed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason       VARCHAR(500);

-- Back-fill weight_type from weight_type_new if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='ratings' AND column_name='weight_type_new')
  THEN
    UPDATE ratings SET weight_type = weight_type_new::text WHERE weight_type IS NULL;
    ALTER TABLE ratings DROP COLUMN IF EXISTS weight_type_new;
  END IF;
END $$;

-- ─── trust_scores: 1 missing column ─────────────────────────────────────────
ALTER TABLE trust_scores
  ADD COLUMN IF NOT EXISTS verification_weight NUMERIC(5,4) NOT NULL DEFAULT 0.9;

-- ─── trust_score_history: 4 missing columns ─────────────────────────────────
ALTER TABLE trust_score_history
  ADD COLUMN IF NOT EXISTS previous_tier       VARCHAR(30),
  ADD COLUMN IF NOT EXISTS source_entity_type  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_entity_id    UUID,
  ADD COLUMN IF NOT EXISTS notes               TEXT;

-- ─── provider_verifications: 3 missing columns ──────────────────────────────
ALTER TABLE provider_verifications
  ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS rejection_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meta             JSONB NOT NULL DEFAULT '{}';

-- ─── consumer_lead_usage: 2 missing columns ──────────────────────────────────
ALTER TABLE consumer_lead_usage
  ADD COLUMN IF NOT EXISTS leads_bonus INT NOT NULL DEFAULT 0;

-- (subscription_plan is a relation field, not a column — no SQL needed)

-- ─── tsaas_usage_log: 1 missing column ──────────────────────────────────────
ALTER TABLE tsaas_usage_log
  ADD COLUMN IF NOT EXISTS latency_ms INT;

-- ─── scraping_staging: job relation (no column — it's a FK) ─────────────────
-- 'job' is a Prisma relation field, not a column. No SQL needed.
-- scraping_staging already has job_id (the FK column).

-- ─── provider_profiles: availability enum ────────────────────────────────────
-- V038 should have added availability as Availability enum.
-- If it still shows as text/jsonb, ensure enum exists and column is correct type.
DO $$ BEGIN
  CREATE TYPE "Availability" AS ENUM ('available', 'busy', 'away', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- If availability column exists but is wrong type, this is a no-op (IF NOT EXISTS)
ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS availability "Availability" NOT NULL DEFAULT 'available';

COMMENT ON TABLE contact_events IS
  'V044: Added 12 missing columns from schema.prisma evolution since V009.';
COMMENT ON TABLE ratings IS
  'V044: Added weight_type, auto_moderation_passed, admin review fields, rejection_reason.';

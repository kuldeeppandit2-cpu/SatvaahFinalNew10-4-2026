-- =============================================================================
-- V042_schema_alignment_batch2
-- Aligns V021-V030 tables with schema.prisma canonical definition.
-- Rule #23: schema.prisma wins. This migration updates the DB to match.
-- =============================================================================

-- ─── V021: InAppMessage ─────────────────────────────────────────────────────
-- V021 has: correlation_id, deleted_at (not in schema)
-- Schema has: (no extra columns — just removes non-schema cols from perspective)
ALTER TABLE in_app_messages
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS deleted_at;

-- ─── V023: ConsentRecord ────────────────────────────────────────────────────
-- Schema has consent_type (enum), policy_version — V023 has consent_version, no consent_type
ALTER TABLE consent_records
  ADD COLUMN IF NOT EXISTS consent_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS policy_version VARCHAR(20),
  DROP COLUMN IF EXISTS withdrawal_ip;

-- Back-fill consent_type for existing rows
UPDATE consent_records
  SET consent_type = 'dpdp_processing'
  WHERE consent_type IS NULL;

-- ─── V024: TsaasApiKey ──────────────────────────────────────────────────────
-- Schema has: calls_month DATE, client_email, last_used_at, requires_provider_consent
-- V024 has: calls_reset_at, created_by, deactivated_at, allowed_endpoints (not in schema)
ALTER TABLE tsaas_api_keys
  ADD COLUMN IF NOT EXISTS calls_month              DATE,
  ADD COLUMN IF NOT EXISTS client_email             VARCHAR(200),
  ADD COLUMN IF NOT EXISTS last_used_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requires_provider_consent BOOLEAN NOT NULL DEFAULT TRUE,
  DROP COLUMN IF EXISTS calls_reset_at,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS deactivated_at,
  DROP COLUMN IF EXISTS allowed_endpoints;

-- Back-fill calls_month for existing rows
UPDATE tsaas_api_keys
  SET calls_month = DATE_TRUNC('month', NOW())::DATE
  WHERE calls_month IS NULL;

ALTER TABLE tsaas_api_keys
  ALTER COLUMN calls_month SET NOT NULL;

-- ─── V025: RefreshToken ─────────────────────────────────────────────────────
-- Schema has: ip_address VARCHAR(45), user_agent VARCHAR(500)
-- V025 has: device_name, is_revoked, last_used_at, rotated_from (not in schema)
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS ip_address  VARCHAR(45),
  ADD COLUMN IF NOT EXISTS user_agent  VARCHAR(500),
  DROP COLUMN IF EXISTS device_name,
  DROP COLUMN IF EXISTS is_revoked,
  DROP COLUMN IF EXISTS last_used_at,
  DROP COLUMN IF EXISTS rotated_from;

-- ─── V026: TrustFlag ────────────────────────────────────────────────────────
-- CRITICAL: Schema has flag_type TrustFlagType, severity TrustFlagSeverity,
--           status TrustFlagStatus — V026 uses free-form fields instead
-- Add enums if not exist
DO $$ BEGIN
  CREATE TYPE "TrustFlagType" AS ENUM (
    'rating_manipulation', 'fake_account', 'identity_fraud',
    'duplicate_provider', 'policy_violation', 'no_show_pattern',
    'payment_fraud', 'admin_manual'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TrustFlagSeverity" AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TrustFlagStatus" AS ENUM ('open', 'investigating', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add schema columns to trust_flags
ALTER TABLE trust_flags
  ADD COLUMN IF NOT EXISTS flag_type "TrustFlagType",
  ADD COLUMN IF NOT EXISTS severity  "TrustFlagSeverity" NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS status    "TrustFlagStatus"   NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS raised_by_system   BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS raised_by_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_by_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution TEXT;

-- Drop V026 non-schema columns
ALTER TABLE trust_flags
  DROP COLUMN IF EXISTS flagged_by,
  DROP COLUMN IF EXISTS is_system_flag;

-- Note: no back-fill needed — fresh database has no trust_flags rows

-- ─── V027: ReferralEvent ────────────────────────────────────────────────────
-- Schema has: reward_type VARCHAR(50), reward_amount_paise INT
-- V027 has: reward_value, branch_click_id, branch_journey_name
ALTER TABLE referral_events
  ADD COLUMN IF NOT EXISTS reward_type         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS reward_amount_paise INT,
  DROP COLUMN IF EXISTS reward_value,
  DROP COLUMN IF EXISTS branch_click_id,
  DROP COLUMN IF EXISTS branch_journey_name;

-- ─── V029: ExternalRating ───────────────────────────────────────────────────
-- Schema has: platform VARCHAR(50), platform_url VARCHAR(500)
-- V029 has: profile_url, platform_entity_id, rating_max, stale_at, weight
ALTER TABLE external_ratings
  ADD COLUMN IF NOT EXISTS platform     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS platform_url VARCHAR(500),
  DROP COLUMN IF EXISTS profile_url,
  DROP COLUMN IF EXISTS platform_entity_id,
  DROP COLUMN IF EXISTS rating_max,
  DROP COLUMN IF EXISTS stale_at,
  DROP COLUMN IF EXISTS weight;

-- platform column already exists as external_platform NOT NULL from V029
-- no back-fill needed

-- ─── V030: CertificateRecord ─────────────────────────────────────────────────
-- Schema has: s3_key, is_revoked, is_suspended, triggered_by_lambda_id
-- V030 has: is_valid, trust_score_at_issue, revoked_by (not in schema)
ALTER TABLE certificate_records
  ADD COLUMN IF NOT EXISTS s3_key                VARCHAR(512),
  ADD COLUMN IF NOT EXISTS is_revoked            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_suspended          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS triggered_by_lambda_id VARCHAR(256),
  DROP COLUMN IF EXISTS is_valid,
  DROP COLUMN IF EXISTS trust_score_at_issue,
  DROP COLUMN IF EXISTS revoked_by;

-- Back-fill s3_key (existing certs may not have one)
UPDATE certificate_records
  SET s3_key = 'legacy/no-s3-key-' || id::text
  WHERE s3_key IS NULL;
ALTER TABLE certificate_records ALTER COLUMN s3_key SET NOT NULL;

-- ─── V019: opensearch_sync_log ────────────────────────────────────────────────
-- Schema has: error_message TEXT, updated_at
-- V019 has: queued_at (schema uses created_at instead)
ALTER TABLE opensearch_sync_log
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_opensync_updated_at'
  ) THEN
    CREATE TRIGGER trg_opensync_updated_at
      BEFORE UPDATE ON opensearch_sync_log
      FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
  END IF;
END $$;

-- ─── V020: notification_log ───────────────────────────────────────────────────
-- Schema has: fcm_delivery_status, wa_delivery_status, wa_template_name,
--             related_entity_type, related_entity_id
DO $$ BEGIN
  CREATE TYPE "DeliveryStatus" AS ENUM ('sent', 'delivered', 'read', 'failed', 'bounced');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS fcm_delivery_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS wa_delivery_status  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS wa_template_name    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS related_entity_id   UUID;

-- V011: daily_rating_usage alignment
-- count → ratings_submitted, add updated_at
ALTER TABLE daily_rating_usage
  RENAME COLUMN count TO ratings_submitted;

ALTER TABLE daily_rating_usage
  DROP COLUMN IF EXISTS last_rated_at,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Drop old FK and add correct one: consumer_id → consumer_profiles(id)
ALTER TABLE daily_rating_usage
  DROP CONSTRAINT IF EXISTS daily_rating_usage_consumer_id_fkey;

ALTER TABLE daily_rating_usage
  ADD CONSTRAINT daily_rating_usage_consumer_id_fkey
    FOREIGN KEY (consumer_id) REFERENCES consumer_profiles(id) ON DELETE CASCADE;

-- V012: search_intents alignment
-- raw_query → search_query, add notification_provider_id
ALTER TABLE search_intents
  RENAME COLUMN raw_query TO search_query;

ALTER TABLE search_intents
  ADD COLUMN IF NOT EXISTS notification_provider_id UUID
    REFERENCES provider_profiles(id) ON DELETE SET NULL;

ALTER TABLE search_intents
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- V016: saved_providers — consumer_id FK fix (users → consumer_profiles)
ALTER TABLE saved_providers
  DROP CONSTRAINT IF EXISTS saved_providers_consumer_id_fkey;

ALTER TABLE saved_providers
  ADD CONSTRAINT saved_providers_consumer_id_fkey
    FOREIGN KEY (consumer_id) REFERENCES consumer_profiles(id) ON DELETE CASCADE;

COMMENT ON TABLE daily_rating_usage IS 'count renamed to ratings_submitted. consumer_id now references consumer_profiles.';
COMMENT ON TABLE trust_flags IS 'Added flag_type, severity, status enums matching schema.prisma.';
COMMENT ON TABLE certificate_records IS 'Added s3_key (required for PDF), is_revoked, is_suspended.';

-- ─── V028: Scraping tables alignment ──────────────────────────────────────────

-- ScrapingJob: missing status, source
ALTER TABLE scraping_jobs
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS source VARCHAR(100);

-- ScrapeStaging: missing source; dedup/promoted cols are extra (keep, harmless)
ALTER TABLE scraping_staging
  ADD COLUMN IF NOT EXISTS source VARCHAR(100);

-- OutreachSchedule: missing attempt tracking and status columns
ALTER TABLE outreach_schedule
  ADD COLUMN IF NOT EXISTS attempt_1_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_2_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_3_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outreach_status  VARCHAR(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS wa_message_id_1  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS wa_message_id_2  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS wa_message_id_3  VARCHAR(100);

COMMENT ON COLUMN scraping_jobs.status IS 'pending | running | completed | failed';
COMMENT ON COLUMN outreach_schedule.outreach_status IS 'pending | attempt_1 | attempt_2 | attempt_3 | converted | opted_out';

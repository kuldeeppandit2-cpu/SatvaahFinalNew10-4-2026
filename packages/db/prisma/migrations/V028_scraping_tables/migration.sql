-- =============================================================================
-- V028: scraping_staging + scraping_jobs + outreach_schedule
-- Pre-launch scraping pipeline for Hyderabad provider seeding.
-- Raw scrape output: Python/Scrapy → MongoDB Atlas (schema-flexible per source).
-- After NLP extraction + dedup: → scraping_staging (this table) → admin queue → provider_profiles.
-- WhatsApp outreach: outreach_schedule → Lambda:outreach-scheduler (EventBridge every 15 min).
-- 3-attempt cadence: attempt_1 (day 0), attempt_2 (48h), attempt_3 (7d).
-- Templates: provider_welcome, activation_reminder_48h, provider_final_reminder_7d.
-- MASTER_CONTEXT: services/scraping port 3010, lambdas/outreach-scheduler.
-- =============================================================================

-- -----------------------------------------------------------------------
-- scraping_jobs: tracks each scraping run
-- -----------------------------------------------------------------------

CREATE TYPE scraping_job_status AS ENUM (
  'queued',
  'running',
  'completed',
  'failed',
  'partial'     -- completed with some errors
);

CREATE TYPE scraping_source AS ENUM (
  'justdial',
  'sulekha',
  'google_maps',
  'practo',
  'zomato',
  'local_directory',
  'manual'
);

CREATE TABLE scraping_jobs (
  id                  UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_name            VARCHAR(200)          NOT NULL,
  source              scraping_source       NOT NULL,
  taxonomy_node_id    UUID
                                            REFERENCES taxonomy_nodes(id) ON DELETE SET NULL,
  city_id             UUID
                                            REFERENCES cities(id) ON DELETE SET NULL,
  area_id             UUID
                                            REFERENCES areas(id) ON DELETE SET NULL,
  status              scraping_job_status   NOT NULL DEFAULT 'queued',
  records_scraped     INT                   NOT NULL DEFAULT 0,
  records_deduped     INT                   NOT NULL DEFAULT 0,
  records_staged      INT                   NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  error_log           TEXT,
  scheduled_at        TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------
-- scraping_staging: NLP-processed, deduped records awaiting promotion
-- -----------------------------------------------------------------------

CREATE TABLE scraping_staging (
  id                  UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id              UUID              NOT NULL
                                        REFERENCES scraping_jobs(id) ON DELETE CASCADE,
  source              scraping_source   NOT NULL,

  -- Source identifiers for deduplication
  source_url          TEXT,
  source_entity_id    VARCHAR(256),     -- platform's own entity ID (JD listing ID, etc.)

  -- Extracted business data
  business_name       TEXT,
  phone               VARCHAR(20),
  phone_normalized    VARCHAR(15),      -- E.164 format (e.g. +919876543210)
  address             TEXT,
  lat                 DOUBLE PRECISION,
  lng                 DOUBLE PRECISION, -- ST_MakePoint(lng, lat) — longitude first. MASTER_CONTEXT Rule 5.

  -- Classification
  taxonomy_node_id    UUID
                                        REFERENCES taxonomy_nodes(id) ON DELETE SET NULL,
  listing_type        VARCHAR(50),      -- individual_service / establishment / etc.

  -- Raw + NLP data (kept for audit, MongoDB has the full raw version)
  raw_data            JSONB             NOT NULL DEFAULT '{}',
  nlp_extracted       JSONB,            -- NLP output: structured name, category, attributes

  -- Deduplication
  -- Threshold from system_config: scraping_dedup_threshold = 0.85
  dedup_score         DOUBLE PRECISION
                                        CHECK (dedup_score IS NULL OR (dedup_score BETWEEN 0.0 AND 1.0)),
  is_duplicate        BOOLEAN           NOT NULL DEFAULT FALSE,
  matched_provider_id UUID
                                        REFERENCES provider_profiles(id) ON DELETE SET NULL,

  -- Promotion
  is_promoted         BOOLEAN           NOT NULL DEFAULT FALSE,
  promoted_at         TIMESTAMPTZ,      -- when converted to real provider_profile row
  promoted_by         VARCHAR(100),     -- admin who approved promotion

  staged_at           TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------
-- outreach_schedule: WhatsApp 3-attempt cadence for scraped providers
-- -----------------------------------------------------------------------

CREATE TYPE outreach_status AS ENUM (
  'pending',
  'attempt_1_sent',         -- provider_welcome template sent
  'attempt_2_sent',         -- activation_reminder_48h sent (48h after attempt_1)
  'attempt_3_sent',         -- provider_final_reminder_7d sent (7d after attempt_1)
  'responded',              -- provider signed up organically (conversion)
  'opted_out',              -- provider replied STOP or DND
  'invalid_number',         -- Gupshup delivery failed: number invalid
  'max_attempts'            -- all 3 attempts made, no conversion
);

CREATE TABLE outreach_schedule (
  id                  UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Link to either a claimed provider or a staging record
  provider_id         UUID
                                        REFERENCES provider_profiles(id) ON DELETE CASCADE,
  staging_id          UUID
                                        REFERENCES scraping_staging(id) ON DELETE CASCADE,

  phone               VARCHAR(20)       NOT NULL,  -- as scraped (with country code if known)
  outreach_status     outreach_status   NOT NULL DEFAULT 'pending',

  -- Attempt timestamps
  attempt_1_at        TIMESTAMPTZ,      -- day 0: provider_welcome
  attempt_2_at        TIMESTAMPTZ,      -- 48h after attempt_1 (system_config: outreach_attempt_2_delay_hours=48)
  attempt_3_at        TIMESTAMPTZ,      -- 7d after attempt_1  (system_config: outreach_attempt_3_delay_hours=168)
  next_attempt_at     TIMESTAMPTZ,      -- Lambda:outreach-scheduler uses this index

  -- Gupshup message IDs for delivery tracking
  wa_message_id_1     VARCHAR(256),
  wa_message_id_2     VARCHAR(256),
  wa_message_id_3     VARCHAR(256),

  -- Outcome
  opted_out_at        TIMESTAMPTZ,
  conversion_at       TIMESTAMPTZ,      -- when provider completed registration
  converted_user_id   UUID
                                        REFERENCES users(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

  -- Must reference either a provider or a staging record
  CONSTRAINT chk_outreach_has_reference
    CHECK (provider_id IS NOT NULL OR staging_id IS NOT NULL)
);

-- -----------------------------------------------------------------------
-- INDEXES: scraping_jobs
-- -----------------------------------------------------------------------
CREATE INDEX idx_scraping_jobs_status
  ON scraping_jobs (status, scheduled_at ASC);
CREATE INDEX idx_scraping_jobs_source_city
  ON scraping_jobs (source, city_id, created_at DESC);

-- -----------------------------------------------------------------------
-- INDEXES: scraping_staging
-- -----------------------------------------------------------------------
-- Admin promotion queue: unpromoted non-duplicates
CREATE INDEX idx_scraping_staging_unpromoted
  ON scraping_staging (staged_at ASC)
  WHERE is_promoted = FALSE AND is_duplicate = FALSE;

-- Dedup lookup by normalized phone
CREATE INDEX idx_scraping_staging_phone
  ON scraping_staging (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

-- Job result view
CREATE INDEX idx_scraping_staging_job
  ON scraping_staging (job_id, staged_at DESC);

-- -----------------------------------------------------------------------
-- INDEXES: outreach_schedule
-- -----------------------------------------------------------------------
-- Lambda:outreach-scheduler hot path — find pending outreach due now
CREATE INDEX idx_outreach_next_attempt
  ON outreach_schedule (next_attempt_at ASC)
  WHERE outreach_status IN ('pending', 'attempt_1_sent', 'attempt_2_sent');

-- Phone lookup (prevent duplicate outreach to same number)
CREATE INDEX idx_outreach_phone
  ON outreach_schedule (phone);

-- Conversion tracking
CREATE INDEX idx_outreach_converted
  ON outreach_schedule (conversion_at DESC)
  WHERE conversion_at IS NOT NULL;

COMMENT ON TABLE scraping_staging IS
  'Pre-launch Hyderabad provider seeding pipeline. '
  'Scrapy output → MongoDB Atlas (raw) → NLP extraction → this table → admin queue → provider_profiles. '
  'dedup_score threshold: system_config scraping_dedup_threshold (default 0.85). '
  'Promoted to provider_profiles via admin portal. is_scrape_record=TRUE on promoted profiles.';

COMMENT ON TABLE outreach_schedule IS
  'WhatsApp 3-attempt outreach for scraped providers. '
  'Attempt 1 (day 0): provider_welcome template. '
  'Attempt 2 (48h): activation_reminder_48h template. '
  'Attempt 3 (7d): provider_final_reminder_7d template. '
  'Lambda:outreach-scheduler fires every 15 min (EventBridge). '
  'next_attempt_at computed by scheduler. opted_out → never contact again.';

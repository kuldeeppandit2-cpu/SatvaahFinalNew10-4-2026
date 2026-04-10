-- =============================================================================
-- V029: external_ratings
-- Scraped ratings from Google, Zomato, Practo, JustDial, Sulekha.
-- Weight in trust score: 0.30 active, 0.15 stale (system_config: scraped_rating_stale_days=90).
-- UNIQUE(provider_id, platform): one row per provider per platform, updated on refresh.
-- Lambda:ratings-refresh runs daily via EventBridge to refresh all active records.
-- Source ALWAYS shown to consumers — never presented as SatvAAh ratings.
-- MASTER_CONTEXT: Trust Score Model, rating weight_type scraped_external = 0.3.
-- =============================================================================

CREATE TYPE external_platform AS ENUM (
  'google',
  'zomato',
  'practo',
  'justdial',
  'sulekha'
);

CREATE TABLE external_ratings (
  id                  UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id         UUID                NOT NULL
                                          REFERENCES provider_profiles(id) ON DELETE CASCADE,
  platform            external_platform   NOT NULL,

  -- Rating from the external platform
  rating_avg          NUMERIC(3,1)        NOT NULL
                                          CHECK (rating_avg >= 0),
  rating_max          NUMERIC(3,1)        NOT NULL DEFAULT 5.0
                                          CHECK (rating_max > 0),
  review_count        INT                 NOT NULL DEFAULT 0
                                          CHECK (review_count >= 0),

  -- Platform source
  profile_url         TEXT,               -- URL on the platform (shown to consumer)
  platform_entity_id  VARCHAR(256),       -- platform's own entity ID for targeted refresh

  -- Freshness
  scraped_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  is_stale            BOOLEAN             NOT NULL DEFAULT FALSE,
  stale_at            TIMESTAMPTZ,        -- set when scraped_at + stale_days threshold crossed
  -- Weight: 0.30 when fresh, 0.15 when stale. system_config: scraped_rating_stale_weight=0.15
  weight              NUMERIC(3,2)        NOT NULL DEFAULT 0.30
                                          CHECK (weight IN (0.30, 0.15)),

  -- One record per provider per platform (upserted on each refresh)
  CONSTRAINT uq_external_rating_provider_platform
    UNIQUE (provider_id, platform),

  CONSTRAINT chk_rating_avg_max
    CHECK (rating_avg <= rating_max)
);

-- Trust score calculation: join external_ratings for a provider
CREATE INDEX idx_external_ratings_provider
  ON external_ratings (provider_id);

-- Lambda:ratings-refresh: find records due for refresh (oldest scraped_at first)
-- Runs daily — targets non-stale records older than 60 days for preemptive refresh
CREATE INDEX idx_external_ratings_refresh_due
  ON external_ratings (scraped_at ASC)
  WHERE is_stale = FALSE;

-- Stale detection run (marks is_stale=TRUE, weight=0.15 after stale_days threshold)
CREATE INDEX idx_external_ratings_stale_candidates
  ON external_ratings (scraped_at ASC)
  WHERE is_stale = FALSE;

-- Platform analytics (admin: how many providers verified per platform)
CREATE INDEX idx_external_ratings_platform
  ON external_ratings (platform, scraped_at DESC);

COMMENT ON TABLE external_ratings IS
  'Scraped external ratings from Google, Zomato, Practo, JustDial, Sulekha. '
  'UNIQUE(provider_id, platform): one row per provider per platform. Upserted on refresh. '
  'weight=0.30 when fresh. After system_config scraped_rating_stale_days (90) days: '
  '  is_stale=TRUE, weight=0.15 (system_config: scraped_rating_stale_weight). '
  'Lambda:ratings-refresh refreshes stale records daily via EventBridge. '
  'Source always shown to consumer. Consumers cannot submit scraped_external ratings. '
  'Trust score formula: included in customer_voice_score component. '
  'MASTER_CONTEXT: rating weight_type scraped_external = 0.3 (0.15 when stale).';

COMMENT ON COLUMN external_ratings.profile_url IS
  'URL on the external platform shown to the consumer in search results. '
  'e.g. "See 247 reviews on Google" → links to maps.google.com/... '
  'Never presented as a SatvAAh review. Source attribution is mandatory.';

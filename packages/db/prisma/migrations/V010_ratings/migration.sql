-- =============================================================================
-- V010_ratings — SatvAAh
-- Three-weight rating system:
--   verified_contact  1.0  — linked contact_event with status=accepted
--   open_community    0.5  — OTP verified + account ≥7 days + daily limits enforced
--   scraped_external  0.3  — Google/Zomato/Practo. Stale >90 days → weight halved to 0.15
--
-- contact_event_id:
--   NOT NULL → verified_contact weight type (provably real interaction)
--   NULL     → open_community OR scraped_external (contact_event_id IS NULL)
--
-- consumer_id:
--   NOT NULL → human rating (verified_contact or open_community)
--   NULL     → scraped_external (no consumer account)
--
-- Daily limits per consumer tab enforced in daily_rating_usage (V011).
-- Rating bonus: consumer earns +2 leads per rating (rating_bonus_leads=2 in system_config).
-- Skips: expires after 3 skips (rating_expiry_after_skips=3 in system_config).
-- =============================================================================

-- ENUM: determines rating weight in trust score formula
CREATE TYPE "WeightType" AS ENUM (
  'verified_contact',   -- 1.0 weight — linked to accepted contact_event
  'open_community',     -- 0.5 weight — OTP + account age verified
  'scraped_external'    -- 0.3 weight (0.15 when stale >90d)
);

-- ENUM: 10-step moderation pipeline (services/rating)
CREATE TYPE "ModerationStatus" AS ENUM (
  'pending',     -- Submitted, awaiting moderation
  'approved',    -- Passed all moderation checks, contributes to trust_score
  'rejected',    -- Failed moderation, does NOT contribute to trust_score
  'flagged'      -- Requires manual admin review (trust_flags created)
);

-- =============================================================================
CREATE TABLE ratings (
  id                  UUID               PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Provider being rated
  provider_id         UUID               NOT NULL
                        REFERENCES provider_profiles(id) ON DELETE RESTRICT,

  -- Consumer who submitted rating: NULL for scraped_external
  consumer_id         UUID
                        REFERENCES users(id) ON DELETE SET NULL,

  -- Link to verified contact event: NULL for open_community and scraped_external
  -- NULL = open_community rating (spec: "NULL = open_community")
  contact_event_id    UUID
                        REFERENCES contact_events(id) ON DELETE SET NULL,

  -- 1–5 star overall rating
  overall_stars       SMALLINT           NOT NULL
                        CHECK (overall_stars >= 1 AND overall_stars <= 5),

  -- Per-dimension scores from taxonomy_node.rating_dimensions
  -- Format: [{"key": "punctuality", "label": "On Time", "stars": 4}, ...]
  dimension_scores    JSONB,

  -- Optional free-text review
  review_text         TEXT,

  -- Weight type drives how this rating contributes to trust_score
  weight_type         "WeightType"       NOT NULL,

  -- Actual weight value at time of submission
  -- verified_contact=1.0, open_community=0.5, scraped_external=0.3 (or 0.15 stale)
  weight_value        NUMERIC(4, 2)      NOT NULL
                        CHECK (weight_value > 0 AND weight_value <= 1.00),

  -- Moderation pipeline status
  moderation_status   "ModerationStatus" NOT NULL DEFAULT 'pending',
  moderation_note     TEXT,

  -- Skip tracking: prompt skipped N times; expires at rating_expiry_after_skips=3
  skip_count          INT                NOT NULL DEFAULT 0 CHECK (skip_count >= 0),
  is_expired          BOOLEAN            NOT NULL DEFAULT FALSE,

  -- For scraped_external: source platform name (mirrors external_ratings.platform)
  scrape_platform     VARCHAR(50),

  -- Scraped rating staleness: timestamp of last external scrape
  scraped_at          TIMESTAMPTZ,

  created_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  -- Prevent duplicate verified_contact rating for same event
  CONSTRAINT ratings_contact_event_unique
    UNIQUE NULLS NOT DISTINCT (consumer_id, contact_event_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Trust score recalculation: all approved ratings for a provider by weight type
CREATE INDEX idx_ratings_provider_approved
  ON ratings(provider_id, weight_type, moderation_status)
  WHERE moderation_status = 'approved';

-- Consumer rating history
CREATE INDEX idx_ratings_consumer_id
  ON ratings(consumer_id, created_at DESC)
  WHERE consumer_id IS NOT NULL;

-- Admin moderation queue
CREATE INDEX idx_ratings_moderation_queue
  ON ratings(moderation_status, created_at)
  WHERE moderation_status IN ('pending', 'flagged');

-- Contact event lookup (for eligibility check)
CREATE INDEX idx_ratings_contact_event_id
  ON ratings(contact_event_id)
  WHERE contact_event_id IS NOT NULL;

-- Staleness check for scraped_external (90-day decay)
CREATE INDEX idx_ratings_scraped_external
  ON ratings(scraped_at, provider_id)
  WHERE weight_type = 'scraped_external';

-- =============================================================================
-- TRIGGER: auto-update updated_at
-- =============================================================================
CREATE TRIGGER trg_ratings_updated_at
  BEFORE UPDATE ON ratings
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  ratings IS
  'Three-tier weighted rating system: '
  'verified_contact=1.0, open_community=0.5, scraped_external=0.3 (stale→0.15). '
  'contact_event_id IS NULL means open_community or scraped_external.';

COMMENT ON COLUMN ratings.contact_event_id IS
  'NULL = open_community rating (per spec). '
  'NOT NULL = verified_contact (linked to accepted contact_event).';

COMMENT ON COLUMN ratings.weight_value IS
  'Captured at submission time. '
  'scraped_external becomes 0.15 after 90 days (is_stale in external_ratings).';

COMMENT ON COLUMN ratings.dimension_scores IS
  'Per-taxonomy dimension stars. Schema defined by taxonomy_nodes.rating_dimensions JSONB. '
  'Format: [{key, label, stars}].';

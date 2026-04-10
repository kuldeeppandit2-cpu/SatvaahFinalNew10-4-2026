-- =============================================================================
-- V006_trust_scores — SatvAAh
-- Computed trust score record per provider. One-to-one with provider_profiles.
-- Written ONLY by Lambda:trust-recalculate — never by application code.
--
-- TRUST TIER THRESHOLDS (from system_config — never hardcoded here):
--   trust_tier_basic_threshold          = 20  (NOT 40 — corrected Coherence Review v1)
--   trust_tier_trusted_threshold        = 60
--   trust_tier_highly_trusted_threshold = 80
--
-- DISPLAY SCORE FORMULA:
--   display_score = (verification_score × verification_weight)
--                 + (customer_voice_score × customer_voice_weight)
--   customer_voice_weight  = f(rating_count) per customer_weight_curve config key
--   customer_weight_curve  = {0:0.10, 3:0.20, 10:0.30, 50:0.65, 200:0.70}
--   customer_voice_max_weight = 0.70 (hard cap, admin-configurable)
--   verification_weight    = 1.0 − customer_voice_weight
-- =============================================================================

-- ENUM: trust tier bands — drives search ranking, profile badge, certificate eligibility
CREATE TYPE "TrustTier" AS ENUM (
  'unverified',      -- 0–19:   Grey      #6B6560
  'basic',           -- 20–59:  Saffron   #C8691A  (OTP verified threshold)
  'trusted',         -- 60–79:  Verdigris #6BA89E  (Aadhaar/credential verified)
  'highly_trusted'   -- 80–100: Verdigris #2E7D72  (Certificate eligible)
);

-- =============================================================================
CREATE TABLE trust_scores (
  id                      UUID           PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One trust_scores row per provider_profile — enforced by UNIQUE
  provider_id             UUID           NOT NULL UNIQUE
                            REFERENCES provider_profiles(id) ON DELETE CASCADE,

  -- Normalised 0–100 score shown to consumers on profile and search cards
  display_score           INT            NOT NULL DEFAULT 0
                            CHECK (display_score >= 0 AND display_score <= 100),

  -- Raw sum of signal points (before normalisation to 0–100)
  raw_score               INT            NOT NULL DEFAULT 0
                            CHECK (raw_score >= 0),

  -- Sub-scores feeding into display_score formula
  verification_score      INT            NOT NULL DEFAULT 0
                            CHECK (verification_score >= 0),
  customer_voice_score    INT            NOT NULL DEFAULT 0
                            CHECK (customer_voice_score >= 0),

  -- Dynamic weight for customer_voice component
  -- Starts at 0.10 (0 ratings), caps at 0.70 (200+ ratings) per curve config
  customer_voice_weight   NUMERIC(5, 4)  NOT NULL DEFAULT 0.1000
                            CHECK (customer_voice_weight >= 0 AND customer_voice_weight <= 0.7000),

  -- Derived: verification_weight = 1.0000 − customer_voice_weight (shown for clarity)
  -- Not stored — computed at read time to avoid staleness

  -- Trust tier: derived from display_score and tier thresholds in system_config
  trust_tier              "TrustTier"    NOT NULL DEFAULT 'unverified',

  -- Total approved ratings contributing to customer_voice_score
  rating_count            INT            NOT NULL DEFAULT 0
                            CHECK (rating_count >= 0),

  -- Timestamp of most recent full recalculation
  last_calculated_at      TIMESTAMPTZ,

  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX idx_ts_provider_id
  ON trust_scores(provider_id);

CREATE INDEX idx_ts_trust_tier
  ON trust_scores(trust_tier);

-- Used by certificate eligibility check: WHERE display_score >= 80
CREATE INDEX idx_ts_display_score_desc
  ON trust_scores(display_score DESC);

-- Used by push-discovery threshold queries
CREATE INDEX idx_ts_tier_score
  ON trust_scores(trust_tier, display_score DESC);

-- =============================================================================
-- TRIGGER: auto-update updated_at
-- =============================================================================
CREATE TRIGGER trg_ts_updated_at
  BEFORE UPDATE ON trust_scores
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  trust_scores IS
  'Computed trust score per provider. Written ONLY by Lambda:trust-recalculate. '
  'Application code must never INSERT or UPDATE this table directly.';

COMMENT ON COLUMN trust_scores.display_score IS
  'Normalised 0–100. Formula: (verification_score × verification_weight) '
  '+ (customer_voice_score × customer_voice_weight).';

COMMENT ON COLUMN trust_scores.customer_voice_weight IS
  'Dynamic weight: starts 0.10, grows with rating_count per customer_weight_curve. '
  'Hard cap: 0.70 (customer_voice_max_weight in system_config).';

COMMENT ON COLUMN trust_scores.trust_tier IS
  'Thresholds in system_config: basic=20, trusted=60, highly_trusted=80. '
  'basic threshold is 20, NOT 40 — Coherence Review v1 correction.';

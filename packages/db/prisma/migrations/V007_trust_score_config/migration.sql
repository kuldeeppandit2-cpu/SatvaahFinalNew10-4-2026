-- =============================================================================
-- V007_trust_score_config — SatvAAh
-- Signal configuration table for the dynamic trust score model.
-- ALL signal weights live here — NOTHING is hardcoded in application code.
-- Admin-editable without code deploy.
--
-- CRITICAL RULE 20: Nothing hardcoded. All thresholds in system_config or
-- trust_score_config table.
--
-- Each row defines one trust signal for one listing_type:
--   listing_type  — which provider type this signal applies to
--   signal_name   — machine-readable key (e.g. 'phone_otp_verified')
--   max_pts       — maximum points this signal contributes to raw_score
--   raw_max_total — sum of all max_pts for this listing_type (for normalisation)
--   is_active     — admin can disable a signal without deleting it
-- =============================================================================

CREATE TABLE trust_score_config (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: which listing type this signal belongs to
  listing_type    "ListingType" NOT NULL,

  -- Signal identifier: snake_case, stable across deploys
  signal_name     VARCHAR(100)  NOT NULL,

  -- Maximum points this signal contributes when fully satisfied
  max_pts         INT           NOT NULL CHECK (max_pts > 0),

  -- Sum of all max_pts for this listing_type — used to normalise raw_score to 0–100
  -- Kept denormalised here so Lambda:trust-recalculate can read it in one query
  raw_max_total   INT           NOT NULL CHECK (raw_max_total > 0),

  -- Admin can soft-disable a signal without data loss
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,

  -- Human-readable description for admin portal display
  description     TEXT,

  -- Signal decay: if not NULL, signal loses max_pts over this many days without re-verification
  decay_days      INT           CHECK (decay_days IS NULL OR decay_days > 0),

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Enforce uniqueness: one signal_name per listing_type
  CONSTRAINT tsc_listing_signal_unique UNIQUE (listing_type, signal_name)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Lambda:trust-recalculate primary query: all active signals for a listing_type
CREATE INDEX idx_tsc_listing_type_active
  ON trust_score_config(listing_type)
  WHERE is_active = TRUE;

CREATE INDEX idx_tsc_signal_name
  ON trust_score_config(signal_name);

-- =============================================================================
-- TRIGGER: auto-update updated_at
-- =============================================================================
CREATE TRIGGER trg_tsc_updated_at
  BEFORE UPDATE ON trust_score_config
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  trust_score_config IS
  'Dynamic trust signal configuration. ALL weights live here. '
  'Nothing hardcoded in application code. Admin-editable via admin portal. '
  'Seeded by per-listing-type SQL seed files under packages/db/seeds/.';

COMMENT ON COLUMN trust_score_config.signal_name IS
  'Stable snake_case key. Referenced by Lambda:trust-recalculate. '
  'Example values: phone_otp_verified, aadhaar_verified, geo_verified, '
  'profile_photo, bio_filled, first_accepted_lead, consistent_availability.';

COMMENT ON COLUMN trust_score_config.raw_max_total IS
  'Sum of all max_pts for this listing_type. '
  'Used by Lambda: normalised_score = (raw_score / raw_max_total) * 100.';

COMMENT ON COLUMN trust_score_config.decay_days IS
  'If set, the signal score decays to 0 if not re-satisfied within this many days. '
  'Example: geo_verified might decay after 365 days requiring re-verification.';

-- =============================================================================
-- V005_consumer_profiles — SatvAAh
-- Consumer-side profile. One-to-one with users (consumer or both mode).
-- Consumer trust_score starts at 75 (established baseline — not zero).
-- Consumer trust grows through: verified contact events, rating quality,
-- account age, no-show-free record.
-- =============================================================================

CREATE TABLE consumer_profiles (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One consumer profile per user
  user_id         UUID          NOT NULL UNIQUE
                    REFERENCES users(id) ON DELETE CASCADE,

  display_name    VARCHAR(200),

  -- City preference for search defaults and notifications
  city_id         UUID          REFERENCES cities(id) ON DELETE SET NULL,

  -- Consumer trust score: starts at 75, updated by rating service
  -- Influences: rating weight type, lead allocation, slot booking eligibility
  trust_score     INT           NOT NULL DEFAULT 75
                    CHECK (trust_score >= 0 AND trust_score <= 100),

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX idx_cp_user_id
  ON consumer_profiles(user_id);

CREATE INDEX idx_cp_city_id
  ON consumer_profiles(city_id)
  WHERE city_id IS NOT NULL;

CREATE INDEX idx_cp_trust_score
  ON consumer_profiles(trust_score DESC);

-- =============================================================================
-- TRIGGER: auto-update updated_at
-- =============================================================================
CREATE TRIGGER trg_cp_updated_at
  BEFORE UPDATE ON consumer_profiles
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  consumer_profiles IS
  'Consumer-side profile. One-to-one with users. '
  'trust_score starts at 75 (generous baseline) and is updated by rating service.';

COMMENT ON COLUMN consumer_profiles.trust_score IS
  'Consumer trust baseline = 75. '
  'trust_score >= 80 qualifies for slot_booking contact type (Gold tier). '
  'Updated by services/rating on each verified rating submission.';

-- =============================================================================
-- V027: referral_events
-- Referral tracking with UNIQUE(referrer_id, referred_id) to prevent reward exploitation.
-- Deep link: satvaaah://join/{code} → Branch.io deferred install attribution.
-- IMPORTANT: Branch.io only. Firebase Dynamic Links deprecated August 2025.
-- MASTER_CONTEXT Rule 18. Reward: system_config referral_reward_leads (default 5 leads).
-- =============================================================================

CREATE TYPE referral_reward_type AS ENUM (
  'leads',              -- additional contact event leads credited to referrer's quota
  'subscription_days',  -- referrer's subscription extended (future feature)
  'none'                -- referral tracked but no reward (e.g. self-referral blocked)
);

CREATE TABLE referral_events (
  id                  UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),

  referrer_id         UUID                  NOT NULL
                                            REFERENCES users(id) ON DELETE CASCADE,
  referred_id         UUID                  NOT NULL
                                            REFERENCES users(id) ON DELETE CASCADE,

  -- Referral code from Branch.io link (satvaaah://join/{code})
  referral_code       VARCHAR(20)           NOT NULL,

  -- Conversion tracking
  -- converted_at: when referred_id completed phone OTP + consent (first login)
  converted_at        TIMESTAMPTZ,

  -- Reward
  reward_type         referral_reward_type  NOT NULL DEFAULT 'leads',
  reward_value        INT                   NOT NULL DEFAULT 0
                                            CHECK (reward_value >= 0),
  reward_granted      BOOLEAN               NOT NULL DEFAULT FALSE,
  reward_granted_at   TIMESTAMPTZ,

  -- Branch.io attribution
  branch_click_id     VARCHAR(256),         -- Branch click ID for attribution tracking
  branch_journey_name VARCHAR(100),

  created_at          TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

  -- UNIQUE: one referral per pair. Prevents referrer from re-referring same user
  -- and prevents referred user from being claimed by multiple referrers.
  CONSTRAINT uq_referral_pair UNIQUE (referrer_id, referred_id),

  -- Self-referral prevention (checked in app layer, enforced here as extra guard)
  CONSTRAINT chk_no_self_referral CHECK (referrer_id <> referred_id)
);

-- Referrer's earnings history
CREATE INDEX idx_referral_events_referrer
  ON referral_events (referrer_id, created_at DESC);

-- Check if referred user was already referred (prevents duplicate claims at app layer)
CREATE INDEX idx_referral_events_referred
  ON referral_events (referred_id);

-- Referral code lookup (Branch.io deep link resolution)
CREATE INDEX idx_referral_events_code
  ON referral_events (referral_code);

-- Pending reward grants (processed by services/payment after conversion confirmed)
CREATE INDEX idx_referral_events_pending_reward
  ON referral_events (converted_at DESC)
  WHERE converted_at IS NOT NULL AND reward_granted = FALSE;

COMMENT ON TABLE referral_events IS
  'Referral tracking. UNIQUE(referrer_id, referred_id) prevents reward exploitation. '
  'Deep link: satvaaah://join/{code} via Branch.io — handles deferred install attribution '
  'so referral code persists even if app not installed at click time. '
  'DO NOT use Firebase Dynamic Links — deprecated August 2025. MASTER_CONTEXT Rule 18. '
  'reward_value in leads (default 5 from system_config: referral_reward_leads). '
  'Reward granted by services/payment after referred_id completes first login. '
  'POST /api/v1/referrals/apply (services/payment port 3007).';

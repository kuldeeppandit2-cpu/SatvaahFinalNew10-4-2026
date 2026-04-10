-- =============================================================================
-- V002_users — SatvAAh
-- Core identity table. One row per phone number.
-- Soft delete (deleted_at) for DPDP Act 2023 compliance — data anonymised
-- within 72h by Lambda:anonymisation triggered via SQS anonymisation queue.
-- =============================================================================

-- ENUM: app mode — a single account can switch between provider and consumer
CREATE TYPE "UserMode" AS ENUM (
  'provider',
  'consumer',
  'both'
);

-- ENUM: subscription tier — drives feature access and lead quotas
-- Values must stay in sync with packages/types/src/index.ts SubscriptionTier
CREATE TYPE "SubscriptionTier" AS ENUM (
  'free',
  'basic',
  'gold',
  'platinum'
);

-- =============================================================================
CREATE TABLE users (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Phone is the sole identity credential (Firebase phone OTP)
  phone               VARCHAR(15) NOT NULL,
  phone_verified      BOOLEAN     NOT NULL DEFAULT FALSE,

  -- App mode: provider / consumer / both
  mode                "UserMode"  NOT NULL DEFAULT 'consumer',

  -- Subscription tier: updated by payment service on subscription activation
  subscription_tier   "SubscriptionTier" NOT NULL DEFAULT 'free',

  -- Firebase Cloud Messaging token — updated each login
  fcm_token           TEXT,

  -- WhatsApp opt-out per DPDP Act. If TRUE, no WA messages sent ever.
  wa_opted_out        BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Referral codes — 8-character alphanumeric, unique
  referral_code       VARCHAR(12),
  referred_by_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,

  -- Timestamps — TIMESTAMPTZ: store UTC, convert to Asia/Kolkata in app only
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft delete: DPDP Act 2023 — sets this; Lambda:anonymisation clears PII within 72h
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT users_phone_key          UNIQUE (phone),
  CONSTRAINT users_referral_code_key  UNIQUE (referral_code)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Primary lookup: phone → user (auth flow)
CREATE INDEX idx_users_phone
  ON users(phone);

-- Soft-delete filter: exclude deleted users from all queries
CREATE INDEX idx_users_active
  ON users(id)
  WHERE deleted_at IS NULL;

-- Referral lookups
CREATE INDEX idx_users_referral_code
  ON users(referral_code)
  WHERE referral_code IS NOT NULL;

CREATE INDEX idx_users_referred_by
  ON users(referred_by_user_id)
  WHERE referred_by_user_id IS NOT NULL;

-- =============================================================================
-- TRIGGER: auto-update updated_at
-- =============================================================================
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  users IS 'Core identity table. One row per unique phone number. Soft-deleted for DPDP compliance.';
COMMENT ON COLUMN users.phone IS 'E.164 format recommended. Firebase phone OTP verified.';
COMMENT ON COLUMN users.mode IS 'Account mode. A single user can be provider AND consumer.';
COMMENT ON COLUMN users.subscription_tier IS 'Updated by payment service. free / basic / gold / platinum.';
COMMENT ON COLUMN users.fcm_token IS 'Firebase Cloud Messaging token. Refreshed on every login.';
COMMENT ON COLUMN users.wa_opted_out IS 'If TRUE, WhatsApp messages are never sent. Irreversible opt-out.';
COMMENT ON COLUMN users.referral_code IS '8–12 char alphanumeric. Generated at first login.';
COMMENT ON COLUMN users.deleted_at IS 'DPDP Act 2023 soft delete. Lambda:anonymisation anonymises PII within 72h.';

-- =============================================================================
-- V034_provider_verifications
-- Stores individual verification events for providers.
-- Denormalised boolean flags (is_phone_verified etc.) on provider_profiles
-- are derived from this table for query performance.
-- Referenced by aadhaarService.ts, verificationService.ts, credentialService.ts
-- =============================================================================

CREATE TABLE provider_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,

  verification_type VARCHAR(50) NOT NULL,  -- phone, aadhaar, geo, credential, admin_manual
  status VARCHAR(30) NOT NULL DEFAULT 'pending',  -- pending, verified, rejected, expired

  -- DigiLocker / Aadhaar — HASH ONLY. NEVER store raw UID or Aadhaar number.
  -- hash = bcrypt(digilocker_uid + per_record_salt, cost=12) = 72 bytes
  digilocker_uid_hash VARCHAR(72),
  per_record_salt     VARCHAR(64),
  digilocker_name     VARCHAR(200),

  -- Geo verification
  geo_verified_lat      DOUBLE PRECISION,
  geo_verified_lng      DOUBLE PRECISION,
  geo_verified_radius_m INT,

  -- Credential verification
  credential_name        VARCHAR(200),
  credential_issuer      VARCHAR(200),
  credential_number_hash VARCHAR(72),   -- bcrypt hash, never raw number
  credential_expiry_date DATE,
  credential_s3_key      VARCHAR(512),  -- S3 key for uploaded document

  -- Review
  verified_at          TIMESTAMPTZ,
  verified_by_admin_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pv_provider_id ON provider_verifications(provider_id);
CREATE INDEX idx_pv_type_status ON provider_verifications(provider_id, verification_type, status);

CREATE TRIGGER trg_pv_updated_at
  BEFORE UPDATE ON provider_verifications
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON TABLE provider_verifications IS
  'Individual verification records for providers. '
  'Denormalised flags on provider_profiles (is_aadhaar_verified etc.) derived from here. '
  'NEVER store raw Aadhaar number — only bcrypt(digilocker_uid + salt, cost=12).';

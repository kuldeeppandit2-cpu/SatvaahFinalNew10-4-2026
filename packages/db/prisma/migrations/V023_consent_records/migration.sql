-- =============================================================================
-- V023: consent_records
-- DPDP Act 2023 compliant consent audit trail.
-- UNIQUE(user_id, consent_type): one record per consent type per user.
-- Withdrawal: sets withdrawn_at (never deletes row — immutable audit trail).
-- CRITICAL: dpdp_processing inserted atomically on POST /auth/firebase/verify.
-- If consent_given=false in the auth request → 400 CONSENT_REQUIRED.
-- MASTER_CONTEXT Rule 21.
-- =============================================================================

CREATE TYPE consent_type_enum AS ENUM (
  'dpdp_processing',         -- Mandatory: data processing under DPDP Act 2023.
                             --   Inserted at first login. Cannot be withdrawn without
                             --   triggering full account deletion flow.
  'aadhaar_hash',            -- DigiLocker Aadhaar-linked verification consent.
                             --   Required before DigiLocker OAuth2 PKCE flow initiates.
  'data_sharing_tsaas'       -- Consent to share trust score with TSaaS B2B clients.
                             --   Required before tsaas_usage_log.consent_verified=TRUE.
);

CREATE TABLE consent_records (
  id              UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID                NOT NULL
                                      REFERENCES users(id) ON DELETE CASCADE,
  consent_type    consent_type_enum   NOT NULL,

  -- Grant evidence (DPDP evidentiary requirement)
  granted_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  ip_address      INET,               -- client IP at consent grant
  user_agent      TEXT,               -- client UA at consent grant
  consent_version VARCHAR(20)         NOT NULL DEFAULT '1.0',  -- version of consent text shown

  -- Withdrawal (DPDP right to withdraw consent, Art. 6)
  withdrawn_at    TIMESTAMPTZ,        -- NULL = consent still active
  withdrawal_ip   INET,

  -- One active consent record per user per type (enforced by UNIQUE constraint)
  CONSTRAINT uq_consent_user_type UNIQUE (user_id, consent_type)
);

-- Active consent check hot path (auth service + TSaaS middleware)
CREATE INDEX idx_consent_records_user_active
  ON consent_records (user_id, consent_type)
  WHERE withdrawn_at IS NULL;

-- DPDP audit: find all withdrawn consents in a period
CREATE INDEX idx_consent_records_withdrawn
  ON consent_records (withdrawn_at DESC)
  WHERE withdrawn_at IS NOT NULL;

-- Compliance: find users by consent version (for consent re-prompting on policy update)
CREATE INDEX idx_consent_records_version
  ON consent_records (consent_version, consent_type);

COMMENT ON TABLE consent_records IS
  'DPDP Act 2023 compliant consent audit trail. Immutable — rows never deleted. '
  'dpdp_processing: atomically inserted with user row on first POST /auth/firebase/verify. '
  'consent_given=false in auth request → 400 CONSENT_REQUIRED, user not created. '
  'Withdrawal via DELETE /api/v1/users/me/consent/:type → sets withdrawn_at only. '
  'Full account deletion: DELETE /api/v1/users/me → soft delete + SQS anonymisation. '
  'NEVER store Aadhaar number anywhere. MASTER_CONTEXT Rules 1, 21.';

COMMENT ON COLUMN consent_records.withdrawn_at IS
  'DPDP right to withdraw consent. NULL = active consent. '
  'Withdrawal of dpdp_processing triggers the full account deletion flow '
  '(soft delete + SQS anonymisation within 72h). '
  'Withdrawal of data_sharing_tsaas blocks future TSaaS API responses for this provider.';

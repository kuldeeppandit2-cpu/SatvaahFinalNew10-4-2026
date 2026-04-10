-- =============================================================================
-- V030: certificate_records
-- SatvAAh Certificate of Verification. ONE per provider lifetime.
-- Issued by Lambda:certificate-generator when trust_tier FIRST reaches highly_trusted
-- (display_score >= 80). Idempotency: Lambda checks UNIQUE(provider_id) before generating.
-- Format: SAT-{CITY}-{YEAR}-{5DIGIT_SEQ} e.g. SAT-HYD-2026-08412
-- Storage: s3://satvaaah-documents/certificates/{city_id}/{provider_id}/{certId}.pdf
-- Public verification: satvaaah.com/verify/{certId} via CloudFront (no auth, cached).
-- Grace period: revoked if score below 80 for system_config certificate_below_grace_days (30d).
-- MASTER_CONTEXT: Trust Score Model, lambdas/certificate-generator.
-- =============================================================================

CREATE TABLE certificate_records (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- SAT-HYD-2026-08412 format. UNIQUE across all certificates.
  certificate_id        VARCHAR(30)   NOT NULL UNIQUE,

  -- UNIQUE on provider_id: one certificate per provider lifetime.
  -- Lambda:certificate-generator checks this before generating to ensure idempotency.
  provider_id           UUID          NOT NULL UNIQUE
                                      REFERENCES provider_profiles(id) ON DELETE CASCADE,

  city_id               UUID
                                      REFERENCES cities(id) ON DELETE SET NULL,

  -- Issue metadata
  issued_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  trust_score_at_issue  SMALLINT      NOT NULL
                                      CHECK (trust_score_at_issue >= 80),  -- must be >= highly_trusted threshold

  -- Validity
  is_valid              BOOLEAN       NOT NULL DEFAULT TRUE,
  valid_until           TIMESTAMPTZ,  -- NULL = no fixed expiry (revocation via grace period only)

  -- Revocation
  revoked_at            TIMESTAMPTZ,
  revocation_reason     TEXT,
  revoked_by            VARCHAR(100), -- admin_users.email or 'system' (grace period expiry)

  -- Grace period tracking (system_config: certificate_below_grace_days = 30)
  -- Set when display_score drops below 80. Cleared if score recovers above 80.
  below_threshold_since TIMESTAMPTZ,

  -- Storage
  -- s3://satvaaah-documents/certificates/{city_id}/{provider_id}/{certificate_id}.pdf
  s3_key                TEXT          NOT NULL,

  -- Public verification URL (CloudFront, no auth, response cached at edge)
  -- system_config: certificate_verification_base_url = https://satvaaah.com/verify
  verification_url      TEXT          NOT NULL,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_revocation_consistency
    CHECK (
      (is_valid = TRUE  AND revoked_at IS NULL)  OR
      (is_valid = FALSE AND revoked_at IS NOT NULL)
    )
);

-- Public verification lookup: satvaaah.com/verify/{certId}
-- High traffic — CloudFront caches but this covers cache misses
CREATE UNIQUE INDEX idx_certificate_cert_id
  ON certificate_records (certificate_id);

-- Lambda idempotency: check before generating certificate
CREATE UNIQUE INDEX idx_certificate_provider_id
  ON certificate_records (provider_id);

-- Grace period monitoring: Lambda:trust-recalculate sets/clears below_threshold_since
-- If below_threshold_since > NOW() - interval '30 days' → revoke
CREATE INDEX idx_certificate_grace_period
  ON certificate_records (below_threshold_since ASC)
  WHERE is_valid = TRUE AND below_threshold_since IS NOT NULL;

COMMENT ON TABLE certificate_records IS
  'SatvAAh Certificate of Verification. One per provider lifetime. '
  'Issued by Lambda:certificate-generator when trust_tier first reaches highly_trusted '
  '(display_score >= 80, system_config: trust_tier_highly_trusted_threshold). '
  'UNIQUE(provider_id): Lambda:certificate-generator checks before generating — never re-issues. '
  'certificate_id format: SAT-{CITY_CODE}-{YEAR}-{5DIGIT_SEQ}. '
  'Stored at: s3://satvaaah-documents/certificates/{city_id}/{provider_id}/{certId}.pdf '
  '           system_config: certificate_s3_bucket = satvaaah-documents. '
  'Public verification: https://satvaaah.com/verify/{certId} (CloudFront, no auth). '
  'Grace period: if display_score drops below 80 for certificate_below_grace_days (30d) → revoked. '
  'If score recovers above 80 within grace period → below_threshold_since cleared. '
  'WhatsApp notification on issue: certificate_ready template (template 15).';

COMMENT ON COLUMN certificate_records.below_threshold_since IS
  'Set by Lambda:trust-recalculate when display_score drops below 80 (highly_trusted threshold). '
  'Cleared if score recovers above 80 within the grace period. '
  'Checked daily: if NOW() - below_threshold_since > certificate_below_grace_days → revoke. '
  'system_config: certificate_below_grace_days = 30.';

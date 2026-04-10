-- =============================================================================
-- V025: refresh_tokens
-- Refresh token store. bcrypt(jti, cost=12) stored — NEVER the raw token.
-- JWT: RS256 asymmetric only. Access: 24h. Refresh: 30d.
-- Rotation: new token issued on every use, old one revoked atomically.
-- Multi-device: one row per device per user. Logout-all revokes all rows for user.
-- MASTER_CONTEXT Rules 7, 8, 15.
-- =============================================================================

CREATE TABLE refresh_tokens (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID          NOT NULL
                                REFERENCES users(id) ON DELETE CASCADE,

  -- NEVER store raw JWT or raw JTI.
  -- token_hash = bcrypt(jti_from_jwt_payload, cost=12).
  -- MASTER_CONTEXT Rule 8.
  token_hash      VARCHAR(256)  NOT NULL UNIQUE,

  -- Multi-device support
  device_id       VARCHAR(256),               -- device fingerprint (not PII)
  device_name     VARCHAR(100),               -- human label: "iPhone 15 Pro" (display only)

  -- Expiry: NOW() + system_config jwt_refresh_expiry_days (default 30)
  expires_at      TIMESTAMPTZ   NOT NULL,

  -- Lifecycle
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ,               -- updated on every successful refresh
  revoked_at      TIMESTAMPTZ,               -- set on logout or rotation
  is_revoked      BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Rotation chain: new_token.rotated_from = this token's id
  -- Allows detection of token reuse attacks (old token used after rotation → revoke all)
  rotated_from    UUID          REFERENCES refresh_tokens(id) ON DELETE SET NULL,

  CONSTRAINT chk_revoke_consistency
    CHECK (
      (is_revoked = FALSE AND revoked_at IS NULL) OR
      (is_revoked = TRUE  AND revoked_at IS NOT NULL)
    )
);

-- Auth hot path: validate incoming token hash (most frequent query)
-- Filtered: only active, unexpired tokens
CREATE INDEX idx_refresh_tokens_hash_active
  ON refresh_tokens (token_hash)
  WHERE is_revoked = FALSE;

-- Logout all devices: revoke all active tokens for a user
CREATE INDEX idx_refresh_tokens_user_active
  ON refresh_tokens (user_id)
  WHERE is_revoked = FALSE;

-- Cleanup job: find expired but not-yet-revoked tokens
CREATE INDEX idx_refresh_tokens_expired
  ON refresh_tokens (expires_at ASC, is_revoked);

-- Rotation chain: detect token reuse (security audit)
CREATE INDEX idx_refresh_tokens_rotated_from
  ON refresh_tokens (rotated_from)
  WHERE rotated_from IS NOT NULL;

COMMENT ON TABLE refresh_tokens IS
  'Refresh token store. NEVER stores raw JWT or raw JTI. '
  'token_hash = bcrypt(jti, cost=12). MASTER_CONTEXT Rules 7, 8. '
  'JWT: RS256 asymmetric. Auth service holds private key. Never HS256. '
  'Access token expiry: 24h (system_config: jwt_access_expiry_seconds). '
  'Refresh token expiry: 30d (system_config: jwt_refresh_expiry_days). '
  'Rotation: on every POST /api/v1/auth/token/refresh, old token revoked atomically, '
  'new token issued. Token reuse after rotation detected by rotated_from chain → '
  'all user tokens revoked (compromise detection). MASTER_CONTEXT Rule 15.';

COMMENT ON COLUMN refresh_tokens.token_hash IS
  'bcrypt(jti, cost=12). The JTI is extracted from the refresh JWT payload. '
  'Auth service hashes the JTI from the incoming token and does WHERE token_hash = hash. '
  'bcrypt is slow (intentional) — Redis caches the valid token hash for 5 min TTL.';

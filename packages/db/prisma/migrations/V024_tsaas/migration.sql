-- =============================================================================
-- V024: tsaas_api_keys + tsaas_usage_log
-- Trust-as-a-Service (TSaaS) B2B API infrastructure.
-- Endpoints: /api/v2/tsaas/ prefix. Auth header: X-TSaaS-API-Key.
-- Key storage: bcrypt(raw_key, cost=12). Raw key shown ONCE at creation, never stored.
-- Monthly quota enforced per client. data_sharing_tsaas consent checked before each call.
-- MASTER_CONTEXT: services/trust port 3004 handles TSaaS endpoints.
-- =============================================================================

CREATE TABLE tsaas_api_keys (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         VARCHAR(100)  NOT NULL UNIQUE,  -- e.g. 'urban-company-prod'
  client_name       VARCHAR(200)  NOT NULL,

  -- Raw API key shown ONCE at creation. bcrypt(raw_key, cost=12) stored here.
  -- MASTER_CONTEXT Rule 7: bcrypt cost 12 for all hashing.
  hashed_key        VARCHAR(256)  NOT NULL UNIQUE,

  -- Quota management (reset monthly by scheduled Lambda)
  monthly_limit     INT           NOT NULL DEFAULT 1000, -- system_config: tsaas_default_monthly_limit
  calls_used        INT           NOT NULL DEFAULT 0
                                  CHECK (calls_used >= 0),
  calls_reset_at    TIMESTAMPTZ,  -- when calls_used was last zeroed

  -- Lifecycle
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deactivated_at    TIMESTAMPTZ,
  created_by        VARCHAR(100)  NOT NULL DEFAULT 'admin',  -- admin_users.email

  -- Allowed endpoints (NULL = all /api/v2/tsaas/ routes)
  allowed_endpoints TEXT[],

  CONSTRAINT chk_monthly_limit_positive CHECK (monthly_limit > 0)
);

CREATE TABLE tsaas_usage_log (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         VARCHAR(100)  NOT NULL
                                  REFERENCES tsaas_api_keys(client_id) ON DELETE CASCADE,
  provider_id       UUID
                                  REFERENCES provider_profiles(id) ON DELETE SET NULL,

  -- Request details
  endpoint          VARCHAR(200)  NOT NULL,   -- e.g. '/api/v2/tsaas/trust/abc-uuid'
  http_method       VARCHAR(10)   NOT NULL DEFAULT 'GET',
  called_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  response_code     SMALLINT      NOT NULL,   -- HTTP status code
  response_time_ms  INT           CHECK (response_time_ms >= 0),

  -- Consent audit (DPDP: data_sharing_tsaas must be active before data returned)
  consent_verified  BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Tracing
  ip_address        INET,
  correlation_id    VARCHAR(128)
);

-- -----------------------------------------------------------------------
-- INDEXES: tsaas_api_keys
-- -----------------------------------------------------------------------

-- Auth middleware hot path: validate X-TSaaS-API-Key header
-- Service hashes the header, then looks up by hashed_key
CREATE INDEX idx_tsaas_api_keys_hashed_key
  ON tsaas_api_keys (hashed_key)
  WHERE is_active = TRUE;

-- Admin portal: list all active clients
CREATE INDEX idx_tsaas_api_keys_active
  ON tsaas_api_keys (is_active, created_at DESC);

-- -----------------------------------------------------------------------
-- INDEXES: tsaas_usage_log
-- -----------------------------------------------------------------------

-- Monthly billing / quota check per client
CREATE INDEX idx_tsaas_usage_log_client_month
  ON tsaas_usage_log (client_id, called_at DESC);

-- Per-provider data access audit (consent compliance)
CREATE INDEX idx_tsaas_usage_log_provider
  ON tsaas_usage_log (provider_id, called_at DESC)
  WHERE provider_id IS NOT NULL;

-- Response code analytics (error rate monitoring)
CREATE INDEX idx_tsaas_usage_log_error
  ON tsaas_usage_log (response_code, called_at DESC)
  WHERE response_code >= 400;

COMMENT ON TABLE tsaas_api_keys IS
  'TSaaS B2B API key registry. Hashed with bcrypt(cost=12). Raw key shown ONCE at creation. '
  'Monthly quota: calls_used vs monthly_limit (from system_config: tsaas_default_monthly_limit). '
  'Rate limit: system_config tsaas_rate_limit_per_minute (enforced by Redis rate limiter). '
  'Auth: X-TSaaS-API-Key header. Endpoints: /api/v2/tsaas/ (services/trust port 3004).';

COMMENT ON TABLE tsaas_usage_log IS
  'Every TSaaS API call logged for billing, rate limiting, and DPDP consent audit. '
  'consent_verified must be TRUE — checks data_sharing_tsaas consent before returning data. '
  'Provider can withdraw data_sharing_tsaas consent at any time → future calls return 403.';

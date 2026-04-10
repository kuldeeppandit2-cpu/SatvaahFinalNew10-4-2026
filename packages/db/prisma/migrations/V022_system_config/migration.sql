-- =============================================================================
-- V022: system_config
-- Central admin-configurable key-value store. 68 keys seeded in V031.
-- Loaded at startup by packages/config/src/systemConfig.ts → loadSystemConfig().
-- Hot-reloaded on SIGHUP signal sent to any microservice.
-- CRITICAL: NEVER hardcode thresholds in application code. Always read from here.
-- MASTER_CONTEXT Rule 20: Nothing hardcoded. All thresholds in system_config.
-- =============================================================================

CREATE TABLE system_config (
  key          VARCHAR(100)  PRIMARY KEY,
  value        TEXT          NOT NULL,
  description  TEXT,
  data_type    VARCHAR(20)   NOT NULL DEFAULT 'string'
                             CHECK (data_type IN (
                               'string', 'integer', 'float', 'boolean', 'json'
                             )),
  updated_by   VARCHAR(100)  NOT NULL DEFAULT 'system',
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Track recent changes for admin audit (full table is only 68 rows — very cheap)
CREATE INDEX idx_system_config_updated_at
  ON system_config (updated_at DESC);

COMMENT ON TABLE system_config IS
  'Admin-configurable key-value store. 68 keys seeded in V031 with production defaults. '
  'Loaded by loadSystemConfig() in packages/config/src/systemConfig.ts. '
  'Hot-reloaded on SIGHUP. Admin-editable without code deploy or service restart '
  '(services receive SIGHUP and reload). '
  'NEVER hardcode any threshold, limit, or policy. MASTER_CONTEXT Rule 20.';

COMMENT ON COLUMN system_config.data_type IS
  'Informs the config loader how to parse the value TEXT field: '
  'integer → parseInt, float → parseFloat, boolean → value===''true'', '
  'json → JSON.parse, string → raw string.';

COMMENT ON COLUMN system_config.updated_by IS
  'admin_users.email of the admin who last changed this value. '
  '''system'' for seed-time defaults. Audit trail for compliance.';

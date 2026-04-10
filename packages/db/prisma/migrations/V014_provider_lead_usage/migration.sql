-- =============================================================================
-- V014_provider_lead_usage — SatvAAh
-- Monthly lead tracking for providers.
-- Tracks: received / accepted / declined / expired leads per calendar month.
-- Used by: provider analytics, admin dashboard, subscription plan enforcement.
-- UNIQUE(provider_id, month) enforces one row per provider per month.
-- month column: always first day of month (DATE_TRUNC('month', NOW())::DATE).
-- =============================================================================

CREATE TABLE provider_lead_usage (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),

  provider_id         UUID    NOT NULL
                        REFERENCES provider_profiles(id) ON DELETE CASCADE,

  -- First day of month: e.g. 2026-04-01 for April 2026
  -- Application must always use DATE_TRUNC('month', NOW())::DATE for inserts
  month               DATE    NOT NULL,

  -- Monthly allocation from subscription plan
  leads_allocated     INT     NOT NULL DEFAULT 0 CHECK (leads_allocated >= 0),

  -- Total contact events where provider was the recipient
  leads_received      INT     NOT NULL DEFAULT 0 CHECK (leads_received >= 0),

  -- Provider accepted the lead (consumer phone revealed, quota counted)
  leads_accepted      INT     NOT NULL DEFAULT 0 CHECK (leads_accepted >= 0),

  -- Provider declined (lead returned to consumer)
  leads_declined      INT     NOT NULL DEFAULT 0 CHECK (leads_declined >= 0),

  -- Lead expired without provider action (lead returned to consumer)
  leads_expired       INT     NOT NULL DEFAULT 0 CHECK (leads_expired >= 0),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT plu_provider_month_key UNIQUE (provider_id, month),

  -- Sanity: received >= accepted + declined + expired (some may be pending)
  CONSTRAINT plu_totals_coherent
    CHECK (leads_received >= leads_accepted + leads_declined + leads_expired)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Provider analytics: monthly history (newest first)
CREATE INDEX idx_plu_provider_month
  ON provider_lead_usage(provider_id, month DESC);

-- Platform-wide monthly analytics
CREATE INDEX idx_plu_month
  ON provider_lead_usage(month DESC);

-- =============================================================================
-- TRIGGER: auto-update updated_at
-- =============================================================================
CREATE TRIGGER trg_plu_updated_at
  BEFORE UPDATE ON provider_lead_usage
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  provider_lead_usage IS
  'Monthly lead statistics per provider. '
  'UNIQUE(provider_id, month) — one row per provider per calendar month. '
  'month column is always first day: DATE_TRUNC(month, NOW())::DATE.';

COMMENT ON COLUMN provider_lead_usage.month IS
  'Always first day of month. Insert using: DATE_TRUNC(''month'', NOW())::DATE.';

COMMENT ON COLUMN provider_lead_usage.leads_received IS
  'All contact events received, regardless of outcome.';

COMMENT ON COLUMN provider_lead_usage.leads_accepted IS
  'Leads where provider accepted → consumer phone revealed → counted against quota.';

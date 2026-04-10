-- =============================================================================
-- V013_consumer_lead_usage — SatvAAh
-- Tracks consumer lead allocation and consumption per billing period.
-- Lead quota: determined by subscription_plan.leads_allocated.
-- Lead counted ONLY when provider accepts (contact_events.status = 'accepted').
-- Lead returned when provider declines OR contact_event expires.
-- Rating bonus: +2 leads on approved rating (rating_bonus_leads=2 in system_config).
--
-- FK to subscription_plans added by V015 (deferred — subscription_plans not yet created).
-- =============================================================================

CREATE TABLE consumer_lead_usage (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),

  consumer_id           UUID    NOT NULL
                          REFERENCES users(id) ON DELETE CASCADE,

  -- FK to subscription_plans.id — added by V015 via ALTER TABLE
  subscription_plan_id  UUID,

  -- Billing period (inclusive range)
  period_start          DATE    NOT NULL,
  period_end            DATE    NOT NULL,

  -- Leads granted for this period (from subscription plan + any bonuses)
  leads_allocated       INT     NOT NULL DEFAULT 0 CHECK (leads_allocated >= 0),

  -- Leads consumed so far in this period (incremented on accepted contact_event)
  leads_used            INT     NOT NULL DEFAULT 0 CHECK (leads_used >= 0),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One active period per consumer at a time
  CONSTRAINT clu_consumer_period_start_key UNIQUE (consumer_id, period_start),

  CONSTRAINT clu_period_valid CHECK (period_end >= period_start),
  CONSTRAINT clu_usage_within_allocation CHECK (leads_used <= leads_allocated + 50)
  -- +50 buffer allows temporary overage during concurrent accept race conditions
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Primary lookup: current period for a consumer
CREATE INDEX idx_clu_consumer_active
  ON consumer_lead_usage(consumer_id, period_end DESC);

-- Subscription plan query (backfill after V015 FK is added)
CREATE INDEX idx_clu_subscription_plan_id
  ON consumer_lead_usage(subscription_plan_id)
  WHERE subscription_plan_id IS NOT NULL;

-- =============================================================================
-- TRIGGER: auto-update updated_at
-- =============================================================================
CREATE TRIGGER trg_clu_updated_at
  BEFORE UPDATE ON consumer_lead_usage
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  consumer_lead_usage IS
  'Consumer lead quota tracking per billing period. '
  'leads_used incremented on contact_event accepted. '
  'Returned on decline/expiry. Bonus +2 on rating (system_config: rating_bonus_leads).';

COMMENT ON COLUMN consumer_lead_usage.subscription_plan_id IS
  'FK to subscription_plans(id) added by V015 migration. Nullable until then.';

COMMENT ON COLUMN consumer_lead_usage.leads_allocated IS
  'From subscription_plan.leads_allocated + any admin-granted bonuses.';

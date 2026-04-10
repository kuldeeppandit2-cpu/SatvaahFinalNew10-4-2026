-- =============================================================================
-- V043_subscriptions_alignment
-- Aligns subscription_plans and subscription_records (V015) with schema.prisma.
--
-- subscription_plans:
--   plan_name → display_name
--   billing_cycle_days → validity_days
--   Add: description TEXT, sort_order INT
--   UserType and SubscriptionStatus enums: keep in DB (unused by Prisma)
--
-- subscription_records:
--   amount_paid_paise → amount_paise
--   idempotency_key TEXT → VARCHAR (UUID format, keep as VARCHAR for flexibility)
--   Add: razorpay_subscription_id, cancelled_at, cancellation_reason,
--        refund_amount_paise, refunded_at
--
-- V017 taxonomy_nodes:
--   display_name VARCHAR(200) added (required by schema, missing from V017)
--   parent_id UUID added (self-referential for hierarchy)
--   search_rank → sort_order (renamed)
-- =============================================================================

-- ─── subscription_plans ──────────────────────────────────────────────────────
ALTER TABLE subscription_plans
  RENAME COLUMN plan_name TO display_name;

ALTER TABLE subscription_plans
  RENAME COLUMN billing_cycle_days TO validity_days;

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sort_order  INT  NOT NULL DEFAULT 0;

-- ─── subscription_records ─────────────────────────────────────────────────────
ALTER TABLE subscription_records
  RENAME COLUMN amount_paid_paise TO amount_paise;

ALTER TABLE subscription_records
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cancelled_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason      VARCHAR(500),
  ADD COLUMN IF NOT EXISTS refund_amount_paise       INT,
  ADD COLUMN IF NOT EXISTS refunded_at               TIMESTAMPTZ;

-- ─── taxonomy_nodes ───────────────────────────────────────────────────────────
-- Add display_name (computed from l1-l4 hierarchy for search/display)
ALTER TABLE taxonomy_nodes
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(200);

-- Back-fill display_name from taxonomy levels
UPDATE taxonomy_nodes
  SET display_name = COALESCE(
    CASE
      WHEN l4 IS NOT NULL THEN l4
      WHEN l3 IS NOT NULL THEN l3
      WHEN l2 IS NOT NULL THEN l2
      ELSE l1
    END,
    l1
  )
  WHERE display_name IS NULL;

ALTER TABLE taxonomy_nodes ALTER COLUMN display_name SET NOT NULL;

-- Add parent_id for self-referential hierarchy (l1→l2→l3→l4 as tree)
ALTER TABLE taxonomy_nodes
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES taxonomy_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tn_parent_id
  ON taxonomy_nodes(parent_id)
  WHERE parent_id IS NOT NULL;

-- Rename search_rank → sort_order (schema.prisma uses sort_order)
-- Only rename if search_rank exists (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'taxonomy_nodes' AND column_name = 'search_rank'
  ) THEN
    ALTER TABLE taxonomy_nodes RENAME COLUMN search_rank TO sort_order;
  ELSE
    ALTER TABLE taxonomy_nodes ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Constrain slug to VarChar(200) (V017 had VarChar(400), schema has VarChar(200))
ALTER TABLE taxonomy_nodes
  ALTER COLUMN slug TYPE VARCHAR(200);

COMMENT ON COLUMN subscription_plans.display_name IS 'Renamed from plan_name. Human-readable: Provider Gold Monthly.';
COMMENT ON COLUMN subscription_plans.validity_days IS 'Renamed from billing_cycle_days.';
COMMENT ON COLUMN taxonomy_nodes.display_name IS 'Computed from leaf l4/l3/l2/l1 for search and autocomplete.';
COMMENT ON COLUMN taxonomy_nodes.parent_id IS 'Self-referential for tree hierarchy. NULL for l1 roots.';

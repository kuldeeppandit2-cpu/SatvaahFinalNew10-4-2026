-- =============================================================================
-- V008_trust_score_history — SatvAAh
-- IMMUTABLE audit ledger of every trust score change.
-- Records belong to a provider FOREVER — even after account deletion.
-- No UPDATE or DELETE is ever permitted. Enforced by database triggers.
--
-- Written ONLY by Lambda:trust-recalculate.
-- Application code must NEVER INSERT directly.
-- Admins must NEVER delete rows — use trust_flags for dispute resolution instead.
-- =============================================================================

CREATE TABLE trust_score_history (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Provider this event belongs to. RESTRICT prevents accidental provider deletion
  -- while history exists (history belongs to provider forever).
  provider_id         UUID          NOT NULL
                        REFERENCES provider_profiles(id) ON DELETE RESTRICT,

  -- What caused this change: signal_gained, signal_lost, manual_override, etc.
  event_type          VARCHAR(100)  NOT NULL,

  -- Which trust signal triggered this change (NULL for composite recalculation)
  signal_name         VARCHAR(100),

  -- Points delta: positive = gain, negative = loss, 0 = tier-only change
  delta_pts           INT           NOT NULL,

  -- Score after this event (snapshot)
  new_display_score   INT           NOT NULL
                        CHECK (new_display_score >= 0 AND new_display_score <= 100),
  new_raw_score       INT           NOT NULL DEFAULT 0
                        CHECK (new_raw_score >= 0),

  -- Tier after this event (snapshot)
  new_tier            "TrustTier"   NOT NULL,

  -- Which process triggered this recalculation (for audit trail)
  -- Examples: 'lambda:trust-recalculate', 'admin:force-recalc', 'admin:signal-override'
  triggered_by        VARCHAR(100),

  -- X-Correlation-ID from the triggering request/SQS message
  correlation_id      VARCHAR(100),

  -- Immutable event timestamp — DEFAULT NOW() set at INSERT, never changed
  event_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()

  -- NO updated_at column — this table is IMMUTABLE by design
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Primary query: full score history for a provider, newest first
CREATE INDEX idx_tsh_provider_event_at
  ON trust_score_history(provider_id, event_at DESC);

-- Timeline queries across all providers
CREATE INDEX idx_tsh_event_at
  ON trust_score_history(event_at DESC);

-- Audit: find all events of a specific type
CREATE INDEX idx_tsh_event_type
  ON trust_score_history(event_type);

-- Audit: signal-level drill-down
CREATE INDEX idx_tsh_signal_name
  ON trust_score_history(signal_name)
  WHERE signal_name IS NOT NULL;

-- =============================================================================
-- IMMUTABILITY ENFORCEMENT
-- =============================================================================
-- These triggers make trust_score_history a true append-only ledger.
-- No UPDATE or DELETE is possible — not from application code, not from admin,
-- not from Lambda. History belongs to the provider forever.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_trust_score_history_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'trust_score_history is IMMUTABLE. '
    'UPDATE and DELETE are FORBIDDEN on this table. '
    'Records belong to the provider forever per SatvAAh trust architecture. '
    'Use trust_flags for dispute resolution. '
    'Operation attempted: % on provider_id: %',
    TG_OP,
    COALESCE(OLD.provider_id::TEXT, 'unknown');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION fn_trust_score_history_immutable() IS
  'Enforcement trigger for trust_score_history immutability. '
  'Raises EXCEPTION on any UPDATE or DELETE attempt.';

-- Block all UPDATEs
CREATE TRIGGER trg_tsh_no_update
  BEFORE UPDATE ON trust_score_history
  FOR EACH ROW EXECUTE FUNCTION fn_trust_score_history_immutable();

-- Block all DELETEs
CREATE TRIGGER trg_tsh_no_delete
  BEFORE DELETE ON trust_score_history
  FOR EACH ROW EXECUTE FUNCTION fn_trust_score_history_immutable();

-- Note: TRUNCATE is not caught by row-level triggers.
-- TRUNCATE access on trust_score_history must be revoked from all roles.
REVOKE TRUNCATE ON trust_score_history FROM PUBLIC;

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  trust_score_history IS
  'IMMUTABLE trust score audit ledger. Append-only. '
  'No UPDATE or DELETE ever permitted — enforced by database triggers. '
  'Written only by Lambda:trust-recalculate. '
  'Records belong to the provider forever, even after account deletion.';

COMMENT ON COLUMN trust_score_history.delta_pts IS
  'Signed integer: positive = score gain, negative = score loss, 0 = tier-only.';

COMMENT ON COLUMN trust_score_history.event_at IS
  'IMMUTABLE timestamp. Set at INSERT. Never changes. No updated_at on this table.';

COMMENT ON COLUMN trust_score_history.triggered_by IS
  'Human-readable source identifier: lambda:trust-recalculate, admin:force-recalc, etc.';

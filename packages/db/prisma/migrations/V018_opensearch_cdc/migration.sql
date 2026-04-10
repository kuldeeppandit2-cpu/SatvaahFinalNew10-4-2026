-- =============================================================================
-- V018_opensearch_cdc — SatvAAh
-- PostgreSQL CDC trigger: fires on every INSERT / UPDATE / DELETE on
-- provider_profiles and emits a notification for downstream OpenSearch sync.
--
-- FLOW:
--   provider_profiles change
--     → fn_provider_opensearch_cdc() trigger fires (AFTER, per-row)
--     → pg_notify('opensearch_cdc', payload::TEXT)
--     → CDC bridge listener (Node.js in services/user OR dedicated Lambda bridge)
--     → enqueues JSON message to SQS queue: satvaaah-opensearch-sync
--     → Lambda:opensearch-sync consumes SQS message
--     → upserts / deletes document in OpenSearch index: satvaaah_providers
--
-- WHY pg_notify (not aws_lambda extension):
--   • Works identically in local Docker dev (PostgreSQL 15) and AWS RDS
--   • aws_lambda extension requires IAM role attached to RDS instance
--   • pg_notify is zero-latency, zero-cost, built-in
--   • CDC bridge listener in services/user already holds a persistent PG connection
--   • SQS retain: 14 days. DLQ for opensearch-sync. maxReceiveCount=3 before DLQ.
--
-- TRUST SCORE COVERAGE:
--   trust_score in provider_profiles is written by Lambda:trust-recalculate.
--   That write triggers this CDC trigger → OpenSearch gets the updated score
--   immediately. No polling needed.
--
-- CRITICAL RULE 4: providers.trust_score is DB-trigger propagated to OpenSearch.
--   Application code NEVER writes trust_score directly.
-- =============================================================================

-- =============================================================================
-- CDC TRIGGER FUNCTION
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_provider_opensearch_cdc()
RETURNS TRIGGER AS $$
DECLARE
  v_provider_id   UUID;
  v_payload       JSONB;
BEGIN
  -- Resolve provider_id for all 3 DML operations
  IF TG_OP = 'DELETE' THEN
    v_provider_id := OLD.id;
  ELSE
    v_provider_id := NEW.id;
  END IF;

  -- Build CDC payload
  -- epoch_ms: millisecond precision for ordered processing in SQS consumer
  v_payload := jsonb_build_object(
    'provider_id',    v_provider_id,
    'operation',      TG_OP,                              -- 'INSERT' | 'UPDATE' | 'DELETE'
    'table',          TG_TABLE_NAME,                      -- 'provider_profiles'
    'schema',         TG_TABLE_SCHEMA,                    -- 'public'
    'event_at',       NOW(),                              -- TIMESTAMPTZ
    'epoch_ms',       (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
  );

  -- Emit PostgreSQL NOTIFY on channel 'opensearch_cdc'
  -- Payload is the JSON string (max 8000 bytes; always fits — only IDs + metadata)
  -- Listener: services/user CDC bridge subscribes with LISTEN opensearch_cdc
  PERFORM pg_notify('opensearch_cdc', v_payload::TEXT);

  -- Return correct row for AFTER trigger
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;

EXCEPTION
  -- NOTIFY failures must never block the originating write transaction.
  -- Log to server log and continue. OpenSearch will catch up via periodic resync.
  WHEN OTHERS THEN
    RAISE WARNING 'fn_provider_opensearch_cdc: NOTIFY failed for provider_id=%, op=%, error=%',
      v_provider_id, TG_OP, SQLERRM;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION fn_provider_opensearch_cdc() IS
  'CDC trigger: emits pg_notify(opensearch_cdc, payload) on every provider_profiles '
  'INSERT/UPDATE/DELETE. Failure is non-fatal (WARN only) — never blocks write. '
  'Bridge listener (services/user) forwards to SQS satvaaah-opensearch-sync queue.';

-- =============================================================================
-- CDC TRIGGER: AFTER INSERT OR UPDATE OR DELETE
-- Using AFTER (not BEFORE) so the notified data reflects committed state.
-- FOR EACH ROW: one notification per changed row (not per statement).
-- =============================================================================
CREATE TRIGGER trg_provider_opensearch_cdc
  AFTER INSERT OR UPDATE OR DELETE ON provider_profiles
  FOR EACH ROW
  EXECUTE FUNCTION fn_provider_opensearch_cdc();

COMMENT ON TRIGGER trg_provider_opensearch_cdc ON provider_profiles IS
  'OpenSearch CDC trigger. Fires AFTER every INSERT/UPDATE/DELETE. '
  'Emits pg_notify → CDC bridge → SQS satvaaah-opensearch-sync → Lambda:opensearch-sync.';

-- =============================================================================
-- SUPPORTING FUNCTION: manual CDC resync
-- Called by POST /api/v1/admin/opensearch/resync (admin service, port 3009)
-- Emits a NOTIFY for every active provider — used after OpenSearch index rebuild.
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_opensearch_full_resync(p_city_id UUID DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
  v_row     provider_profiles%ROWTYPE;
  v_count   INTEGER := 0;
  v_payload JSONB;
BEGIN
  FOR v_row IN
    SELECT * FROM provider_profiles
    WHERE is_active = TRUE
      AND (p_city_id IS NULL OR city_id = p_city_id)
    ORDER BY updated_at DESC
  LOOP
    v_payload := jsonb_build_object(
      'provider_id',  v_row.id,
      'operation',    'RESYNC',
      'table',        'provider_profiles',
      'schema',       'public',
      'event_at',     NOW(),
      'epoch_ms',     (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    );
    PERFORM pg_notify('opensearch_cdc', v_payload::TEXT);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION fn_opensearch_full_resync(UUID) IS
  'Admin resync: emits pg_notify for every active provider in a city (or all cities). '
  'Called by POST /api/v1/admin/opensearch/resync. '
  'p_city_id=NULL resyncs all cities. Returns count of notifications emitted.';

-- =============================================================================
-- SQS MESSAGE CONTRACT (for CDC bridge implementation reference)
-- The CDC bridge (services/user or dedicated Lambda) MUST forward NOTIFY
-- payloads to SQS with this structure:
--
-- SQS Message Body (JSON):
-- {
--   "provider_id":  "uuid",
--   "operation":    "INSERT" | "UPDATE" | "DELETE" | "RESYNC",
--   "table":        "provider_profiles",
--   "schema":       "public",
--   "event_at":     "2026-04-03T12:00:00Z",
--   "epoch_ms":     1743681600000,
--   "correlation_id": "from-X-Correlation-ID-header"   ← added by bridge
-- }
--
-- SQS Queue:       satvaaah-opensearch-sync
-- SQS Retain:      14 days
-- DLQ:             satvaaah-opensearch-sync-dlq
-- maxReceiveCount: 3 (message moves to DLQ after 3 failed Lambda attempts)
-- Lambda:          lambdas/opensearch-sync/
-- OpenSearch index: satvaaah_providers
-- =============================================================================

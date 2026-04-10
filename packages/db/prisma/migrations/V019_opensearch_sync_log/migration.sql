-- =============================================================================
-- V019: opensearch_sync_log
-- Audit trail for every OpenSearch CDC sync event.
-- Populated by Lambda:opensearch-sync (SQS trigger, maxReceiveCount=3, DLQ).
-- Admin resync via /api/v1/admin/opensearch/resync to replay dead_letter events.
-- MASTER_CONTEXT: SQS message retention 14d, DLQ on opensearch-sync, maxReceiveCount=3
-- =============================================================================

CREATE TYPE sync_trigger_type AS ENUM (
  'profile_create',
  'profile_update',
  'trust_score_update',
  'geo_update',
  'availability_update',
  'credential_update',
  'manual_resync',
  'admin_force_sync'
);

CREATE TYPE sync_status_enum AS ENUM (
  'pending',
  'success',
  'failed',
  'retrying',
  'dead_letter'
);

CREATE TABLE opensearch_sync_log (
  id                UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id       UUID            NOT NULL
                                    REFERENCES provider_profiles(id) ON DELETE CASCADE,
  trigger_type      sync_trigger_type NOT NULL,
  sync_status       sync_status_enum  NOT NULL DEFAULT 'pending',
  attempt_count     SMALLINT        NOT NULL DEFAULT 1
                                    CHECK (attempt_count BETWEEN 1 AND 10),
  sqs_message_id    VARCHAR(256),
  lambda_request_id VARCHAR(128),
  correlation_id    VARCHAR(128),
  queued_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  synced_at         TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  error_code        VARCHAR(100),
  error_message     TEXT,
  payload_snapshot  JSONB,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_opensearch_sync_provider_recent
  ON opensearch_sync_log (provider_id, queued_at DESC);

CREATE INDEX idx_opensearch_sync_failed
  ON opensearch_sync_log (sync_status, queued_at DESC)
  WHERE sync_status IN ('failed', 'dead_letter');

CREATE INDEX idx_opensearch_sync_correlation
  ON opensearch_sync_log (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX idx_opensearch_sync_pending_age
  ON opensearch_sync_log (queued_at ASC)
  WHERE sync_status = 'pending';

COMMENT ON TABLE opensearch_sync_log IS
  'Audit trail for every OpenSearch CDC sync event triggered by V018 PostgreSQL trigger. '
  'Populated by Lambda:opensearch-sync. dead_letter rows require admin replay. '
  'SQS maxReceiveCount=3 before DLQ. MASTER_CONTEXT Rule 24.';

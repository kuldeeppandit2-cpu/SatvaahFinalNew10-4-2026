-- =============================================================================
-- V026: trust_flags
-- Dispute and anomaly flags on providers or specific ratings.
-- Flags are system-generated (burst detection, dedup) or consumer-reported.
-- Evidence stored as JSONB for flexibility — types require different evidence shapes.
-- Admin review queue in admin portal module. Resolved via PATCH /api/v1/admin/disputes/:id.
-- MASTER_CONTEXT: services/admin port 3009 handles dispute review.
-- =============================================================================

CREATE TYPE trust_flag_type AS ENUM (
  'rating_burst',           -- system: too many ratings in short window (burst_detection)
  'fake_contact_event',     -- consumer: suspected fake contact event used to unlock rating
  'identity_mismatch',      -- system: claimed identity doesn't match DigiLocker UID hash
  'duplicate_provider',     -- system: high dedup_score match with existing provider_profile
  'spam_contact',           -- consumer: provider sending unsolicited messages
  'abusive_content',        -- consumer: abusive message, bio, or photo content
  'fraudulent_credential',  -- admin: credential document appears forged
  'review_manipulation',    -- system: coordinated review pattern detected by analytics
  'no_show',                -- consumer: provider accepted lead then did not show up
  'other'
);

CREATE TYPE trust_flag_severity AS ENUM (
  'low',       -- informational; auto-resolved if no repeat within 7 days
  'medium',    -- admin attention within 72h; provider warned
  'high',      -- immediate action; provider visibility reduced pending review
  'critical'   -- provider suspended from search results pending admin resolution
);

CREATE TYPE trust_flag_status AS ENUM (
  'open',
  'under_review',
  'resolved_valid',     -- flag confirmed; action taken (trust penalty, suspension, etc.)
  'resolved_invalid',   -- flag dismissed; false positive
  'escalated'           -- escalated to Vatsala Pandit / senior admin
);

CREATE TABLE trust_flags (
  id              UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Subject of the flag
  provider_id     UUID                  NOT NULL
                                        REFERENCES provider_profiles(id) ON DELETE CASCADE,
  rating_id       UUID
                                        REFERENCES ratings(id) ON DELETE SET NULL,

  -- Flagged by: NULL if system-generated
  flagged_by      UUID
                                        REFERENCES users(id) ON DELETE SET NULL,
  is_system_flag  BOOLEAN               NOT NULL DEFAULT FALSE,

  flag_type       trust_flag_type       NOT NULL,
  severity        trust_flag_severity   NOT NULL DEFAULT 'medium',
  status          trust_flag_status     NOT NULL DEFAULT 'open',

  -- Flexible evidence container.
  -- rating_burst example: {"count": 12, "window_minutes": 60, "ip_addresses": [...]}
  -- fake_contact_event example: {"contact_event_id": "...", "consumer_id": "...", "reason": "..."}
  -- identity_mismatch example: {"digilocker_uid_hash": "...", "mismatch_field": "name"}
  evidence        JSONB                 NOT NULL DEFAULT '{}',

  -- Resolution
  resolution      TEXT,
  resolved_by     VARCHAR(100),         -- admin_users.email
  resolved_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

-- Admin queue: open flags ordered by severity (critical first) then age
CREATE INDEX idx_trust_flags_admin_queue
  ON trust_flags (severity DESC, created_at ASC)
  WHERE status = 'open';

-- Provider flag history (trust score calculation reads this)
CREATE INDEX idx_trust_flags_provider
  ON trust_flags (provider_id, created_at DESC);

-- Rating-specific flags (rating dispute flow)
CREATE INDEX idx_trust_flags_rating
  ON trust_flags (rating_id)
  WHERE rating_id IS NOT NULL;

-- System-generated flag monitoring
CREATE INDEX idx_trust_flags_system
  ON trust_flags (flag_type, created_at DESC)
  WHERE is_system_flag = TRUE;

-- Under-review queue (admin working items)
CREATE INDEX idx_trust_flags_under_review
  ON trust_flags (updated_at DESC)
  WHERE status = 'under_review';

COMMENT ON TABLE trust_flags IS
  'Dispute and anomaly flags on providers or ratings. '
  'System-generated: rating_burst (services/rating), duplicate_provider (services/scraping), '
  '                  review_manipulation (Lambda:ai-narration signals anomaly). '
  'Consumer-reported: POST /api/v1/ratings/:id/flag (services/rating). '
  'Admin resolution: PATCH /api/v1/admin/disputes/:id (services/admin port 3009). '
  'critical severity → provider removed from OpenSearch until resolved. '
  'evidence JSONB: no fixed schema — each flag_type carries different evidence shape.';

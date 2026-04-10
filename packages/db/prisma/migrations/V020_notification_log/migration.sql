-- =============================================================================
-- V020: notification_log
-- Every FCM push notification and WhatsApp message is logged here.
-- Lambda:delivery-monitor queries undelivered FCM index every 15 min via EventBridge.
-- wa_fallback_sent=true when WhatsApp triggered as FCM delivery fallback for
-- extraordinary events: new_lead, lead_accepted, certificate_ready.
-- CRITICAL: WhatsApp NEVER for routine product notifications — FCM only.
-- MASTER_CONTEXT Rule 17: wa_channel_policy = cac_and_extraordinary.
-- =============================================================================

CREATE TYPE notification_channel AS ENUM (
  'fcm',
  'whatsapp'
);

-- Mirrors the 16 Meta pre-approved WhatsApp templates + FCM-only event types.
-- MASTER_CONTEXT: 16 templates listed under WHATSAPP section.
CREATE TYPE notification_event_type AS ENUM (
  -- FCM product events (NEVER WhatsApp)
  'push_discovery',               -- provider crosses push_discovery_trust_threshold
  'availability_changed',         -- provider goes live/offline
  'message_received',             -- in-app message from other party
  'rating_prompt',                -- prompt consumer to rate after contact
  'lead_limit_warning',           -- template 13

  -- Extraordinary events (FCM primary, WhatsApp fallback if FCM undelivered > 5 min)
  'new_lead',                     -- template 4: new_contact_request
  'lead_accepted',                -- template 5: contact_accepted
  'lead_declined',                -- template 6: contact_declined
  'certificate_ready',            -- template 15: certificate_ready

  -- Utility events
  'rating_reminder_24h',          -- template 7
  'trust_score_updated',          -- template 8
  'aadhaar_verified',             -- template 9
  'credential_verified',          -- template 10
  'subscription_confirmed',       -- template 11
  'subscription_expiry_7d',       -- template 12: marketing
  'consumer_welcome',             -- template 14

  -- CAC outreach (WhatsApp only — cold acquisition)
  'provider_welcome',             -- template 2: outreach attempt 1
  'activation_reminder_48h',      -- template 3: outreach attempt 2
  'provider_final_reminder_7d'    -- template 16: outreach attempt 3
);

CREATE TABLE notification_log (
  id                UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID                    NOT NULL
                                            REFERENCES users(id) ON DELETE CASCADE,
  channel           notification_channel    NOT NULL,
  event_type        notification_event_type NOT NULL,

  -- Channel-specific IDs
  template_id       VARCHAR(100),           -- WhatsApp: Gupshup template name
  fcm_message_id    VARCHAR(256),           -- Firebase message ID
  wa_message_id     VARCHAR(256),           -- Gupshup delivery ID

  -- Fallback tracking
  wa_fallback_sent  BOOLEAN                 NOT NULL DEFAULT FALSE,
  wa_fallback_triggered_at TIMESTAMPTZ,

  -- Payload (no PII — provider/consumer names stored by reference, not value)
  payload           JSONB,

  -- Lifecycle
  sent_at           TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  delivered_at      TIMESTAMPTZ,
  read_at           TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  failure_reason    TEXT,

  -- Tracing
  correlation_id    VARCHAR(128),
  created_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

-- User notification history (consumer/provider inbox)
CREATE INDEX idx_notification_log_user_recent
  ON notification_log (user_id, sent_at DESC);

-- Lambda:delivery-monitor hot path — undelivered FCM older than 5 min
-- Triggers WhatsApp fallback for new_lead, lead_accepted, certificate_ready
CREATE INDEX idx_notification_log_fcm_undelivered
  ON notification_log (sent_at ASC)
  WHERE channel = 'fcm'
    AND delivered_at IS NULL
    AND failed_at IS NULL
    AND wa_fallback_sent = FALSE;

-- WhatsApp callback lookup by Gupshup message ID
CREATE INDEX idx_notification_log_wa_message_id
  ON notification_log (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

-- Event analytics per type
CREATE INDEX idx_notification_log_event_type
  ON notification_log (event_type, sent_at DESC);

-- WhatsApp-specific index (CAC audit + Meta compliance)
CREATE INDEX idx_notification_log_wa_sent
  ON notification_log (sent_at DESC)
  WHERE channel = 'whatsapp';

COMMENT ON TABLE notification_log IS
  'Every FCM + WhatsApp notification. '
  'Lambda:delivery-monitor checks idx_notification_log_fcm_undelivered every 15 min. '
  'If FCM undelivered > fcm_delivery_timeout_minutes (default 5), triggers WhatsApp '
  'fallback ONLY for: new_lead, lead_accepted, certificate_ready. '
  'CAC outreach (provider_welcome, activation_reminder_48h, provider_final_reminder_7d) '
  'is WhatsApp-only — never via FCM. MASTER_CONTEXT Rule 17.';

COMMENT ON COLUMN notification_log.wa_fallback_sent IS
  'WhatsApp policy: ONLY for CAC outreach + extraordinary events. '
  'FCM is the primary channel for all product events. '
  'wa_fallback_sent=true means extraordinary event FCM delivery timed out. '
  'NEVER set wa_fallback_sent=true for push_discovery, availability_changed, etc.';

-- =============================================================================
-- V021: in_app_messages
-- In-app conversation messages between consumer and provider within a contact_event.
-- Real-time delivery: Socket.IO namespace /messages, room: conversation:{event_id}.
-- DPDP Act 2023: anonymised within 72h of account deletion (SQS anonymisation queue).
-- MASTER_CONTEXT: Socket.IO 3 namespaces on user:3002 (port 3002).
-- =============================================================================

CREATE TABLE in_app_messages (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_event_id  UUID        NOT NULL
                                REFERENCES contact_events(id) ON DELETE CASCADE,
  sender_id         UUID        NOT NULL
                                REFERENCES users(id) ON DELETE CASCADE,

  -- Message content (at least one must be non-null)
  message_text      TEXT,
  photo_url         TEXT,       -- S3 pre-signed URL for photo messages

  -- Delivery lifecycle
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at      TIMESTAMPTZ,   -- Socket.IO delivery acknowledgement from recipient device
  read_at           TIMESTAMPTZ,   -- recipient opened and acknowledged (read receipt)

  -- Soft delete for DPDP anonymisation
  -- Lambda:anonymisation processes within 72h of account deletion
  is_deleted        BOOLEAN     NOT NULL DEFAULT FALSE,
  deleted_at        TIMESTAMPTZ,

  -- Tracing
  correlation_id    VARCHAR(128),

  -- At least one of message_text or photo_url must be present
  CONSTRAINT chk_message_has_content
    CHECK (message_text IS NOT NULL OR photo_url IS NOT NULL)
);

-- Primary read pattern: load all messages in a conversation in chronological order
CREATE INDEX idx_in_app_messages_conversation
  ON in_app_messages (contact_event_id, sent_at ASC)
  WHERE is_deleted = FALSE;

-- Sender's message history (e.g. delete my messages)
CREATE INDEX idx_in_app_messages_sender
  ON in_app_messages (sender_id, sent_at DESC)
  WHERE is_deleted = FALSE;

-- Unread badge count: messages delivered but not yet read by recipient
-- Used by WebSocket room to push unread count on reconnect
CREATE INDEX idx_in_app_messages_unread
  ON in_app_messages (contact_event_id, delivered_at)
  WHERE read_at IS NULL AND is_deleted = FALSE;

-- DPDP anonymisation: find soft-deleted messages still containing text/photo
-- Lambda:anonymisation queries this index hourly
CREATE INDEX idx_in_app_messages_pending_erasure
  ON in_app_messages (deleted_at ASC)
  WHERE is_deleted = TRUE
    AND (message_text IS NOT NULL OR photo_url IS NOT NULL);

COMMENT ON TABLE in_app_messages IS
  'In-app messages within a contact_event conversation. '
  'Real-time via Socket.IO /messages namespace (room: conversation:{event_id}). '
  'Events: message_received, message_read, typing_start, typing_stop. '
  'connectionStateRecovery replays missed events within 2 min disconnect window. '
  'Anonymised within 72h of account deletion per DPDP Act 2023. '
  'GET /api/v1/messages/:event_id · POST /api/v1/messages (user:3002).';

COMMENT ON COLUMN in_app_messages.photo_url IS
  'S3 URL for photo messages. Stored in s3://satvaaah-documents/ under user folder. '
  'CloudFront served. URL must be pre-signed (15 min TTL) when returned to client.';

COMMENT ON COLUMN in_app_messages.delivered_at IS
  'Set when Socket.IO delivers to recipient device (delivery receipt). '
  'If recipient offline: stored here, replayed on reconnect via connectionStateRecovery.';

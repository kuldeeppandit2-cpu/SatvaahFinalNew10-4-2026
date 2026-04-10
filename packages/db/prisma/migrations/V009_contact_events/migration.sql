-- =============================================================================
-- V009_contact_events — SatvAAh
-- Contact events replace "bookings" on SatvAAh.
-- There is NO booking model anywhere in this codebase.
-- A contact event is: consumer contacts provider via call / message / slot_booking.
-- Provider accepts or declines. Lead counted against quota ONLY on accept.
--
-- contact_type: EXACTLY call, message, slot_booking — no other values.
-- slot_booking: Gold tier consumer only + provider must have published calendar.
-- Provider phone: always visible before contact.
-- Consumer phone: revealed to provider ONLY when provider accepts (provider_phone_revealed).
-- =============================================================================

-- ENUM: exactly 3 contact types — the spec is explicit
CREATE TYPE "ContactType" AS ENUM (
  'call',           -- Consumer calls provider (provider phone shown on profile)
  'message',        -- In-app message thread
  'slot_booking'    -- Gold consumer + provider calendar published
);

-- ENUM: overall contact event lifecycle status
CREATE TYPE "ContactStatus" AS ENUM (
  'pending',      -- Created, awaiting provider action
  'accepted',     -- Provider accepted → lead counted + consumer phone revealed
  'declined',     -- Provider declined → lead NOT counted → lead returned to consumer
  'expired',      -- No provider action within TTL → lead returned
  'cancelled',    -- Consumer cancelled before provider responded
  'completed'     -- Interaction concluded (e.g. slot_booking slot passed)
);

-- ENUM: provider-side lead status (shown on provider Leads screen)
CREATE TYPE "ProviderLeadStatus" AS ENUM (
  'pending',    -- Unreviewed
  'accepted',
  'declined',
  'expired'
);

-- =============================================================================
CREATE TABLE contact_events (
  id                      UUID                PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Consumer who initiated the contact
  consumer_id             UUID                NOT NULL
                            REFERENCES users(id) ON DELETE RESTRICT,

  -- Provider being contacted
  provider_id             UUID                NOT NULL
                            REFERENCES provider_profiles(id) ON DELETE RESTRICT,

  -- Contact mechanism — exactly 3 allowed types
  contact_type            "ContactType"       NOT NULL,

  -- Overall event status
  status                  "ContactStatus"     NOT NULL DEFAULT 'pending',

  -- Provider-side status (shown on provider Leads screen)
  provider_status         "ProviderLeadStatus" NOT NULL DEFAULT 'pending',

  -- Lead accounting
  -- TRUE once the consumer's lead quota has been decremented
  consumer_lead_deducted  BOOLEAN             NOT NULL DEFAULT FALSE,

  -- TRUE once consumer phone is revealed to provider (happens on accept)
  provider_phone_revealed BOOLEAN             NOT NULL DEFAULT FALSE,

  -- slot_booking only: the requested appointment time
  slot_at                 TIMESTAMPTZ,

  -- Set when provider_status = 'declined'
  decline_reason          TEXT,

  -- No-show reporting
  no_show_reported_at     TIMESTAMPTZ,
  no_show_reported_by     UUID                REFERENCES users(id) ON DELETE SET NULL,

  created_at              TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Consumer: "my contact history" screen
CREATE INDEX idx_ce_consumer_id
  ON contact_events(consumer_id, created_at DESC);

-- Provider: "my leads" screen — pending first
CREATE INDEX idx_ce_provider_pending
  ON contact_events(provider_id, provider_status)
  WHERE provider_status = 'pending';

-- Provider: full leads history
CREATE INDEX idx_ce_provider_id
  ON contact_events(provider_id, created_at DESC);

-- Status-based batch queries (e.g. expiry Lambda)
CREATE INDEX idx_ce_status
  ON contact_events(status, created_at)
  WHERE status IN ('pending', 'accepted');

-- Rating eligibility check: consumer + provider pair
CREATE INDEX idx_ce_consumer_provider
  ON contact_events(consumer_id, provider_id, status)
  WHERE status = 'accepted';

-- No-show management
CREATE INDEX idx_ce_no_show
  ON contact_events(no_show_reported_at)
  WHERE no_show_reported_at IS NOT NULL;

-- =============================================================================
-- TRIGGER: auto-update updated_at
-- =============================================================================
CREATE TRIGGER trg_ce_updated_at
  BEFORE UPDATE ON contact_events
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  contact_events IS
  'Contact events replace bookings. There is NO booking model. '
  'Consumer contacts provider via call / message / slot_booking. '
  'Lead counted against quota ONLY when provider accepts.';

COMMENT ON COLUMN contact_events.contact_type IS
  'Exactly 3 values: call, message, slot_booking. No others.';

COMMENT ON COLUMN contact_events.provider_phone_revealed IS
  'Consumer phone revealed to provider on accept. '
  'Provider phone is always visible on profile (no reveal mechanism needed).';

COMMENT ON COLUMN contact_events.slot_at IS
  'slot_booking only. NULL for call and message contact types.';

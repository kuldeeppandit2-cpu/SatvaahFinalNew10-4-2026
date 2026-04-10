-- =============================================================================
-- V035_consumer_ratings
-- Provider ratings of consumers. Written by rating service after accepted contact.
-- Used for consumer trust score calculation (reliability, payment behaviour).
-- API: POST /api/v1/consumer-ratings (requires accepted contact_event)
-- =============================================================================

CREATE TABLE consumer_ratings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id      UUID NOT NULL REFERENCES consumer_profiles(id) ON DELETE RESTRICT,
  provider_id      UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  contact_event_id UUID NOT NULL REFERENCES contact_events(id) ON DELETE RESTRICT,

  overall_stars     INT NOT NULL CHECK (overall_stars BETWEEN 1 AND 5),
  reliability       INT CHECK (reliability BETWEEN 1 AND 5),
  payment_behaviour INT CHECK (payment_behaviour BETWEEN 1 AND 5),
  review_note       TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One rating per provider+contact_event pair
CREATE UNIQUE INDEX idx_cr_provider_event ON consumer_ratings(provider_id, contact_event_id);
CREATE INDEX idx_cr_consumer_id ON consumer_ratings(consumer_id);
CREATE INDEX idx_cr_contact_event ON consumer_ratings(contact_event_id);

COMMENT ON TABLE consumer_ratings IS
  'Provider ratings of consumers — written after accepted contact_event. '
  'Separate from ratings table (which is consumer→provider). '
  'Feeds consumer trust score calculation in rating service.';

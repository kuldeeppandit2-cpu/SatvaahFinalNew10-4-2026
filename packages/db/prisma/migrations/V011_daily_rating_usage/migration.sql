-- =============================================================================
-- V011_daily_rating_usage — SatvAAh
-- Enforces per-consumer per-tab daily rating limits.
-- Daily limits (from system_config — never hardcoded):
--   products:       10/day  — contact event NOT required
--   services:        5/day  — contact event MANDATORY
--   expertise:       3/day  — contact event MANDATORY
--   establishments:  8/day  — contact event NOT required
--
-- Logic in services/rating:
--   1. Lookup or INSERT daily_rating_usage(consumer_id, tab, date)
--   2. If count >= limit → 429 DAILY_RATING_LIMIT_EXCEEDED
--   3. Else → increment count atomically with the rating INSERT
--
-- UNIQUE(consumer_id, tab, date) enforces one row per consumer/tab/day.
-- =============================================================================

CREATE TABLE daily_rating_usage (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  consumer_id     UUID          NOT NULL
                    REFERENCES users(id) ON DELETE CASCADE,

  -- Which tab this usage row tracks
  tab             "Tab"         NOT NULL,

  -- Calendar date in UTC (convert from Asia/Kolkata before INSERT)
  date            DATE          NOT NULL,

  -- Number of ratings submitted today for this tab (incremented atomically)
  count           INT           NOT NULL DEFAULT 1 CHECK (count >= 0),

  -- Convenience: track the last rating time for this consumer/tab/day
  last_rated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- UNIQUE CONSTRAINT — the business rule enforcement at DB level
  CONSTRAINT dru_consumer_tab_date_key UNIQUE (consumer_id, tab, date)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Primary lookup: services/rating checks this on every rating submission
CREATE INDEX idx_dru_consumer_tab_date
  ON daily_rating_usage(consumer_id, tab, date);

-- Cleanup job: remove rows older than 7 days (EventBridge + Lambda)
CREATE INDEX idx_dru_date
  ON daily_rating_usage(date);

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  daily_rating_usage IS
  'Per-consumer per-tab daily rating counter. '
  'UNIQUE(consumer_id, tab, date) enforces daily limits. '
  'Limits: products=10, services=5, expertise=3, establishments=8 — all in system_config.';

COMMENT ON COLUMN daily_rating_usage.date IS
  'Calendar date in UTC. Application converts Asia/Kolkata to UTC before insert.';

COMMENT ON COLUMN daily_rating_usage.count IS
  'Incremented atomically: UPDATE SET count = count + 1 WHERE consumer_id=? AND tab=? AND date=?. '
  'INSERT ON CONFLICT DO UPDATE SET count = count + 1.';

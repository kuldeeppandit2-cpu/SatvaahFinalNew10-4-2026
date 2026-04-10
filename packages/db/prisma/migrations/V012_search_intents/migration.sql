-- =============================================================================
-- V012_search_intents — SatvAAh
-- *** THIS MIGRATION EXISTS. NEVER DELETE. NEVER SKIP. ***
-- MASTER_CONTEXT Rule 13: V012 = search_intents. Required for Lambda:push-discovery.
-- CRITICAL RULE: expiry_at is NULLABLE — NULL means the intent NEVER expires.
--
-- Flow:
--   POST /api/v1/search/intent → async, fails silently → inserts search_intent row
--   Lambda:push-discovery → EventBridge trigger → queries active intents
--     WHERE notified_at IS NULL AND user_dismissed_at IS NULL
--     AND (expiry_at IS NULL OR expiry_at > NOW())
--   Matches against provider_profiles where trust_score crosses threshold
--   Sends FCM push notification to user
-- =============================================================================

-- *** V012 MARKER — DO NOT DELETE ***
-- taxonomy_node_id FK added in V017 after taxonomy_nodes table is created.
-- Intentionally nullable here to allow migration to run before V017.

CREATE TABLE search_intents (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User who performed the search
  user_id             UUID          NOT NULL
                        REFERENCES users(id) ON DELETE CASCADE,

  -- Taxonomy node matched from the search query (NULL for free-text searches
  -- that could not be resolved to a node)
  -- FK to taxonomy_nodes.id added by V017
  taxonomy_node_id    UUID,

  -- Search location: lng/lat separate for efficient bounding box pre-filter
  -- Convention: ST_MakePoint(lng, lat) — longitude FIRST
  lat                 DOUBLE PRECISION NOT NULL,
  lng                 DOUBLE PRECISION NOT NULL,

  -- When the search was performed
  searched_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Expiry: NULLABLE — NULL means this intent NEVER expires
  -- Admin-configurable per taxonomy node via taxonomy_nodes.search_intent_expiry_days
  expiry_at           TIMESTAMPTZ,

  -- Notification tracking
  notified_at         TIMESTAMPTZ,   -- When Lambda:push-discovery sent FCM push
  user_dismissed_at   TIMESTAMPTZ,   -- When user dismissed/acknowledged the notification

  -- Tab context from the original search
  tab                 "Tab",

  -- Raw search query text (for analytics and intent quality scoring)
  raw_query           TEXT,

  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()

  -- NO updated_at — search intents are append-only (notified_at/dismissed_at patched directly)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Lambda:push-discovery primary query
-- "Find active intents that have not yet been notified"
CREATE INDEX idx_si_active_for_push
  ON search_intents(notified_at, expiry_at)
  WHERE notified_at IS NULL AND user_dismissed_at IS NULL;

-- User's active intents (for consumer dashboard "you searched for" card)
CREATE INDEX idx_si_user_active
  ON search_intents(user_id, searched_at DESC)
  WHERE user_dismissed_at IS NULL;

-- Taxonomy node: find all users interested in a category (push after new provider)
CREATE INDEX idx_si_taxonomy_node_id
  ON search_intents(taxonomy_node_id)
  WHERE taxonomy_node_id IS NOT NULL AND notified_at IS NULL;

-- Geo-bounding-box pre-filter (combined with taxonomy_node_id lookup)
CREATE INDEX idx_si_lat_lng
  ON search_intents(lat, lng);

-- Analytics: search volume by date
CREATE INDEX idx_si_searched_at
  ON search_intents(searched_at DESC);

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  search_intents IS
  '*** NEVER DELETE THIS TABLE OR MIGRATION — MASTER_CONTEXT Rule 13 *** '
  'Required for Lambda:push-discovery. '
  'expiry_at IS NULLABLE — NULL means intent never expires.';

COMMENT ON COLUMN search_intents.taxonomy_node_id IS
  'FK to taxonomy_nodes(id) added in V017. Nullable for unresolved free-text searches.';

COMMENT ON COLUMN search_intents.expiry_at IS
  'NULLABLE. NULL = intent never expires. '
  'Value comes from taxonomy_nodes.search_intent_expiry_days, '
  'seeded at insert time: NOW() + interval N days. '
  'Some categories (e.g. expertise/cardiologist) may never expire.';

COMMENT ON COLUMN search_intents.lat IS
  'Latitude component. Combined with lng for geo-search. '
  'Build point: ST_MakePoint(lng, lat) — longitude FIRST.';

COMMENT ON COLUMN search_intents.lng IS
  'Longitude component. Passed FIRST to ST_MakePoint(lng, lat).';

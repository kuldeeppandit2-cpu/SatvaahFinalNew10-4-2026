-- =============================================================================
-- V016_saved_providers — SatvAAh
-- Consumer bookmarks / saved provider list.
-- Composite PRIMARY KEY (consumer_id, provider_id) — no surrogate key needed.
-- O(1) existence check: SELECT 1 FROM saved_providers WHERE consumer_id=? AND provider_id=?
-- DELETE is a hard delete (no soft delete — saving is not a compliance concern).
-- =============================================================================

CREATE TABLE saved_providers (
  -- Composite primary key — no auto-generated id column
  consumer_id     UUID          NOT NULL
                    REFERENCES users(id) ON DELETE CASCADE,

  provider_id     UUID          NOT NULL
                    REFERENCES provider_profiles(id) ON DELETE CASCADE,

  -- When the consumer saved this provider
  saved_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Optional note the consumer attached (future feature, nullable)
  note            TEXT,

  PRIMARY KEY (consumer_id, provider_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Consumer's saved list (GET /api/v1/saved-providers)
-- Covered by composite PK prefix — no additional index needed for consumer_id
-- Adding separately for reverse lookup:

-- Provider: how many consumers have saved this provider (analytics)
CREATE INDEX idx_saved_providers_provider_id
  ON saved_providers(provider_id);

-- Consumer: most recently saved first
CREATE INDEX idx_saved_providers_consumer_saved_at
  ON saved_providers(consumer_id, saved_at DESC);

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  saved_providers IS
  'Consumer bookmarks. Composite PK (consumer_id, provider_id). '
  'Hard delete on unsave — no soft delete. No surrogate key.';

COMMENT ON COLUMN saved_providers.consumer_id IS
  'Part of composite PK. Cascades on user delete.';

COMMENT ON COLUMN saved_providers.provider_id IS
  'Part of composite PK. Cascades on provider_profile delete.';

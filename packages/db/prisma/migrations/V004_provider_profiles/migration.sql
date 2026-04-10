-- =============================================================================
-- V004_provider_profiles — SatvAAh
-- Central provider table. Covers both claimed (user_id set) and
-- unclaimed scrape records (user_id NULL, is_scrape_record = TRUE).
--
-- CRITICAL RULES:
--   trust_score: NEVER written by application code. Managed exclusively by
--                Lambda:trust-recalculate via SQS trust-score-updates queue.
--   geo_point:   ST_MakePoint(lng, lat) — longitude FIRST, always.
--   DigiLocker:  digilocker_uid_hash only — Aadhaar number NEVER stored anywhere
--                in DB, logs, Redis, S3, or any medium. bcrypt(uid+salt, cost=12).
-- =============================================================================

-- ENUM: drives trust signal set, profile form fields, search card layout
CREATE TYPE "ListingType" AS ENUM (
  'individual_service',   -- plumber, electrician, maid, cook, driver
  'individual_product',   -- milkman, vegetable vendor, homemade products
  'expertise',            -- cardiologist, advocate, CA, architect, SEBI RIA
  'establishment',        -- Ramu di Hatti, Sharma Mithai, Paradise Biryani
  'product_brand'         -- A-Z Milk, Fresh Squeeze Co (FMCG brand)
);

-- ENUM: search tab — consumer navigates by tab
CREATE TYPE "Tab" AS ENUM (
  'products',
  'services',
  'expertise',
  'establishments'
);

-- =============================================================================
CREATE TABLE provider_profiles (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL for unclaimed scrape records; set when provider claims their profile
  user_id                 UUID          REFERENCES users(id) ON DELETE SET NULL,

  -- Trust model: listing_type determines which trust signals apply
  listing_type            "ListingType" NOT NULL,
  tab                     "Tab"         NOT NULL,

  -- Public profile fields
  display_name            VARCHAR(200)  NOT NULL,
  bio                     TEXT,
  profile_photo_url       TEXT,

  -- Provider phone: visible to consumers before contacting (no lead needed)
  -- Consumer phone: revealed ONLY after provider accepts the lead
  phone                   VARCHAR(15),

  -- Geography
  city_id                 UUID          REFERENCES cities(id) ON DELETE RESTRICT,
  area_id                 UUID          REFERENCES areas(id)  ON DELETE SET NULL,

  -- PostGIS GEOGRAPHY(POINT,4326): ST_MakePoint(lng, lat) — longitude FIRST
  -- Used for expanding-ring search: 3km → 7km → 15km → 50km → 150km
  geo_point               GEOGRAPHY(POINT, 4326),

  -- =========================================================================
  -- TRUST SCORE — DB TRIGGER MANAGED
  -- Lambda:trust-recalculate writes this via SQS trust-score-updates queue.
  -- Application code MUST NEVER perform UPDATE SET trust_score = ...
  -- Any such write will be caught in code review and must be reverted.
  -- =========================================================================
  trust_score             INT           NOT NULL DEFAULT 0
                            CHECK (trust_score >= 0 AND trust_score <= 100),

  -- Verification signal flags — set by respective verification flows
  is_phone_verified       BOOLEAN       NOT NULL DEFAULT FALSE,
  is_aadhaar_verified     BOOLEAN       NOT NULL DEFAULT FALSE,
  is_geo_verified         BOOLEAN       NOT NULL DEFAULT FALSE,
  is_credential_verified  BOOLEAN       NOT NULL DEFAULT FALSE,

  -- DigiLocker: ONLY the bcrypt hash is stored — Aadhaar number NEVER stored
  -- bcrypt(digilocker_uid + per_record_salt, cost=12) → 60-char hash string
  digilocker_uid_hash     CHAR(60),

  -- Profile state
  is_claimed              BOOLEAN       NOT NULL DEFAULT FALSE,
  is_scrape_record        BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active               BOOLEAN       NOT NULL DEFAULT TRUE,

  -- Availability: JSONB schedule. Format defined in types package.
  -- { mon: [{start: "08:00", end: "18:00"}], ... }
  availability            JSONB,

  -- Home visit capability (shown as filter + badge)
  home_visit              BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Scraping provenance — for deduplication
  scrape_source           VARCHAR(50),   -- e.g. 'justdial', 'sulekha'
  scrape_external_id      TEXT,          -- source-platform record ID

  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- A user cannot have two profiles with the same listing_type
  CONSTRAINT pp_user_listing_unique
    UNIQUE (user_id, listing_type)
    DEFERRABLE INITIALLY DEFERRED,

  -- Scrape deduplication: source + external ID must be unique (when both non-null)
  CONSTRAINT pp_scrape_dedup_unique
    UNIQUE NULLS NOT DISTINCT (scrape_source, scrape_external_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- PRIMARY GEOSPATIAL INDEX — expanding-ring search
-- All provider search queries use this GiST index
CREATE INDEX idx_pp_geo_point
  ON provider_profiles USING GIST(geo_point);

-- Search ranking: tab + trust_score DESC (active providers only)
CREATE INDEX idx_pp_tab_trust_score
  ON provider_profiles(tab, trust_score DESC)
  WHERE is_active = TRUE;

-- Search filter: listing_type
CREATE INDEX idx_pp_listing_type
  ON provider_profiles(listing_type)
  WHERE is_active = TRUE;

-- City-scoped search
CREATE INDEX idx_pp_city_id
  ON provider_profiles(city_id)
  WHERE is_active = TRUE;

-- Provider lookup by user_id (claimed profiles)
CREATE INDEX idx_pp_user_id
  ON provider_profiles(user_id)
  WHERE user_id IS NOT NULL;

-- Push-discovery Lambda: find providers whose score crossed threshold
CREATE INDEX idx_pp_trust_score
  ON provider_profiles(trust_score DESC)
  WHERE is_active = TRUE;

-- Updated_at DESC for OpenSearch CDC catchup queries
CREATE INDEX idx_pp_updated_at_desc
  ON provider_profiles(updated_at DESC)
  WHERE is_active = TRUE;

-- Fuzzy-search on display_name via pg_trgm
CREATE INDEX idx_pp_display_name_trgm
  ON provider_profiles USING GIN(display_name gin_trgm_ops);

-- Scrape management
CREATE INDEX idx_pp_is_scrape_record
  ON provider_profiles(is_scrape_record, is_claimed)
  WHERE is_scrape_record = TRUE;

-- =============================================================================
-- TRIGGER: auto-update updated_at
-- Note: V018 OpenSearch CDC trigger fires AFTER UPDATE on this table
-- =============================================================================
CREATE TRIGGER trg_pp_updated_at
  BEFORE UPDATE ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  provider_profiles IS
  'Central provider entity. Covers claimed and unclaimed scrape records. '
  'trust_score is DB-trigger managed — application code must never write it.';

COMMENT ON COLUMN provider_profiles.trust_score IS
  'NEVER write from application code. '
  'Managed exclusively by Lambda:trust-recalculate via SQS trust-score-updates.';

COMMENT ON COLUMN provider_profiles.geo_point IS
  'GEOGRAPHY(POINT,4326). Built with ST_MakePoint(lng, lat) — longitude FIRST.';

COMMENT ON COLUMN provider_profiles.digilocker_uid_hash IS
  'bcrypt(digilocker_uid + per_record_salt, cost=12). '
  'Aadhaar number is NEVER stored anywhere — not here, not in logs, not in Redis.';

COMMENT ON COLUMN provider_profiles.is_scrape_record IS
  'TRUE for records created by Lambda:scraping. '
  'FALSE once provider claims via POST /api/v1/providers/register.';

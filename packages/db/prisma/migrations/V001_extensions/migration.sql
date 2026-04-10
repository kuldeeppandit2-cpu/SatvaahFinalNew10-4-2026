-- =============================================================================
-- V001_extensions — SatvAAh
-- PostgreSQL 15 extensions required by the platform.
-- Runs FIRST. All subsequent migrations depend on these extensions.
-- =============================================================================

-- UUID generation (gen_random_uuid() from pgcrypto, uuid_generate_v4() from uuid-ossp)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Geospatial: PostGIS geometry/geography types, ST_MakePoint, ST_DWithin, etc.
-- RULE: ST_MakePoint(lng, lat) — longitude FIRST, always.
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Trigram fuzzy-search on display_name and taxonomy node names
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- GiST indexes on ranges and exclusion constraints
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- gen_random_uuid(), crypt(), bcrypt hashing (DigiLocker uid hash, token hashes)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- SHARED TRIGGER FUNCTION: auto-update updated_at on every table that has one.
-- Created once here; referenced by every subsequent migration trigger.
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_set_updated_at() IS
  'Shared trigger function: sets updated_at = NOW() before any UPDATE. '
  'Attached to every table that carries an updated_at column.';

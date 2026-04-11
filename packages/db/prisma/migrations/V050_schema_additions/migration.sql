-- =============================================================================
-- V050 — schema_additions
-- Adds fields agreed in design review (April 2026).
-- All statements use IF NOT EXISTS / IF EXISTS — safe to re-run.
--
-- Changes:
--   1. consumer_profiles    — ADD geo_lat, geo_lng, area_id
--   2. provider_profiles    — ADD address_line, pincode, service_radius_km,
--                             languages_spoken, years_experience
--   3. NEW TABLE             — provider_availability_slots
--   4. NEW TABLE             — provider_slot_exceptions
--
-- Does NOT touch:
--   taxonomy_nodes  (V048 already applied to DB — only Prisma schema needs updating)
--   scraping_staging (V049 already applied to DB — only Prisma schema needs updating)
--
-- RULE: All geo coordinates stored as DECIMAL(9,6).
--       Longitude FIRST in all ST_MakePoint calls (separate concern — not in this file).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. consumer_profiles — add location fields
-- ---------------------------------------------------------------------------

ALTER TABLE consumer_profiles
  ADD COLUMN IF NOT EXISTS geo_lat  DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS geo_lng  DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS area_id  UUID REFERENCES areas(id) ON DELETE SET NULL;

-- Index for BG3 discovery push proximity queries
CREATE INDEX IF NOT EXISTS idx_consumer_profiles_geo
  ON consumer_profiles (geo_lat, geo_lng)
  WHERE geo_lat IS NOT NULL AND geo_lng IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consumer_profiles_area_id
  ON consumer_profiles (area_id)
  WHERE area_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. provider_profiles — add address and service fields
-- ---------------------------------------------------------------------------

ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS address_line     VARCHAR(300),
  ADD COLUMN IF NOT EXISTS pincode          VARCHAR(10),
  ADD COLUMN IF NOT EXISTS service_radius_km INTEGER,
  ADD COLUMN IF NOT EXISTS languages_spoken  JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS years_experience  INTEGER;

COMMENT ON COLUMN provider_profiles.address_line IS
  'Human-readable office address. e.g. Shop 4, Cyber Towers, Hitech City. '
  'Shown to consumer after they contact provider.';

COMMENT ON COLUMN provider_profiles.pincode IS
  '6-digit Indian postal code for provider office location.';

COMMENT ON COLUMN provider_profiles.service_radius_km IS
  'How far provider travels for home visits. NULL = not specified. '
  'Only meaningful when home_visit_available = TRUE.';

COMMENT ON COLUMN provider_profiles.languages_spoken IS
  'Array of BCP-47 language codes. e.g. ["te","hi","en"]. '
  'Used for language-based search filtering.';

COMMENT ON COLUMN provider_profiles.years_experience IS
  'Years in profession. Queryable top-level field. '
  'Previously only in attribute_schema JSONB.';

CREATE INDEX IF NOT EXISTS idx_provider_profiles_pincode
  ON provider_profiles (pincode)
  WHERE pincode IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. NEW TABLE — provider_availability_slots
-- Recurring weekly schedule per provider.
-- Multiple rows per day allowed (split shifts).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS provider_availability_slots (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID        NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  day_of_week  SMALLINT    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  -- 0=Sunday 1=Monday 2=Tuesday 3=Wednesday 4=Thursday 5=Friday 6=Saturday
  start_time   TIME        NOT NULL,
  end_time     TIME        NOT NULL CHECK (end_time > start_time),
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_provider_slot_window
    UNIQUE (provider_id, day_of_week, start_time)
);

COMMENT ON TABLE provider_availability_slots IS
  'Weekly recurring availability schedule. Each row = one time window on one day of week. '
  'Slot availability = this schedule MINUS provider_slot_exceptions MINUS booked contact_events.slot_date.';

COMMENT ON COLUMN provider_availability_slots.day_of_week IS
  '0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday.';

CREATE INDEX IF NOT EXISTS idx_pas_provider_day_active
  ON provider_availability_slots (provider_id, day_of_week, is_active);

CREATE TRIGGER trg_pas_updated_at
  BEFORE UPDATE ON provider_availability_slots
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. NEW TABLE — provider_slot_exceptions
-- Specific date overrides: holidays (is_available=false) or extra hours (is_available=true).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS provider_slot_exceptions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id          UUID        NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  exception_date       DATE        NOT NULL,
  is_available         BOOLEAN     NOT NULL,
  -- If is_available=TRUE: override_start/end_time define the extra window.
  -- If is_available=FALSE: provider is fully blocked that day.
  override_start_time  TIME,
  override_end_time    TIME,
  note                 VARCHAR(200),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_provider_exception_date
    UNIQUE (provider_id, exception_date),

  CONSTRAINT chk_available_requires_times CHECK (
    is_available = FALSE
    OR (override_start_time IS NOT NULL AND override_end_time IS NOT NULL
        AND override_end_time > override_start_time)
  )
);

COMMENT ON TABLE provider_slot_exceptions IS
  'Specific date overrides. is_available=FALSE = holiday/blocked. '
  'is_available=TRUE = extra hours beyond normal schedule.';

CREATE INDEX IF NOT EXISTS idx_pse_provider_date
  ON provider_slot_exceptions (provider_id, exception_date);

COMMIT;

-- Verify
DO $$
DECLARE
  c_geo   INT;
  c_addr  INT;
  c_slots INT;
  c_exc   INT;
BEGIN
  SELECT COUNT(*) INTO c_geo  FROM information_schema.columns
    WHERE table_name='consumer_profiles' AND column_name='geo_lat';
  SELECT COUNT(*) INTO c_addr FROM information_schema.columns
    WHERE table_name='provider_profiles' AND column_name='address_line';
  SELECT COUNT(*) INTO c_slots FROM information_schema.tables
    WHERE table_name='provider_availability_slots';
  SELECT COUNT(*) INTO c_exc   FROM information_schema.tables
    WHERE table_name='provider_slot_exceptions';
  RAISE NOTICE 'V050 verify: geo_lat=% address_line=% slots_table=% exceptions_table=%',
    c_geo, c_addr, c_slots, c_exc;
END $$;

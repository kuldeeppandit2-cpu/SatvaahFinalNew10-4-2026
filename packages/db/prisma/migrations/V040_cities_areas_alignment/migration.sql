-- =============================================================================
-- V040_cities_areas_alignment
-- Aligns cities and areas tables (V003) with schema.prisma canonical definition.
-- Rule #23: schema.prisma wins over migrations.
--
-- Cities changes:
--   country VARCHAR(100) → country_code VARCHAR(3)
--   launch_order INT → is_launch_city BOOLEAN
--   centroid GEOGRAPHY → removed (not in schema.prisma City model)
--   Add: slug VARCHAR(100) UNIQUE
--   Add: ring_1_km..ring_5_km INT (per-city ring overrides)
--   Add: is_launch_city BOOLEAN
--
-- Areas changes:
--   boundary GEOGRAPHY(POLYGON) → removed (not in schema.prisma Area model)
--   Add: slug VARCHAR(150)
--   Add: bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng
--   Add: sort_order INT
--   name: VARCHAR(200) → VARCHAR(150)
-- =============================================================================

-- ─── CITIES ─────────────────────────────────────────────────────────────────

-- Add slug (required, unique) — generate from name for existing rows
ALTER TABLE cities ADD COLUMN IF NOT EXISTS slug VARCHAR(100);
UPDATE cities SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
  WHERE slug IS NULL;
ALTER TABLE cities ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cities_slug ON cities(slug);

-- Add country_code (3-char ISO) — derive from country column
ALTER TABLE cities ADD COLUMN IF NOT EXISTS country_code VARCHAR(3) DEFAULT 'IND';
UPDATE cities SET country_code = 'IND' WHERE country = 'India';

-- Add is_launch_city (replaces launch_order for schema purposes)
ALTER TABLE cities ADD COLUMN IF NOT EXISTS is_launch_city BOOLEAN DEFAULT FALSE;
UPDATE cities SET is_launch_city = TRUE WHERE launch_order = 1;

-- Add per-city ring overrides (NULL = use system_config defaults)
ALTER TABLE cities
  ADD COLUMN IF NOT EXISTS ring_1_km INT,
  ADD COLUMN IF NOT EXISTS ring_2_km INT,
  ADD COLUMN IF NOT EXISTS ring_3_km INT,
  ADD COLUMN IF NOT EXISTS ring_4_km INT,
  ADD COLUMN IF NOT EXISTS ring_5_km INT;

-- ─── AREAS ──────────────────────────────────────────────────────────────────

-- Add slug
ALTER TABLE areas ADD COLUMN IF NOT EXISTS slug VARCHAR(150);
UPDATE areas SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
  WHERE slug IS NULL;

-- Add bounding box columns (used by mobile map viewport)
ALTER TABLE areas
  ADD COLUMN IF NOT EXISTS bbox_min_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS bbox_max_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS bbox_min_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS bbox_max_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS sort_order   INT NOT NULL DEFAULT 0;

-- Unique index for area slug within city
CREATE UNIQUE INDEX IF NOT EXISTS idx_areas_city_slug ON areas(city_id, slug);

COMMENT ON COLUMN cities.slug IS 'URL-safe lowercase identifier e.g. hyderabad. Used in provider web profiles.';
COMMENT ON COLUMN cities.ring_1_km IS 'Per-city override for search ring 1 (km). NULL = system_config default (3km).';
COMMENT ON COLUMN areas.slug IS 'URL-safe lowercase identifier within city e.g. banjara-hills.';

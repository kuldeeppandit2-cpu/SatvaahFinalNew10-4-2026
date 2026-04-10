-- =============================================================================
-- V003_cities_areas — SatvAAh
-- Cities (launch markets) and Areas (sub-city zones) with PostGIS boundaries.
-- Launch city: Hyderabad, Telangana, India.
-- Search ring expansion: 3km → 7km → 15km → 50km (city-wide) → 150km (cross-city).
-- RULE: ST_MakePoint(lng, lat) — longitude FIRST, always.
-- =============================================================================

-- =============================================================================
-- CITIES
-- =============================================================================
CREATE TABLE cities (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100)  NOT NULL,
  state           VARCHAR(100)  NOT NULL,
  country         VARCHAR(100)  NOT NULL DEFAULT 'India',

  -- PostGIS GEOGRAPHY: uses WGS-84 (SRID 4326), great-circle distances in metres
  -- centroid: used as the city centre for cross-city search (150km ring)
  centroid        GEOGRAPHY(POINT, 4326),

  -- boundary: used for "city-wide" search ring (50km equivalent)
  -- MULTIPOLYGON supports cities with disconnected administrative zones
  boundary        GEOGRAPHY(MULTIPOLYGON, 4326),

  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  launch_order    INT,          -- 1=Hyderabad, 2=next city, etc. Admin-configurable.

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT cities_name_state_key UNIQUE (name, state)
);

-- GiST spatial indexes for containment and proximity queries
CREATE INDEX idx_cities_centroid   ON cities USING GIST(centroid);
CREATE INDEX idx_cities_boundary   ON cities USING GIST(boundary);
CREATE INDEX idx_cities_is_active  ON cities(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_cities_launch_order ON cities(launch_order) WHERE launch_order IS NOT NULL;

CREATE TRIGGER trg_cities_updated_at
  BEFORE UPDATE ON cities
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON TABLE  cities IS 'SatvAAh launch markets. Launch city: Hyderabad. Extended per rollout plan.';
COMMENT ON COLUMN cities.centroid  IS 'GEOGRAPHY(POINT,4326). ST_MakePoint(lng, lat). City centre point.';
COMMENT ON COLUMN cities.boundary  IS 'GEOGRAPHY(MULTIPOLYGON,4326). Full administrative boundary.';
COMMENT ON COLUMN cities.launch_order IS 'Rollout sequence. 1 = Hyderabad (first launch city).';

-- =============================================================================
-- SEED: Hyderabad — launch city
-- Centroid: ST_MakePoint(lng=78.4867, lat=17.3850) — longitude FIRST
-- =============================================================================
INSERT INTO cities (name, state, country, is_active, launch_order, centroid)
VALUES (
  'Hyderabad',
  'Telangana',
  'India',
  TRUE,
  1,
  ST_GeographyFromText('SRID=4326;POINT(78.4867 17.3850)')
);

-- =============================================================================
-- AREAS
-- Sub-city zones: neighbourhoods, mandals, colonies.
-- Each area belongs to one city and carries its own centroid + polygon boundary.
-- =============================================================================
CREATE TABLE areas (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id         UUID          NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  name            VARCHAR(200)  NOT NULL,

  -- centroid: used for provider geo-verification ("your area milkman")
  centroid        GEOGRAPHY(POINT, 4326),

  -- boundary: used to tag provider_profiles.area_id during geo-verify
  boundary        GEOGRAPHY(POLYGON, 4326),

  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT areas_city_name_key UNIQUE (city_id, name)
);

CREATE INDEX idx_areas_city_id   ON areas(city_id);
CREATE INDEX idx_areas_centroid  ON areas USING GIST(centroid);
CREATE INDEX idx_areas_boundary  ON areas USING GIST(boundary);
CREATE INDEX idx_areas_is_active ON areas(city_id, is_active) WHERE is_active = TRUE;

CREATE TRIGGER trg_areas_updated_at
  BEFORE UPDATE ON areas
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMENT ON TABLE  areas IS 'Sub-city zones. Populated by admin for each launch city.';
COMMENT ON COLUMN areas.centroid IS 'GEOGRAPHY(POINT,4326). ST_MakePoint(lng, lat). Area centre.';
COMMENT ON COLUMN areas.boundary IS 'GEOGRAPHY(POLYGON,4326). Area administrative boundary.';

-- =============================================================================
-- V017_taxonomy_nodes — SatvAAh
-- Service/product/expertise taxonomy. 1,597 rows seeded from Taxonomy Master v2.
-- 4-level hierarchy: l1 → l2 → l3 → l4 (leaf nodes are what providers register under).
-- Drives: search autocomplete, category browse, trust signal selection, rating dimensions.
--
-- rating_dimensions JSONB: per-node dimension labels for structured ratings
--   Format: [{"key": "punctuality", "label": "On Time", "weight": 0.3}, ...]
--
-- search_intent_expiry_days INT NULLABLE:
--   NULL  = intent for this category NEVER expires (e.g. cardiologist search)
--   N     = intent expires after N days (e.g. plumber = 7 days)
--   Used at search intent INSERT: expiry_at = NOW() + interval N days (or NULL)
--
-- After this migration, two deferred FKs are back-filled:
--   search_intents.taxonomy_node_id → taxonomy_nodes.id  (V012 deferred this)
-- =============================================================================

CREATE TABLE taxonomy_nodes (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 4-level taxonomy hierarchy
  -- l1: broad category  e.g. "Home Services"
  -- l2: category        e.g. "Plumbing"
  -- l3: sub-category    e.g. "Pipe Repair"
  -- l4: leaf node       e.g. "Emergency Pipe Repair" (most specific)
  l1                          VARCHAR(100)  NOT NULL,
  l2                          VARCHAR(100),
  l3                          VARCHAR(100),
  l4                          VARCHAR(100),

  -- Search tab this node appears under
  tab                         "Tab"         NOT NULL,

  -- Which provider listing_type handles this node
  listing_type                "ListingType" NOT NULL,

  -- URL-safe slug for deep links and API lookups
  -- Format: l1-l2-l3-l4 (lowercased, spaces → hyphens, non-ascii stripped)
  slug                        VARCHAR(400)  UNIQUE,

  -- Dynamic attribute schema for provider profile form fields specific to this node
  -- e.g. {"fields": [{"key": "license_no", "label": "FSSAI Licence No", "required": true}]}
  attribute_schema            JSONB         NOT NULL DEFAULT '{}',

  -- Structured rating dimensions shown to consumers when rating this node's providers
  -- Format: [{"key": "quality", "label": "Food Quality", "weight": 0.4}, ...]
  -- Weights must sum to 1.0 (validated in application, not DB)
  rating_dimensions           JSONB         NOT NULL DEFAULT '[]',

  -- How long (days) a search intent for this node stays active
  -- NULLABLE — NULL means the intent NEVER expires (permanent interest)
  -- Example: cardiologist = NULL, plumber = 7, maid = 14
  search_intent_expiry_days   INT           CHECK (search_intent_expiry_days IS NULL
                                                    OR search_intent_expiry_days > 0),

  -- TRUE if providers in this node must submit a government credential
  -- (expertise nodes: doctors, advocates, CAs, SEBI RIAs, IRDAI agents)
  verification_required       BOOLEAN       NOT NULL DEFAULT FALSE,

  -- TRUE if providers in this node offer home visits / doorstep service
  home_visit                  BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Display ordering in browse and autocomplete (higher = shown first)
  search_rank                 INT           NOT NULL DEFAULT 0,

  is_active                   BOOLEAN       NOT NULL DEFAULT TRUE,

  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Category browse: GET /api/v1/categories?tab=services
CREATE INDEX idx_tn_tab_rank
  ON taxonomy_nodes(tab, search_rank DESC)
  WHERE is_active = TRUE;

-- Listing type filter
CREATE INDEX idx_tn_listing_type
  ON taxonomy_nodes(listing_type)
  WHERE is_active = TRUE;

-- Slug lookup (deep links, API)
CREATE INDEX idx_tn_slug
  ON taxonomy_nodes(slug)
  WHERE slug IS NOT NULL;

-- Hierarchy navigation: l1 browse
CREATE INDEX idx_tn_l1
  ON taxonomy_nodes(l1, tab)
  WHERE is_active = TRUE;

-- Verification-required filter (for credential upload prompt)
CREATE INDEX idx_tn_verification_required
  ON taxonomy_nodes(verification_required)
  WHERE verification_required = TRUE;

-- Trigram autocomplete: GET /api/v1/search/suggest?q=&tab=
CREATE INDEX idx_tn_l1_trgm
  ON taxonomy_nodes USING GIN(l1 gin_trgm_ops);

CREATE INDEX idx_tn_l2_trgm
  ON taxonomy_nodes USING GIN(l2 gin_trgm_ops)
  WHERE l2 IS NOT NULL;

CREATE INDEX idx_tn_l3_trgm
  ON taxonomy_nodes USING GIN(l3 gin_trgm_ops)
  WHERE l3 IS NOT NULL;

-- =============================================================================
-- TRIGGER: auto-update updated_at
-- =============================================================================
CREATE TRIGGER trg_tn_updated_at
  BEFORE UPDATE ON taxonomy_nodes
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- BACK-FILL DEFERRED FK: search_intents.taxonomy_node_id → taxonomy_nodes.id
-- V012 left this column without a FK because taxonomy_nodes did not exist yet.
-- Now that this table exists, we add the constraint.
-- =============================================================================
ALTER TABLE search_intents
  ADD CONSTRAINT fk_si_taxonomy_node
  FOREIGN KEY (taxonomy_node_id)
  REFERENCES taxonomy_nodes(id)
  ON DELETE SET NULL;

-- =============================================================================
-- TABLE COMMENTS
-- =============================================================================
COMMENT ON TABLE  taxonomy_nodes IS
  'Service/product/expertise taxonomy. 1,597 rows from Taxonomy Master v2. '
  '4-level hierarchy: l1 → l2 → l3 → l4. '
  'Drives search autocomplete, category browse, trust signals, rating dimensions.';

COMMENT ON COLUMN taxonomy_nodes.search_intent_expiry_days IS
  'NULLABLE — NULL means search intent for this node NEVER expires. '
  'Used at search_intents INSERT: expiry_at = NOW() + interval N days (or NULL). '
  'Examples: cardiologist=NULL, plumber=7, maid=14, electrician=3.';

COMMENT ON COLUMN taxonomy_nodes.rating_dimensions IS
  'Per-node rating dimensions for structured consumer feedback. '
  'Format: [{"key":"punctuality","label":"On Time","weight":0.3}]. '
  'Weights must sum to 1.0 (validated by application). '
  'Stored in ratings.dimension_scores JSONB at submission time.';

COMMENT ON COLUMN taxonomy_nodes.attribute_schema IS
  'Dynamic form fields for provider profile registration. '
  'Format: {"fields": [{"key":"license","label":"Licence No","required":true}]}.';

COMMENT ON COLUMN taxonomy_nodes.verification_required IS
  'TRUE for expertise listing_type nodes. '
  'Triggers credential upload prompt and credential_verified signal.';

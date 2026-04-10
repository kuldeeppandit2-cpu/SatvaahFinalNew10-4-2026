-- ============================================================
-- SEED: trust_score_config — listing_type: product_brand
-- File: packages/db/seeds/trust_score_config_product_brand.sql
--
-- Covers: A-Z Milk, Fresh Squeeze Co, artisanal food brands,
--         new FMCG brands building trust before market recognition.
--
-- Key design decisions for product_brand:
--   • GST Registration (25 pts) — commercial product business.
--     GST is the baseline proof of legal entity for any brand.
--   • FSSAI Licence (20 pts) — Food Safety and Standards Authority
--     of India licence. MANDATORY for any food/beverage product brand.
--     Non-food brands get Trademark Registration as equivalent.
--   • Brand Registration (20 pts) — trademark / brand registration
--     with IP India or FSSAI (for food). Proves the brand name is
--     genuinely theirs and not a spoofed listing.
--   • Ratings Score (15 pts) — consumer reviews of the actual product.
--   • External Ratings (15 pts) — Google / JustDial / Sulekha for
--     established brands; less available for new brands (expected).
--   • Geo Verified (10 pts) — manufacturing/distribution address.
--   • OTP Verified (10 pts) — base phone signal.
--   • Product Photo (5 pts) — actual product packaging photo in S3.
--
-- Signal breakdown:
--   GST Registration        25 pts  — legal commercial entity
--   FSSAI / Regulatory      20 pts  — product-specific safety licence
--   Brand Registration      20 pts  — trademark / IP India registration
--   Ratings Score           15 pts  — SatvAAh consumer product reviews
--   External Ratings        15 pts  — Google / JustDial / Sulekha
--   Geo Verified            10 pts  — manufacturing / distribution address
--   OTP Verified            10 pts  — phone verification
--   Product Photo            5 pts  — actual product + packaging in S3
--
--   raw_max_total           120 pts  (25+20+20+15+15+10+10+5)
--
-- NOTE: FSSAI licence is enforced at taxonomy_node level
--       (verification_required=TRUE on food/beverage nodes).
--       Non-food product_brand nodes substitute brand_registration
--       as the primary regulatory signal with equal weight.
--
-- ON CONFLICT DO NOTHING → safe to re-run (idempotent).
-- ============================================================

INSERT INTO trust_score_config
    (listing_type, signal_name, max_pts, raw_max_total, is_active, description)
VALUES

('product_brand', 'gst_verified',          25, 120, TRUE,
    'GST registration verified against GSTIN public API. Confirms legal commercial entity '
    'and active filing status. Baseline signal for any product brand. '
    'Admin verifies GSTIN + trade name match against brand profile name.'),

('product_brand', 'fssai_or_regulatory',   20, 120, TRUE,
    'Food Safety and Standards Authority of India (FSSAI) licence for food/beverage brands. '
    'Non-food brands: BIS certification, Drug Licence (pharma), or equivalent regulatory approval. '
    'Admin verifies licence number against respective public registry. '
    'taxonomy_node.verification_required=TRUE on all food product nodes.'),

('product_brand', 'brand_registration',    20, 120, TRUE,
    'Trademark registration with IP India or brand registration with FSSAI. '
    'Proves brand name and logo are legally registered to this entity. '
    'Admin verifies trademark application number or registration certificate. '
    'Applied for + pending status earns partial credit (10 pts).'),

('product_brand', 'ratings_score',         15, 120, TRUE,
    'SatvAAh consumer product reviews. weight_type: open_community=0.5 '
    '(contact event not required — consumer may have bought the product elsewhere). '
    'verified_contact=1.0 when consumer bought via SatvAAh contact event. Scaled to 15 pts.'),

('product_brand', 'external_ratings',      15, 120, TRUE,
    'Scraped from external_ratings: Google, JustDial, Sulekha. '
    'Expected to be sparse for new brands — that is acceptable. '
    'weight=0.30 (0.15 if stale). Source always shown to consumer. Scaled to 15 pts.'),

('product_brand', 'geo_verified',          10, 120, TRUE,
    'Manufacturing unit or distribution warehouse address confirmed. '
    'Admin cross-checks against GST registered address. '
    'Lower weight than establishment — product brands distribute city-wide, not location-dependent.'),

('product_brand', 'otp_verified',          10, 120, TRUE,
    'Business contact phone verified via Firebase OTP. '
    'Base signal. Same as other listing types.'),

('product_brand', 'product_photo',          5, 120, TRUE,
    'Actual product packaging photo uploaded to S3 and admin-approved. '
    'Must show the product clearly with brand name and packaging. '
    'Not a logo or marketing graphic — must be the real product. '
    'Consumers browse product photos before contacting brand.')

ON CONFLICT (listing_type, signal_name) DO NOTHING;

-- ── Verification query ────────────────────────────────────────
-- SELECT signal_name, max_pts FROM trust_score_config
-- WHERE listing_type = 'product_brand' ORDER BY max_pts DESC;
-- SUM(max_pts) should = 120.

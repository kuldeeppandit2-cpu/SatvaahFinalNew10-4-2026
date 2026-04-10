-- trust_score_config seed — individual_service listing type
-- Signals: OTP=20, Geo=20, Aadhaar=25, Credential=15, Ratings=20, ResponseRate=10, LinkedIn=5, Photo=2
-- raw_max_total = 117
-- Safe to re-run: ON CONFLICT (listing_type, signal_name) DO NOTHING

INSERT INTO trust_score_config (id, listing_type, signal_name, max_pts, raw_max_total, is_active, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'individual_service', 'phone_otp_verified',    20, 117, TRUE, 'Firebase OTP verified — minimum for basic tier', NOW(), NOW()),
  (gen_random_uuid(), 'individual_service', 'geo_verified',          20, 117, TRUE, 'GPS location verified within 50m accuracy', NOW(), NOW()),
  (gen_random_uuid(), 'individual_service', 'aadhaar_verified',      25, 117, TRUE, 'DigiLocker Aadhaar-linked identity verified', NOW(), NOW()),
  (gen_random_uuid(), 'individual_service', 'credential_verified',   15, 117, TRUE, 'Professional credential document verified by admin', NOW(), NOW()),
  (gen_random_uuid(), 'individual_service', 'ratings_quality',       20, 117, TRUE, 'Weighted average of verified_contact ratings', NOW(), NOW()),
  (gen_random_uuid(), 'individual_service', 'response_rate',         10, 117, TRUE, 'Lead acceptance rate over last 30 days', NOW(), NOW()),
  (gen_random_uuid(), 'individual_service', 'linkedin_verified',      5, 117, TRUE, 'LinkedIn profile linked and verified', NOW(), NOW()),
  (gen_random_uuid(), 'individual_service', 'profile_photo',          2, 117, TRUE, 'Profile photo uploaded', NOW(), NOW())
ON CONFLICT (listing_type, signal_name) DO NOTHING;

DO $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM trust_score_config WHERE listing_type = 'individual_service';
  RAISE NOTICE 'trust_score_config individual_service: % signals', cnt;
END $$;
-- =============================================================================
-- SatvAAh — trust_score_config seed: individual_product
-- Listing type covers: milkman, vegetable vendor, homemade products, fresh
-- produce sellers — typically sole operators with regular delivery routes
-- and repeat-customer relationships.
--
-- Trust signal philosophy for individual_product:
--   • Identity signals carry high weight (phone OTP, Aadhaar) because consumers
--     are buying consumables — food safety and accountability matter.
--   • Geo-verification matters — "your area's milkman" is the core use case.
--   • Credentials are rarely formal (no govt licence needed unlike expertise)
--     but product quality certifications (FSSAI) are meaningful.
--   • Profile completeness and consistency build familiarity over time.
--   • Customer voice weight grows rapidly due to high repeat-purchase frequency.
--
-- raw_max_total = 200 (sum of all max_pts below when all signals are active).
-- display_score = normalised 0–100 via formula in TrustScore model.
--
-- All rows are admin-editable via admin portal (trust_score_config table).
-- Nothing is hardcoded in application code.
-- =============================================================================

INSERT INTO trust_score_config (
  id,
  listing_type,
  signal_name,
  max_pts,
  description,
  is_active,
  raw_max_total,
  created_at,
  updated_at
) VALUES

-- ── IDENTITY & VERIFICATION SIGNALS (total: 100 pts) ───────────────────────

(
  gen_random_uuid(),
  'individual_product',
  'phone_otp_verified',
  20,
  'Mobile number verified via OTP. Minimum requirement for Basic tier (score ≥ 20). '
  'Establishes accountability — consumer can reach provider on a real number.',
  true,
  200,
  NOW(),
  NOW()
),

(
  gen_random_uuid(),
  'individual_product',
  'aadhaar_verified',
  35,
  'Aadhaar identity verified via DigiLocker OAuth2 PKCE flow. '
  'High weight for individual_product: food/consumable sellers need strong identity. '
  'Only bcrypt(digilocker_uid + per_record_salt, cost=12) stored — Aadhaar number never stored.',
  true,
  200,
  NOW(),
  NOW()
),

(
  gen_random_uuid(),
  'individual_product',
  'geo_verified',
  20,
  'Delivery area / operating location verified via GPS cross-check during profile setup. '
  'Critical for individual_product: "your area milkman" is the primary search intent. '
  'Verified via POST /api/v1/providers/me/verify/geo with acceptable radius tolerance.',
  true,
  200,
  NOW(),
  NOW()
),

(
  gen_random_uuid(),
  'individual_product',
  'fssai_or_quality_cert',
  25,
  'FSSAI registration (Food Safety and Standards Authority of India) or equivalent '
  'quality/hygiene certification. Applies to: milkmen (dairy licence), homemade food '
  'sellers (FSSAI basic registration), fresh produce vendors. '
  'Document uploaded to S3 and queued for admin verification. '
  'Strongest single signal for food/consumable trust.',
  true,
  200,
  NOW(),
  NOW()
),

-- ── PROFILE COMPLETENESS SIGNALS (total: 40 pts) ────────────────────────────

(
  gen_random_uuid(),
  'individual_product',
  'profile_photo',
  15,
  'Profile photo uploaded and passes basic quality check (not blank, not placeholder). '
  'Familiarity matters for daily-delivery providers — consumers recognise "their milkman". '
  'Photo stored in S3 bucket satvaaah-profile-photos-prod.',
  true,
  200,
  NOW(),
  NOW()
),

(
  gen_random_uuid(),
  'individual_product',
  'bio_filled',
  10,
  'Provider bio field completed with at least 50 characters describing their products, '
  'delivery schedule, and area coverage. '
  'Signals effort and establishes product transparency for consumables.',
  true,
  200,
  NOW(),
  NOW()
),

(
  gen_random_uuid(),
  'individual_product',
  'product_catalogue_added',
  15,
  'At least one product listed with price (in paise), unit, and description. '
  'Transparency on what is being sold and at what price builds consumer confidence. '
  'Especially important for homemade product sellers.',
  true,
  200,
  NOW(),
  NOW()
),

-- ── ENGAGEMENT & CONSISTENCY SIGNALS (total: 60 pts) ────────────────────────
-- These are awarded by the trust engine (Lambda: trust-recalculate) based on
-- activity tracked in contact_events, ratings, and provider_lead_usage tables.
-- They are NOT directly grantable by admin — they accrue from genuine activity.

(
  gen_random_uuid(),
  'individual_product',
  'first_accepted_lead',
  15,
  'Provider accepted their first contact_event lead via the Leads screen. '
  'Confirms the provider is active and responsive on the platform. '
  'Awarded once — subsequent leads do not repeat this signal.',
  true,
  200,
  NOW(),
  NOW()
),

(
  gen_random_uuid(),
  'individual_product',
  'consistent_availability',
  10,
  'Provider has updated availability status at least once per 7 days over 30 consecutive days. '
  'Signals reliability — a milkman who marks themselves available daily is more trustworthy '
  'than one who never updates. Checked by Lambda: ratings-refresh on EventBridge daily trigger.',
  true,
  200,
  NOW(),
  NOW()
),

(
  gen_random_uuid(),
  'individual_product',
  'five_plus_accepted_leads',
  20,
  'Provider has accepted 5 or more leads total (provider_lead_usage.leads_accepted >= 5). '
  'Indicates an established, actively transacting seller. '
  'Awarded once when threshold is crossed; tracked by trust-recalculate Lambda.',
  true,
  200,
  NOW(),
  NOW()
),

(
  gen_random_uuid(),
  'individual_product',
  'no_show_free_30d',
  15,
  'No consumer-reported no-show (contact_event status = no_show) in the last 30 days. '
  'For regular delivery providers (milkman, vegetable vendor) consistency is paramount. '
  'This signal decays to 0 if a no_show is reported; recovers after 30 clean days. '
  'Managed by trust-recalculate Lambda on SQS trust-score-updates queue.',
  true,
  200,
  NOW(),
  NOW()
)

ON CONFLICT (listing_type, signal_name) DO UPDATE SET
  max_pts     = EXCLUDED.max_pts,
  description = EXCLUDED.description,
  is_active   = EXCLUDED.is_active,
  updated_at  = NOW();

-- Verify row count
DO $$
DECLARE
  row_count INT;
BEGIN
  SELECT COUNT(*) INTO row_count
  FROM trust_score_config
  WHERE listing_type = 'individual_product';

  IF row_count < 11 THEN
    RAISE EXCEPTION 'individual_product seed incomplete: expected 11 rows, got %', row_count;
  END IF;
END $$;
-- ============================================================
-- SEED: trust_score_config — listing_type: individual_service
-- File: packages/db/seeds/trust_score_config_individual_service.sql
--
-- Covers: plumber, electrician, maid, cook, driver, photographer,
--         barber, tailor, AC repair, carpenter, painter, etc.
--
-- Signal breakdown:
--   OTP Verified         20 pts  — phone verified via Firebase OTP
--   Geo Verified         20 pts  — confirmed within city service area
--   Aadhaar Verified     25 pts  — DigiLocker OAuth2 PKCE (bcrypt hash stored)
--   Credential Verified  15 pts  — portfolio/work samples reviewed by admin
--   Ratings Score        20 pts  — weighted average of consumer ratings
--   Response Rate        10 pts  — % of leads responded to within lead_expiry_hours
--   LinkedIn Verified     5 pts  — LinkedIn profile URL verified
--   Photo Uploaded        2 pts  — profile photo present in S3
--
--   raw_max_total       117 pts  (20+20+25+15+20+10+5+2)
--
-- display_score formula (from trust_scores table):
--   display_score = (verification_score × verification_weight)
--                 + (customer_voice_score × customer_voice_weight)
--   customer_voice_weight = f(rating_count) via customer_weight_curve
--
-- Admin-editable: trust_score_config is writable from admin portal (port 3009).
-- Nothing hardcoded in application code (MASTER_CONTEXT Rule 20).
-- ON CONFLICT DO NOTHING → safe to re-run (idempotent).
-- ============================================================

INSERT INTO trust_score_config
    (listing_type, signal_name, max_pts, raw_max_total, is_active, description)
VALUES

('individual_service', 'otp_verified',         20, 117, TRUE,
    'Phone verified via Firebase OTP at registration. Minimum signal for Basic tier (score >= trust_tier_basic_threshold=20).'),

('individual_service', 'geo_verified',          20, 117, TRUE,
    'Provider confirmed to be within the declared city service area via GPS verification flow.'),

('individual_service', 'aadhaar_verified',      25, 117, TRUE,
    'Identity verified via DigiLocker OAuth2 PKCE. Only bcrypt(digilocker_uid + salt) stored. Aadhaar number NEVER stored (Rule 1 & 2).'),

('individual_service', 'credential_verified',   15, 117, TRUE,
    'Work portfolio or professional samples reviewed and approved by admin. Category-specific (e.g. plumbing photos, electrical work).'),

('individual_service', 'ratings_score',         20, 117, TRUE,
    'Derived from weighted customer voice score. verified_contact=1.0, open_community=0.5, scraped_external=0.3. Scaled to max_pts.'),

('individual_service', 'response_rate',         10, 117, TRUE,
    'Percentage of received leads responded to (accept or decline) within lead_expiry_hours. Sampled over last 90 days.'),

('individual_service', 'linkedin_verified',      5, 117, TRUE,
    'LinkedIn public profile URL provided and verified as active. Optional signal for service providers.'),

('individual_service', 'photo_uploaded',         2, 117, TRUE,
    'Profile photo uploaded to S3 and approved. Minimum quality check at service layer.')

ON CONFLICT (listing_type, signal_name) DO NOTHING;

-- ── Verification query ────────────────────────────────────────
-- Run after seed to confirm:
-- SELECT signal_name, max_pts FROM trust_score_config
-- WHERE listing_type = 'individual_service' ORDER BY max_pts DESC;
-- SUM(max_pts) should = 117.
-- trust_score_config seed — expertise listing type
-- Higher weight on credential (mandatory govt licence), lower on geo
-- raw_max_total = 120
-- Safe to re-run: ON CONFLICT (listing_type, signal_name) DO NOTHING

INSERT INTO trust_score_config (id, listing_type, signal_name, max_pts, raw_max_total, is_active, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'expertise', 'phone_otp_verified',    15, 120, TRUE, 'Firebase OTP verified', NOW(), NOW()),
  (gen_random_uuid(), 'expertise', 'aadhaar_verified',      20, 120, TRUE, 'DigiLocker Aadhaar-linked identity verified', NOW(), NOW()),
  (gen_random_uuid(), 'expertise', 'credential_verified',   35, 120, TRUE, 'Mandatory govt licence verified (Bar Council, MCI, ICAI etc.)', NOW(), NOW()),
  (gen_random_uuid(), 'expertise', 'geo_verified',          10, 120, TRUE, 'Practice location verified', NOW(), NOW()),
  (gen_random_uuid(), 'expertise', 'ratings_quality',       25, 120, TRUE, 'Weighted average of verified_contact ratings', NOW(), NOW()),
  (gen_random_uuid(), 'expertise', 'response_rate',         10, 120, TRUE, 'Consultation acceptance rate', NOW(), NOW()),
  (gen_random_uuid(), 'expertise', 'profile_photo',          5, 120, TRUE, 'Professional profile photo uploaded', NOW(), NOW())
ON CONFLICT (listing_type, signal_name) DO NOTHING;

DO $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM trust_score_config WHERE listing_type = 'expertise';
  RAISE NOTICE 'trust_score_config expertise: % signals', cnt;
END $$;
-- trust_score_config seed — establishment listing type
-- GST registration, business longevity, and FSSAI/trade licence signals
-- raw_max_total = 115
-- Safe to re-run: ON CONFLICT (listing_type, signal_name) DO NOTHING

INSERT INTO trust_score_config (id, listing_type, signal_name, max_pts, raw_max_total, is_active, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'establishment', 'phone_otp_verified',    15, 115, TRUE, 'Business phone OTP verified', NOW(), NOW()),
  (gen_random_uuid(), 'establishment', 'geo_verified',          20, 115, TRUE, 'Physical establishment location verified within 50m', NOW(), NOW()),
  (gen_random_uuid(), 'establishment', 'credential_verified',   25, 115, TRUE, 'Business licence verified (FSSAI / trade licence / GST)', NOW(), NOW()),
  (gen_random_uuid(), 'establishment', 'gst_registered',        15, 115, TRUE, 'GST registration number verified', NOW(), NOW()),
  (gen_random_uuid(), 'establishment', 'ratings_quality',       25, 115, TRUE, 'Weighted average of customer ratings', NOW(), NOW()),
  (gen_random_uuid(), 'establishment', 'response_rate',          8, 115, TRUE, 'Lead and inquiry response rate', NOW(), NOW()),
  (gen_random_uuid(), 'establishment', 'profile_photo',          7, 115, TRUE, 'Establishment photo uploaded', NOW(), NOW())
ON CONFLICT (listing_type, signal_name) DO NOTHING;

DO $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM trust_score_config WHERE listing_type = 'establishment';
  RAISE NOTICE 'trust_score_config establishment: % signals', cnt;
END $$;
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
-- trust_score_config seed — product_brand listing type
-- Also covers individual_product (milkman, vegetable vendor)
-- raw_max_total = 110
-- Safe to re-run: ON CONFLICT (listing_type, signal_name) DO NOTHING

INSERT INTO trust_score_config (id, listing_type, signal_name, max_pts, raw_max_total, is_active, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'individual_product', 'phone_otp_verified',    20, 110, TRUE, 'Firebase OTP verified', NOW(), NOW()),
  (gen_random_uuid(), 'individual_product', 'geo_verified',          20, 110, TRUE, 'Delivery area geo verified', NOW(), NOW()),
  (gen_random_uuid(), 'individual_product', 'ratings_quality',       30, 110, TRUE, 'Weighted average of customer ratings', NOW(), NOW()),
  (gen_random_uuid(), 'individual_product', 'response_rate',         15, 110, TRUE, 'Order fulfilment and response rate', NOW(), NOW()),
  (gen_random_uuid(), 'individual_product', 'profile_photo',          5, 110, TRUE, 'Product photo uploaded', NOW(), NOW()),
  (gen_random_uuid(), 'individual_product', 'aadhaar_verified',      20, 110, TRUE, 'Aadhaar identity verified', NOW(), NOW())
ON CONFLICT (listing_type, signal_name) DO NOTHING;

INSERT INTO trust_score_config (id, listing_type, signal_name, max_pts, raw_max_total, is_active, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'product_brand', 'phone_otp_verified',    10, 115, TRUE, 'Brand contact phone verified', NOW(), NOW()),
  (gen_random_uuid(), 'product_brand', 'credential_verified',   30, 115, TRUE, 'Brand registration / FSSAI / trade mark verified', NOW(), NOW()),
  (gen_random_uuid(), 'product_brand', 'gst_registered',        20, 115, TRUE, 'GST registration verified', NOW(), NOW()),
  (gen_random_uuid(), 'product_brand', 'geo_verified',          15, 115, TRUE, 'Brand distribution location verified', NOW(), NOW()),
  (gen_random_uuid(), 'product_brand', 'ratings_quality',       30, 115, TRUE, 'Weighted average of customer ratings', NOW(), NOW()),
  (gen_random_uuid(), 'product_brand', 'profile_photo',         10, 115, TRUE, 'Brand logo and product photos uploaded', NOW(), NOW())
ON CONFLICT (listing_type, signal_name) DO NOTHING;

DO $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM trust_score_config WHERE listing_type IN ('individual_product', 'product_brand');
  RAISE NOTICE 'trust_score_config individual_product + product_brand: % signals', cnt;
END $$;

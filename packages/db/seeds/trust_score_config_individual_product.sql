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

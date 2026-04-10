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

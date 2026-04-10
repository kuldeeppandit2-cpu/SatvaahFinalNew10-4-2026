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

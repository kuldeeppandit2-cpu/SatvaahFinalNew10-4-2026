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

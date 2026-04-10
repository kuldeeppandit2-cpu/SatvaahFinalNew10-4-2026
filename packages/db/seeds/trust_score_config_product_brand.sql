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

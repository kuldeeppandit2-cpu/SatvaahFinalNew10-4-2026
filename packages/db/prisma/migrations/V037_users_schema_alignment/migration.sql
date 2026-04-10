-- =============================================================================
-- V037_users_schema_alignment
-- Aligns users table (created by V002) with schema.prisma canonical definition.
-- Changes:
--   1. referral_code: VARCHAR(12) → VARCHAR(16) (schema has VarChar(16))
--   2. fcm_token: TEXT → VARCHAR(512) (schema has VarChar(512))
--   3. referred_by_user_id: column exists in DB but NOT in schema.prisma
--      (referrals tracked in referral_events table instead)
--      Column dropped — data moved to referral_events if needed.
--   4. Add missing columns from schema that V002 omitted
-- =============================================================================

-- 1. Expand referral_code to VARCHAR(16)
ALTER TABLE users
  ALTER COLUMN referral_code TYPE VARCHAR(16);

-- 2. Constrain fcm_token to VARCHAR(512) (matches schema)
ALTER TABLE users
  ALTER COLUMN fcm_token TYPE VARCHAR(512);

-- 3. Drop referred_by_user_id — referrals now tracked in referral_events
--    (schema.prisma User model has no referred_by_user_id field)
ALTER TABLE users
  DROP COLUMN IF EXISTS referred_by_user_id;

-- 4. Make referral_code NOT NULL (schema has no ? so it's required)
--    First fill any NULLs (shouldn't exist in practice)
UPDATE users
  SET referral_code = upper(replace(gen_random_uuid()::text, '-', ''))
  WHERE referral_code IS NULL;

ALTER TABLE users
  ALTER COLUMN referral_code SET NOT NULL;

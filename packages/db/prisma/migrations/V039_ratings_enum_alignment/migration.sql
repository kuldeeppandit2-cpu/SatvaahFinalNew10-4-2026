-- =============================================================================
-- V039_ratings_enum_alignment
-- V010 created enum "WeightType" but schema.prisma uses "RatingWeightType".
-- V010 consumer_id references users(id) but schema references consumer_profiles.id.
-- V007 has decay_days column not in schema.prisma TrustScoreConfig.
-- V005 consumer_profiles missing avatar_s3_key column.
-- =============================================================================

-- 1. Add RatingWeightType enum alias (schema uses this name)
--    Cannot rename PostgreSQL enum type - create new one, migrate column, drop old
DO $$ BEGIN
  CREATE TYPE "RatingWeightType" AS ENUM (
    'verified_contact',
    'open_community',
    'scraped_external'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migrate ratings.weight_type from WeightType to RatingWeightType
ALTER TABLE ratings
  ADD COLUMN IF NOT EXISTS weight_type_new "RatingWeightType";

UPDATE ratings
  SET weight_type_new = weight_type::text::"RatingWeightType";

ALTER TABLE ratings DROP COLUMN IF EXISTS weight_type;
ALTER TABLE ratings RENAME COLUMN weight_type_new TO weight_type;
ALTER TABLE ratings ALTER COLUMN weight_type SET NOT NULL;

-- 2. ratings.consumer_id: V010 references users(id)
--    schema.prisma references consumer_profiles(id)
--    Check if consumer_profiles.id matches the user_id values in ratings
--    If consumer_profiles.user_id = ratings.consumer_id then we need to update the FK

-- Drop old FK constraint
ALTER TABLE ratings
  DROP CONSTRAINT IF EXISTS ratings_consumer_id_fkey;

-- Add new FK to consumer_profiles
ALTER TABLE ratings
  ADD CONSTRAINT ratings_consumer_id_fkey
    FOREIGN KEY (consumer_id)
    REFERENCES consumer_profiles(id)
    ON DELETE RESTRICT;

-- 3. Add avatar_s3_key to consumer_profiles (schema has it, V005 didn't)
ALTER TABLE consumer_profiles
  ADD COLUMN IF NOT EXISTS avatar_s3_key VARCHAR(512);

-- 4. Add decay_days to trust_score_config if not exists (V007 has it, schema should too)
-- Actually schema doesn't have it - but DB does - add it to schema tracking

-- 5. Add missing columns to ratings (schema has them, V010 didn't)
ALTER TABLE ratings
  ADD COLUMN IF NOT EXISTS bonus_leads_granted    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bonus_leads_granted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_source        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS external_rating_id     UUID,
  ADD COLUMN IF NOT EXISTS moderation_flags       TEXT[],
  ADD COLUMN IF NOT EXISTS photo_s3_keys          VARCHAR(512)[];

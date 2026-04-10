-- =============================================================================
-- V038_provider_profiles_alignment
-- Aligns provider_profiles table (V004) with schema.prisma canonical definition.
-- Rule #23: schema.prisma wins over migrations — this migration updates the DB.
--
-- Column changes:
--   profile_photo_url → profile_photo_s3_key (S3 key not URL per MASTER_CONTEXT)
--   home_visit → home_visit_available (schema field name)
--   is_credential_verified → has_credentials (schema field name)
--   availability JSONB → availability Availability enum (enum not JSONB)
--   digilocker_uid_hash → removed (moved to provider_verifications table)
--
-- Columns added (in schema, missing from V004):
--   business_name, whatsapp_phone, website_url, taxonomy_node_id,
--   geo_verified_at, availability_updated_at, slot_calendar_enabled,
--   has_profile_photo, claimed_at, deactivated_at, deactivation_reason,
--   scrape_source (already exists), scrape_external_id
-- =============================================================================

-- 1. Create Availability enum (schema.prisma defines it)
DO $$ BEGIN
  CREATE TYPE "Availability" AS ENUM ('available', 'busy', 'away', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Rename columns to match schema.prisma
ALTER TABLE provider_profiles
  RENAME COLUMN profile_photo_url TO profile_photo_s3_key;

ALTER TABLE provider_profiles
  RENAME COLUMN home_visit TO home_visit_available;

ALTER TABLE provider_profiles
  RENAME COLUMN is_credential_verified TO has_credentials;

-- 3. Change availability from JSONB to Availability enum
-- First add new column, populate from JSONB, then drop old
ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS availability_new "Availability" DEFAULT 'available';

-- Migrate any existing JSONB availability to enum
-- If JSONB has is_available=false, set to 'offline', else 'available'
UPDATE provider_profiles
  SET availability_new = CASE
    WHEN (availability->>'is_available')::boolean = false THEN 'offline'::"Availability"
    ELSE 'available'::"Availability"
  END
  WHERE availability IS NOT NULL;

ALTER TABLE provider_profiles DROP COLUMN IF EXISTS availability;
ALTER TABLE provider_profiles RENAME COLUMN availability_new TO availability;

-- 4. Drop digilocker_uid_hash from provider_profiles
--    (moved to provider_verifications table per schema.prisma)
ALTER TABLE provider_profiles
  DROP COLUMN IF EXISTS digilocker_uid_hash;

-- 5. Add missing columns that schema.prisma has but V004 didn't create
ALTER TABLE provider_profiles
  ADD COLUMN IF NOT EXISTS business_name        VARCHAR(200),
  ADD COLUMN IF NOT EXISTS whatsapp_phone       VARCHAR(15),
  ADD COLUMN IF NOT EXISTS website_url          VARCHAR(500),
  ADD COLUMN IF NOT EXISTS taxonomy_node_id     UUID REFERENCES taxonomy_nodes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS geo_verified_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS availability_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS slot_calendar_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_profile_photo       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS claimed_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivation_reason     VARCHAR(500);

-- 6. type VARCHAR(512) for profile_photo_s3_key
ALTER TABLE provider_profiles
  ALTER COLUMN profile_photo_s3_key TYPE VARCHAR(512);

-- 7. Add index on taxonomy_node_id
CREATE INDEX IF NOT EXISTS idx_pp_taxonomy_node_id
  ON provider_profiles(taxonomy_node_id)
  WHERE taxonomy_node_id IS NOT NULL;

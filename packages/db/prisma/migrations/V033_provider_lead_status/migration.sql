-- V033_provider_lead_status
-- The ProviderLeadStatus enum and provider_status column were created in V009
-- but were missing from schema.prisma (Rule #23: schema is canonical source).
-- This migration documents the reconciliation.
-- The column already exists in DB from V009 — this is a no-op for existing DBs.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'ProviderLeadStatus'
  ) THEN
    CREATE TYPE "ProviderLeadStatus" AS ENUM (
      'pending', 'accepted', 'declined', 'expired'
    );
  END IF;
END$$;

ALTER TABLE contact_events
  ADD COLUMN IF NOT EXISTS provider_status "ProviderLeadStatus" NOT NULL DEFAULT 'pending';

-- =============================================================================
-- V041_trust_scores_alignment
-- Fixes gaps between V004/V006/V007 and schema.prisma canonical definition.
--
-- 1. provider_profiles.city_id: nullable in V004, NOT NULL in schema
-- 2. trust_scores missing signal_breakdown JSONB column (schema has it)
-- 3. trust_score_config.decay_days exists in DB (V007) but missing from schema
-- =============================================================================

-- 1. Make provider_profiles.city_id NOT NULL
--    Set any NULL city_id to Hyderabad (the only seeded city) before constraining
UPDATE provider_profiles
  SET city_id = (SELECT id FROM cities WHERE name = 'Hyderabad' LIMIT 1)
  WHERE city_id IS NULL;

ALTER TABLE provider_profiles
  ALTER COLUMN city_id SET NOT NULL;

-- 2. Add signal_breakdown to trust_scores
--    Stores per-signal point breakdown for trust history UI
ALTER TABLE trust_scores
  ADD COLUMN IF NOT EXISTS signal_breakdown JSONB NOT NULL DEFAULT '{}';

-- 3. trust_score_config.decay_days — already in DB (V007), add to schema tracking
--    No SQL needed — column exists. Schema updated separately.

COMMENT ON COLUMN trust_scores.signal_breakdown IS
  'Per-signal point breakdown. Keys match signal_name in trust_score_config. '
  'E.g.: {"phone_otp_verified": 5, "aadhaar_verified": 20, ...}';

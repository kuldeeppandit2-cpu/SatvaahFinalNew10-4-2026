-- V053: Add search_ring_6_km to system_config
-- Extends ring expansion from 5 rings (max 150km) to 6 rings (max 1000km).
-- Enables pan-India search for rare specialists (interventional surgeons,
-- niche expertise) who may not exist within 150km of the consumer.
-- All ring values are admin-configurable via PUT /admin/system-config/:key.
-- The 6th ring is intentionally large — it signals genuine scarcity to the
-- consumer rather than silently returning no results.

BEGIN;

INSERT INTO system_config (key, value, data_type, description, updated_by)
VALUES (
  'search_ring_6_km',
  '1000',
  'integer',
  'Sixth search ring radius in km (pan-India, rare specialists only). Ring expansion: 3→7→15→50→150→1000km.',
  'system'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

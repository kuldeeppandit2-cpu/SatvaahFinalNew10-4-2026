-- V054: Search bucket strategy — 7-bucket waterfall config
-- Replaces simple ring expansion with priority-ordered bucket search.
-- All values admin-configurable via PUT /api/v1/admin/system-config/:key
-- GET /api/v1/admin/system-config returns all rows — admin panel reads automatically.

BEGIN;

INSERT INTO system_config (key, value, data_type, description, updated_by) VALUES

('search_bucket_max_results',
 '5',
 'integer',
 'Maximum results returned per search bucket. Customer sees up to this many per priority tier.',
 'system'),

('search_bucket_1_max_km',
 '6',
 'integer',
 'Bucket 1: Verified vendors — vicinity radius in km (0 to this value). Default 6km.',
 'system'),

('search_bucket_2_min_km',
 '7',
 'integer',
 'Bucket 2: Verified vendors — city outer ring minimum km. Default 7km.',
 'system'),

('search_bucket_2_max_km',
 '50',
 'integer',
 'Bucket 2: Verified vendors — city outer ring maximum km. Default 50km.',
 'system'),

('search_bucket_3_max_km',
 '50',
 'integer',
 'Bucket 3: Verified vendors — related category (L3 fallback) within city. Default 50km.',
 'system'),

('search_bucket_4_max_km',
 '6',
 'integer',
 'Bucket 4: Unverified vendors — vicinity radius in km. Default 6km.',
 'system'),

('search_bucket_5_min_km',
 '7',
 'integer',
 'Bucket 5: Unverified vendors — city outer ring minimum km. Default 7km.',
 'system'),

('search_bucket_5_max_km',
 '50',
 'integer',
 'Bucket 5: Unverified vendors — city outer ring maximum km. Default 50km.',
 'system'),

('search_bucket_6_max_km',
 '50',
 'integer',
 'Bucket 6: Unverified vendors — related category (L3 fallback) within city. Default 50km.',
 'system'),

('search_bucket_7_tabs',
 'services,expertise',
 'string',
 'Bucket 7: Comma-separated tabs for outside-city search. Products excluded by default.',
 'system'),

('search_bucket_7_max_km',
 '1000',
 'integer',
 'Bucket 7: Outside-city search radius in km. Default 1000km (pan-India).',
 'system')

ON CONFLICT (key) DO NOTHING;

COMMIT;

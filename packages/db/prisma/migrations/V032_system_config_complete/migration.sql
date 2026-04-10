-- =============================================================================
-- system_config_complete.sql
-- Ensures ALL config keys from User Journey v3 are present with correct values.
-- Uses ON CONFLICT (key) DO UPDATE to fix wrong values and add missing keys.
-- Safe to run multiple times. Run after all migrations.
-- Source of truth: SatvAAh User Journey v3 Part 6 — Complete Configuration Table
-- =============================================================================

INSERT INTO system_config (key, value, data_type, description, updated_by) VALUES
-- CONTACT
('search_lead_cost',                '0',                   'integer', 'Search is always free. Never changes.',                                        'system'),
('view_availability_min_tier',      'free',                'string',  'Min tier to see availability status. free = all consumers.',                    'system'),
('view_calendar_min_tier',          'gold',                'string',  'Min tier to see and book from provider calendar.',                              'system'),
('lead_refund_on_no_show',          'true',                'boolean', 'Return consumer lead if provider no-shows. Always true at launch.',             'system'),
('no_show_penalty_enabled',         'true',                'boolean', 'Apply trust penalty for confirmed provider no-show.',                           'system'),
-- RATING
('rating_trigger_hours',            '24',                  'integer', 'Hours after contact_event before rating prompt FCM fires.',                     'system'),
('rating_requires_contact_services','true',                'boolean', 'Services tab: contact_event mandatory to rate. Cannot be overridden.',          'system'),
('rating_requires_contact_expertise','true',               'boolean', 'Expertise tab: contact_event mandatory to rate. Cannot be overridden.',         'system'),
('rating_contact_window_days',      '90',                  'integer', 'Contact must be within this many days to enable rating.',                       'system'),
('rating_same_provider_cooldown_days','30',                'integer', 'Must wait 30 days to re-rate same provider.',                                   'system'),
('rating_burst_threshold',          '3',                   'integer', 'Max ratings in burst window before flag. Does NOT block — flags only.',         'system'),
('rating_burst_window_minutes',     '60',                  'integer', 'Burst detection window in minutes.',                                            'system'),
('open_rating_requires_otp',        'true',                'boolean', 'OTP verification required for open community ratings.',                         'system'),
('verified_rating_weight',          '1.0',                 'float',   'Verified SatvAAh contact rating weight. Full trust. Cannot be faked.',          'system'),
('open_rating_weight',              '0.50',                'float',   'Open community (OTP-verified) rating weight. Half trust.',                      'system'),
('scraped_rating_weight',           '0.30',                'float',   'Scraped external rating weight (Google, Zomato, Practo).',                      'system'),
('min_ratings_for_trust_signal',    '3',                   'integer', 'Min ratings before signal counts in trust score calculation.',                  'system'),
-- DISCOVERY
('push_discovery_enabled',          'true',                'boolean', 'Enable search intent match notifications via FCM.',                             'system'),
('push_discovery_max_per_user_per_day','1',                'integer', 'Anti-spam: max 1 discovery push per user per day.',                             'system'),
-- SEARCH
('search_narration_enabled',        'true',                'boolean', 'Show ring expansion narration banner in search results.',                       'system'),
('fuzzy_match_threshold',           '0.75',                'float',   'Taxonomy node name similarity for fuzzy matching in search autocomplete.',      'system'),
('suggest_min_chars',               '2',                   'integer', 'Min characters before autocomplete fires.',                                     'system'),
('suggest_max_results',             '8',                   'integer', 'Max autocomplete suggestions returned.',                                        'system'),
('results_per_page',                '10',                  'integer', 'Provider cards per search page.',                                               'system'),
('social_proof_hyperlocal_enabled', 'true',                'boolean', 'Show 47 people in Banjara Hills used Rajesh on search cards.',                  'system'),
-- TRUST / CERTIFICATE
('certificate_score_threshold',     '80',                  'integer', 'Min display_score for Certificate of Verification.',                            'system'),
('certificate_validity_days',       '365',                 'integer', 'Certificate valid_until = issued_at + this many days.',                         'system'),
-- UI
('commission_counter_enabled',      'true',                'boolean', 'Show running zero commission saved counter on provider dashboard.',              'system'),
('commission_counter_competitor_rate','0.25',              'float',   'Competitor rate (25%) for counter calculation.',                                 'system'),
('live_activity_enabled',           'false',               'boolean', 'Show live search activity counts on home screen. Enable when city density hit.','system'),
('rising_brands_enabled',           'true',                'boolean', 'Show Rising Brands section in Products tab.',                                   'system'),
('rising_brands_min_trust',         '60',                  'integer', 'Min trust score to appear in Rising Brands.',                                   'system'),
('rising_brands_max_age_days',      '30',                  'integer', 'Max days since joining to be considered a Rising Brand.',                       'system'),
('trusted_circle_min_contacts',     '3',                   'integer', 'Min contacts before Trusted Circle section shows on consumer home.',            'system'),
-- LONGEVITY SIGNALS (establishment)
('longevity_1yr_pts',               '5',                   'integer', 'Trust pts for 1 year verified operation.',                                      'system'),
('longevity_5yr_pts',               '12',                  'integer', 'Trust pts for 5 years verified operation.',                                     'system'),
('longevity_10yr_pts',              '18',                  'integer', 'Trust pts for 10 years.',                                                       'system'),
('longevity_20yr_pts',              '25',                  'integer', 'Maximum longevity pts. Cannot be faked or rushed.',                             'system'),
-- REFERRAL
('referral_lead_bonus_per_join',    '5',                   'integer', 'Bonus leads for referrer per successful referral.',                             'system'),
('referral_join_bonus_days_bronze', '30',                  'integer', 'Free Bronze days for person who joins via referral.',                           'system'),
('referral_milestone_5_reward',     'bronze_1yr',          'string',  'Reward for 5 successful referrals.',                                            'system'),
('referral_milestone_10_reward',    'silver_1yr',          'string',  'Reward for 10 successful referrals.',                                           'system'),
('referral_milestone_25_reward',    'gold_1yr',            'string',  'Reward for 25 successful referrals.',                                           'system'),
-- TSaaS
('tsaas_consent_required',          'true',                'boolean', 'Provider must consent before TSaaS returns their data.',                        'system'),
('tsaas_consent_trust_pts',         '3',                   'integer', 'Trust points earned for consenting to TSaaS sharing.',                          'system'),
-- SCHEDULING
('slot_duration_minutes',           '30',                  'integer', 'Duration of each availability calendar slot in minutes.',                       'system'),
-- CONSUMER / TRUST
('consumer_trust_start',            '75',                  'integer', 'Starting consumer trust score for all new users (benefit of doubt).',           'system'),
('geo_confirm_accuracy_metres',     '50',                  'integer', 'GPS accuracy required for geo-confirm signal.',                                 'system'),
('digilocker_enabled',              'true',                'boolean', 'Enable DigiLocker Aadhaar flow. Admin can disable for testing.',                 'system'),
-- FCM FALLBACK (Part 9)
('fcm_fallback_timeout_minutes_lead','5',                  'integer', 'Minutes before undelivered NEW_LEAD FCM triggers WhatsApp fallback.',            'system'),
('fcm_fallback_timeout_minutes_accepted','5',              'integer', 'Minutes before undelivered CONTACT_ACCEPTED FCM triggers WhatsApp fallback.',   'system'),
('fcm_fallback_lookback_minutes',   '30',                  'integer', 'Look-back window: do not retry FCM older than this many minutes.',              'system'),
('fcm_aggressive_battery_manufacturers','Xiaomi,Realme,OPPO,Vivo,OnePlus','string','Android manufacturers with aggressive battery management. Show background permission prompt.','system'),
('fcm_delivery_alert_threshold',    '0.70',                'float',   'Alert admin if FCM delivery rate drops below this threshold for any city.',      'system')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_by = 'system_migration',
      updated_at = NOW();

-- Fix wrong value: push_discovery_trust_threshold should be 60 not 80
-- (User Journey v3 Part 2.10: push_discovery_trust_threshold=60)
UPDATE system_config SET value = '60', updated_by = 'system_migration', updated_at = NOW()
WHERE key = 'push_discovery_trust_threshold' AND value = '80';

-- Verify final count
DO $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM system_config;
  RAISE NOTICE 'system_config total keys: %', cnt;
END $$;

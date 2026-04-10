-- ============================================================
-- V031 — seed_system_config
-- INSERT all 68 system_config keys with production defaults.
-- ON CONFLICT DO NOTHING → safe to re-run (idempotent).
--
-- MASTER_CONTEXT Rule 20: Nothing hardcoded.
-- ALL thresholds must live here. Application reads via
-- packages/config/src/systemConfig.ts → loadSystemConfig().
-- Hot-reload on SIGHUP. Admin portal (port 3009) edits these live.
--
-- Key naming convention: snake_case, category prefix.
-- value_type hints loadSystemConfig() on type coercion.
-- updated_by = 'system' for all seed defaults.
--
-- Categories (68 keys total):
--   Trust Score & Tiers        (9)   trust_tier_*, customer_voice_*, certificate_*
--   Certificate                (3)   certificate_id_prefix, certificate_seq_*, certificate_validity_*
--   Contact Events & Leads     (7)   contact_*, reveal_*, lead_*, no_show_*, slot_*
--   Rating System              (10)  rating_*, scraped_external_*
--   Referral System            (5)   referral_*
--   Subscription & Payments    (5)   subscription_*, razorpay_*, *_tier_leads_*
--   Search Ring Expansion      (5)   search_ring_*_km
--   Scraping & Outreach        (6)   scraping_*
--   TSaaS                      (4)   tsaas_*
--   OpenSearch Sync            (4)   opensearch_*
--   Anonymisation / DPDP       (4)   anonymisation_*, data_*
--   AI / Analytics             (4)   ai_*, gemini_*, gaas_*
--   WhatsApp Policy            (2)   wa_*
-- ============================================================

INSERT INTO system_config (key, value, data_type, description, updated_by) VALUES


('trust_tier_basic_threshold',
 '20',
 'integer',
 'Minimum display_score for Basic tier (Saffron). OTP-verified providers reach this immediately. MASTER_CONTEXT Rule 22.',
 'system'),

('trust_tier_trusted_threshold',
 '60',
 'integer',
 'Minimum display_score for Trusted tier (Light Verdigris). Aadhaar or credential verification required.',
 'system'),

('trust_tier_highly_trusted_threshold',
 '80',
 'integer',
 'Minimum display_score for Highly Trusted tier (Verdigris). Full verification + customer voice. Certificate eligible.',
 'system'),

('customer_voice_max_weight',
 '0.70',
 'float',
 'Hard cap on customer_voice_weight regardless of rating_count. verification_weight = 1.0 - customer_voice_weight.',
 'system'),

('customer_weight_curve',
 '0:0.10,3:0.20,10:0.30,50:0.65,200:0.70',
 'json',
 'Piecewise linear curve mapping rating_count to customer_voice_weight. Format: count:weight pairs, comma-separated.',
 'system'),

('certificate_below_grace_days',
 '30',
 'integer',
 'Number of consecutive days score must remain below highly_trusted threshold before certificate is invalidated.',
 'system'),

('push_discovery_trust_threshold',
 '80',
 'integer',
 'Trust score threshold that triggers Lambda:push-discovery to match provider against search_intents and send FCM.',
 'system'),

('trust_score_stale_recalc_hours',
 '24',
 'integer',
 'Hours after which a trust_score row is considered stale and queued for recalculation even without a signal change.',
 'system'),

('trust_score_recalc_cooldown_mins',
 '30',
 'integer',
 'Minimum minutes between trust score recalculations for a single provider to prevent SQS storms.',
 'system'),


('certificate_id_prefix',
 'SAT',
 'string',
 'Prefix for Certificate IDs. Format: {prefix}-{CITY_CODE}-{YEAR}-{5DIGIT_SEQ}. e.g. SAT-HYD-2026-08412.',
 'system'),

('certificate_seq_padding',
 '5',
 'integer',
 'Zero-padding width for the sequence number in certificate IDs. 5 → 08412.',
 'system'),

('certificate_validity_years',
 '1',
 'integer',
 'Certificate valid_until = issued_at + this many years. Set 0 for no expiry. Grace period governs de-listing.',
 'system'),


('contact_lead_cost',
 '0',
 'integer',
 'Lead cost in paise (all amounts in paise per Rule 3). 0 = free at launch. Admin-configurable without code deploy.',
 'system'),

('reveal_consumer_phone_on_accept',
 'true',
 'boolean',
 'When provider accepts a lead, consumer phone number is revealed to provider. Set false to disable.',
 'system'),

('lead_expiry_hours',
 '48',
 'integer',
 'Hours after which an unaccepted lead expires and is moved to status=expired.',
 'system'),

('no_show_trust_penalty_pts',
 '5',
 'integer',
 'Trust score delta_pts deducted from provider when consumer reports a no-show.',
 'system'),

('no_show_lead_refund',
 'true',
 'boolean',
 'When consumer reports no-show, refund the lead to the consumer quota.',
 'system'),

('lead_limit_warning_pct',
 '80',
 'integer',
 'Percentage of monthly lead quota used before sending lead_limit_warning WhatsApp notification.',
 'system'),

('slot_booking_min_tier',
 'gold',
 'string',
 'Minimum subscription tier for consumer to initiate slot_booking contact type. gold or silver.',
 'system'),


('rating_bonus_leads',
 '2',
 'integer',
 'Leads credited to consumer for submitting a rating. Applied by services/rating after moderation passes.',
 'system'),

('rating_expiry_after_skips',
 '3',
 'integer',
 'Number of times a consumer can skip a rating prompt before it expires.',
 'system'),

('rating_min_account_age_days',
 '7',
 'integer',
 'Minimum account age in days before consumer can submit open_community ratings.',
 'system'),

('rating_daily_limit_products',
 '10',
 'integer',
 'Max open_community ratings per consumer per day for Products tab. Contact event NOT required.',
 'system'),

('rating_daily_limit_services',
 '5',
 'integer',
 'Max open_community ratings per consumer per day for Services tab. Contact event MANDATORY.',
 'system'),

('rating_daily_limit_expertise',
 '3',
 'integer',
 'Max open_community ratings per consumer per day for Expertise tab. Contact event MANDATORY.',
 'system'),

('rating_daily_limit_establishments',
 '8',
 'integer',
 'Max open_community ratings per consumer per day for Establishments tab. Contact event NOT required.',
 'system'),

('scraped_external_weight',
 '0.30',
 'float',
 'Weight applied to scraped_external ratings in trust score calculation.',
 'system'),

('scraped_external_stale_days',
 '90',
 'integer',
 'Days after last refresh before an external_ratings row is marked is_stale=TRUE.',
 'system'),

('scraped_external_stale_weight',
 '0.15',
 'float',
 'Halved weight applied to stale scraped_external ratings (>90 days old).',
 'system'),


('referral_reward_leads',
 '5',
 'integer',
 'Number of leads credited to referrer when referred user converts.',
 'system'),

('referral_code_expiry_days',
 '30',
 'integer',
 'Days after which an unused referral code expires.',
 'system'),

('referral_max_per_user',
 '50',
 'integer',
 'Maximum number of successful referrals per user.',
 'system'),

('referral_reward_type',
 'leads',
 'string',
 'Reward currency: leads or subscription_days. Default is leads.',
 'system'),

('referral_converted_window_days',
 '14',
 'integer',
 'Days after referral apply within which referred user must convert for reward to be granted.',
 'system'),


('subscription_expiry_warning_days',
 '7',
 'integer',
 'Days before subscription expiry to send subscription_expiry_7d WhatsApp notification.',
 'system'),

('subscription_grace_period_days',
 '3',
 'integer',
 'Grace period days after subscription_records.end_date before access is revoked.',
 'system'),

('razorpay_webhook_tolerance_secs',
 '300',
 'integer',
 'Maximum age in seconds for Razorpay webhook timestamp (HMAC-SHA256 replay protection). MASTER_CONTEXT Rule 9.',
 'system'),

('free_tier_leads_per_month',
 '10',
 'integer',
 'Monthly lead allocation for free-tier consumers.',
 'system'),

('consumer_gold_leads_per_month',
 '50',
 'integer',
 'Monthly lead allocation for Gold-tier consumer subscribers.',
 'system'),


('search_ring_1_km',
 '3',
 'integer',
 'First search ring radius in km. Ring expansion: 3→7→15→50→150km.',
 'system'),

('search_ring_2_km',
 '7',
 'integer',
 'Second search ring radius in km.',
 'system'),

('search_ring_3_km',
 '15',
 'integer',
 'Third search ring radius in km.',
 'system'),

('search_ring_4_km',
 '50',
 'integer',
 'Fourth search ring radius in km (city-wide).',
 'system'),

('search_ring_5_km',
 '150',
 'integer',
 'Fifth search ring radius in km (cross-city, high-value expertise only).',
 'system'),


('scraping_outreach_attempt_2_delay_hours',
 '48',
 'integer',
 'Hours after attempt 1 to schedule attempt 2 (template: activation_reminder_48h).',
 'system'),

('scraping_outreach_attempt_3_delay_days',
 '7',
 'integer',
 'Days after attempt 1 to schedule attempt 3 (template: provider_final_reminder_7d).',
 'system'),

('scraping_dedupe_threshold',
 '0.85',
 'float',
 'NLP fuzzy match confidence threshold for name-level deduplication (0–1).',
 'system'),

('scraping_max_daily_outreach',
 '500',
 'integer',
 'Maximum WhatsApp outreach messages Lambda:outreach-scheduler can send per day.',
 'system'),

('scraping_stale_days',
 '180',
 'integer',
 'Days after last scraping_jobs run before a city+taxonomy combination is re-scraped.',
 'system'),

('scraping_nlp_min_confidence',
 '0.70',
 'float',
 'Minimum NLP confidence score for extracted_taxonomy_node_id to be set on staging record.',
 'system'),


('tsaas_default_monthly_limit',
 '1000',
 'integer',
 'Default API call quota per month for new TSaaS clients.',
 'system'),

('tsaas_rate_limit_per_minute',
 '60',
 'integer',
 'Maximum TSaaS API calls per minute per client_id (Redis rate limiter).',
 'system'),

('tsaas_response_cache_ttl_secs',
 '300',
 'integer',
 'TTL in seconds for trust score responses cached in Redis for TSaaS endpoints.',
 'system'),

('tsaas_enabled',
 'true',
 'boolean',
 'Master switch for TSaaS endpoints. Set false to disable /api/v2/tsaas/* globally.',
 'system'),


('opensearch_sync_retry_max',
 '3',
 'integer',
 'Maximum SQS receive count before message moves to DLQ. Matches SQS maxReceiveCount. MASTER_CONTEXT Rule 24.',
 'system'),

('opensearch_sync_retry_delay_secs',
 '5',
 'integer',
 'Base delay in seconds between Lambda:opensearch-sync retry attempts.',
 'system'),

('opensearch_index_name',
 'satvaaah_providers',
 'string',
 'OpenSearch index name for provider search documents.',
 'system'),

('opensearch_bulk_batch_size',
 '100',
 'integer',
 'Number of provider documents per bulk index operation in Lambda:opensearch-sync.',
 'system'),


('anonymisation_deadline_hours',
 '72',
 'integer',
 'Hours within which Lambda:anonymisation must complete after DELETE /api/v1/users/me. DPDP Act 2023.',
 'system'),

('data_export_max_records',
 '10000',
 'integer',
 'Maximum records included in GET /api/v1/users/me/data-export (DPDP right to access).',
 'system'),

('data_retention_years',
 '5',
 'integer',
 'Years to retain user data after account deletion (DPDP Act 2023 compliance).',
 'system'),

('deletion_audit_retention_years',
 '7',
 'integer',
 'Years to retain anonymised deletion audit records (legal compliance).',
 'system'),


('ai_narration_enabled',
 'true',
 'boolean',
 'Enable Lambda:ai-narration (EventBridge nightly). Uses Claude Sonnet 4.6 for provider analytics narration.',
 'system'),

('ai_narration_model',
 'claude-sonnet-4-20250514',
 'string',
 'Anthropic model ID for Lambda:ai-narration. Update here when model changes — no code deploy needed.',
 'system'),

('gemini_narration_enabled',
 'true',
 'boolean',
 'Enable Gemini GAAS (analytics narration) for admin-level cross-provider insights.',
 'system'),

('gaas_refresh_interval_hours',
 '24',
 'integer',
 'Hours between GAAS (Gemini Analytics as a Service) narration refreshes.',
 'system'),


('wa_channel_policy',
 'cac_and_extraordinary',
 'string',
 'WhatsApp usage policy. cac_and_extraordinary = cold acquisition + extraordinary events only. MASTER_CONTEXT Rule 17.',
 'system'),

('wa_max_daily_messages_per_user',
 '3',
 'integer',
 'Maximum WhatsApp messages per user per day (not counting OTP). Gupshup rate management.',
 'system')

ON CONFLICT (key) DO NOTHING;

-- ── Insert missing keys added in forensic audit ──
INSERT INTO system_config (key, value, data_type, description, updated_by) VALUES
('consumer_trust_signal_phone_verified',        '5',   'integer', 'Trust points for verified phone number', 'system'),
('consumer_trust_signal_profile_complete',      '5',   'integer', 'Trust points for complete profile', 'system'),
('consumer_trust_signal_ratings_given',         '5',   'integer', 'Trust points for giving ratings', 'system'),
('consumer_trust_signal_completed_interactions','5',   'integer', 'Trust points for completed contact events', 'system'),
('consumer_trust_signal_no_abuse',              '10',  'integer', 'Trust points for no abuse reports', 'system'),
('consumer_trust_signal_subscription',          '5',   'integer', 'Trust points for paid subscription', 'system'),
('consumer_trust_min_ratings_for_signal',       '3',   'integer', 'Minimum ratings given to earn signal points', 'system'),
('consumer_trust_min_events_for_signal',        '1',   'integer', 'Minimum completed events to earn signal points', 'system'),
('consumer_trust_abuse_window_days',            '90',  'integer', 'Days to look back for abuse detection', 'system'),
('rating_burst_threshold',                      '10',  'integer', 'Ratings in burst window that trigger flag', 'system'),
('rating_burst_window_minutes',                 '60',  'integer', 'Sliding window for burst detection (minutes)', 'system'),
('rating_held_weight',                          '0.5', 'float', 'Weight multiplier for ratings under moderation hold', 'system'),
('rating_same_provider_cooldown_days',          '30',  'integer', 'Days before consumer can rate same provider again', 'system'),
('rating_weight_open_community',                '0.5', 'float', 'Weight for open_community ratings (MASTER_CONTEXT)', 'system'),
('rating_weight_verified_contact',              '1.0', 'float', 'Weight for verified_contact ratings (MASTER_CONTEXT)', 'system'),
('rating_min_account_age_days',                 '7',   'integer', 'Minimum account age in days to submit open_community rating', 'system'),
('suggest_max_results',                         '10',  'integer', 'Maximum autocomplete suggestions returned', 'system'),
('suggest_min_chars',                           '2',   'integer', 'Minimum characters before suggest activates', 'system'),
('tsaas_consent_trust_pts',                     '5',   'integer', 'Trust points awarded when provider consents to TSaaS sharing', 'system')
ON CONFLICT (key) DO NOTHING;

-- ── Verification: confirm all 68 keys were inserted ──────────
DO $$
DECLARE
    key_count INT;
BEGIN
    SELECT COUNT(*) INTO key_count FROM system_config WHERE updated_by = 'system';
    RAISE NOTICE 'system_config seed complete. Rows with updated_by=system: %', key_count;
    -- Note: ON CONFLICT DO NOTHING means count may be < 68 if keys already existed.
    -- That is expected and correct behaviour.
END;
$$;

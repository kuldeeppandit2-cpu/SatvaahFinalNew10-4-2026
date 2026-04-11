-- Pre-populate migration tracking table.
-- All these migrations were already applied directly via docker exec psql.
-- This lets the migrate container exit 0 so all services can start.
CREATE TABLE IF NOT EXISTS _satvaaah_migrations (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO _satvaaah_migrations (name) VALUES
('V001_extensions'), ('V002_users'), ('V003_cities_areas'), ('V004_provider_profiles'), ('V005_consumer_profiles'), ('V006_trust_scores'), ('V007_trust_score_config'), ('V008_trust_score_history'), ('V009_contact_events'), ('V010_ratings'), ('V011_daily_rating_usage'), ('V012_search_intents'), ('V013_consumer_lead_usage'), ('V014_provider_lead_usage'), ('V015_subscriptions'), ('V016_saved_providers'), ('V017_taxonomy_nodes'), ('V018_opensearch_cdc'), ('V019_opensearch_sync_log'), ('V020_notification_log'), ('V021_in_app_messages'), ('V022_system_config'), ('V023_consent_records'), ('V024_tsaas'), ('V025_refresh_tokens'), ('V026_trust_flags'), ('V027_referral_events'), ('V028_scraping_tables'), ('V029_external_ratings'), ('V030_certificate_records'), ('V031_seed_system_config'), ('V032_admin_users'), ('V032_system_config_complete'), ('V033_provider_lead_status'), ('V034_provider_verifications'), ('V035_consumer_ratings'), ('V036_fix_subscription_tier_enum'), ('V037_users_schema_alignment'), ('V038_provider_profiles_alignment'), ('V039_ratings_enum_alignment'), ('V040_cities_areas_alignment'), ('V041_trust_scores_alignment'), ('V042_schema_alignment_batch2'), ('V043_subscriptions_alignment'), ('V044_final_column_alignment'), ('V045_certificate_id_seq'), ('V046_seed_taxonomy'), ('V047_seed_trust_config'), ('V048_taxonomy_enrichment'), ('V049_scraping_enrichment'), ('V050_schema_additions'), ('V051_align_consumer_lead_usage_fk')
ON CONFLICT (name) DO NOTHING;

SELECT COUNT(*) AS tracked_migrations FROM _satvaaah_migrations;

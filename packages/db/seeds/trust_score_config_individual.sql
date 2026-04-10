-- ============================================================
-- SEED: trust_score_config — listing_type: individual_service
-- File: packages/db/seeds/trust_score_config_individual_service.sql
--
-- Covers: plumber, electrician, maid, cook, driver, photographer,
--         barber, tailor, AC repair, carpenter, painter, etc.
--
-- Signal breakdown:
--   OTP Verified         20 pts  — phone verified via Firebase OTP
--   Geo Verified         20 pts  — confirmed within city service area
--   Aadhaar Verified     25 pts  — DigiLocker OAuth2 PKCE (bcrypt hash stored)
--   Credential Verified  15 pts  — portfolio/work samples reviewed by admin
--   Ratings Score        20 pts  — weighted average of consumer ratings
--   Response Rate        10 pts  — % of leads responded to within lead_expiry_hours
--   LinkedIn Verified     5 pts  — LinkedIn profile URL verified
--   Photo Uploaded        2 pts  — profile photo present in S3
--
--   raw_max_total       117 pts  (20+20+25+15+20+10+5+2)
--
-- display_score formula (from trust_scores table):
--   display_score = (verification_score × verification_weight)
--                 + (customer_voice_score × customer_voice_weight)
--   customer_voice_weight = f(rating_count) via customer_weight_curve
--
-- Admin-editable: trust_score_config is writable from admin portal (port 3009).
-- Nothing hardcoded in application code (MASTER_CONTEXT Rule 20).
-- ON CONFLICT DO NOTHING → safe to re-run (idempotent).
-- ============================================================

INSERT INTO trust_score_config
    (listing_type, signal_name, max_pts, raw_max_total, is_active, description)
VALUES

('individual_service', 'otp_verified',         20, 117, TRUE,
    'Phone verified via Firebase OTP at registration. Minimum signal for Basic tier (score >= trust_tier_basic_threshold=20).'),

('individual_service', 'geo_verified',          20, 117, TRUE,
    'Provider confirmed to be within the declared city service area via GPS verification flow.'),

('individual_service', 'aadhaar_verified',      25, 117, TRUE,
    'Identity verified via DigiLocker OAuth2 PKCE. Only bcrypt(digilocker_uid + salt) stored. Aadhaar number NEVER stored (Rule 1 & 2).'),

('individual_service', 'credential_verified',   15, 117, TRUE,
    'Work portfolio or professional samples reviewed and approved by admin. Category-specific (e.g. plumbing photos, electrical work).'),

('individual_service', 'ratings_score',         20, 117, TRUE,
    'Derived from weighted customer voice score. verified_contact=1.0, open_community=0.5, scraped_external=0.3. Scaled to max_pts.'),

('individual_service', 'response_rate',         10, 117, TRUE,
    'Percentage of received leads responded to (accept or decline) within lead_expiry_hours. Sampled over last 90 days.'),

('individual_service', 'linkedin_verified',      5, 117, TRUE,
    'LinkedIn public profile URL provided and verified as active. Optional signal for service providers.'),

('individual_service', 'photo_uploaded',         2, 117, TRUE,
    'Profile photo uploaded to S3 and approved. Minimum quality check at service layer.')

ON CONFLICT (listing_type, signal_name) DO NOTHING;

-- ── Verification query ────────────────────────────────────────
-- Run after seed to confirm:
-- SELECT signal_name, max_pts FROM trust_score_config
-- WHERE listing_type = 'individual_service' ORDER BY max_pts DESC;
-- SUM(max_pts) should = 117.

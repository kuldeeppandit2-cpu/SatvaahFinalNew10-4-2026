# SatvaahFinal — MASTER_CONTEXT.md
# Permanent project context. Read at the start of EVERY coding session.
# Version: 2.0 | April 2026 | All coherence corrections applied
# Source: User Journey v3 · Taxonomy Master v2 · Architecture v1 · GitHub Structure v1
# DO NOT EDIT unless architecture changes. All corrections from Coherence Review v1 applied.

---

## PROJECT
SatvAAh — trust layer for India's informal economy.
Not a marketplace. A trust infrastructure. Zero commission. Always.
Platform: satvaaah.com + SatvAAh mobile app
Launch city: Hyderabad, India
Repo: SatvaahFinal (private) | kuldeeppandit2-cpu
Tagline: Truth that travels.

## LEGAL ENTITY
SatvAAh Technologies (Partnership Firm)
Partners: Chaman Lal Pandit + Basanti Pandit (50:50)
Authorised Representative: Vatsala Pandit (irrevocable POA)
Address: F-126, Suncity, Sector 54, Golf Course Road, Gurgaon 122011
Email: vatsala@satvaaah.com
Governing law: India | Jurisdiction: Gurgaon, Haryana
Laws: IT Act 2000, DPDP Act 2023, Consumer Protection Act 2019, PSS Act 2007

---

## TECH STACK

Frontend:        React Native (Expo SDK 51), TypeScript, React Navigation v6
State mgmt:      Zustand — NOT Redux. Folder: stores/ (plural). Files: auth.store.ts etc.
Backend:         Node.js 18 + Express, TypeScript, 9 microservices
ORM:             Prisma — NOT Flyway. packages/db/prisma/schema.prisma is canonical.
Databases:       PostgreSQL 15, Redis 7, OpenSearch 2.x, MongoDB Atlas
Auth:            Firebase phone OTP → Firebase ID token → auth service verifies via Admin SDK
JWT:             RS256 asymmetric ONLY. Never HS256. Access: 24h. Refresh: 30d.
Payments:        Razorpay (UPI / Cards / Net Banking / Wallets / EMI)
Push:            Firebase FCM (all product events). WhatsApp via Gupshup (CAC + extraordinary only).
Identity:        DigiLocker OAuth2 PKCE (Aadhaar-linked)
Deep links:      Branch.io — NOT Firebase Dynamic Links (FDL deprecated August 2025)
AI:              Claude Sonnet 4.6 (Anthropic API) + Gemini (analytics narration GAAS)
Storage:         AWS S3 (photos, credentials, PDF certificates)
Queue:           AWS SQS (4 queues: trust-score-updates, certificate-generator, push-discovery, anonymisation)
Compute:         AWS Lambda (9 functions, TypeScript), AWS EventBridge (scheduled triggers)
Search:          AWS OpenSearch 2.x (geospatial provider search, satvaaah_providers index)
CDN:             AWS CloudFront + S3 (certificate verification pages, provider web profiles)
Monitoring:      AWS CloudWatch (SLOs, alarms), X-Correlation-ID distributed tracing
Build:           Turborepo monorepo, pnpm workspaces, GitHub Actions CI/CD
Admin portal:    Next.js 14 App Router (apps/admin-web/), port 3099 local, VPN-only in production

---

## 9 MICROSERVICES (exact ports and folder names)

services/auth/          port 3001   Firebase JWT verify, RS256 token issue, refresh, logout
services/user/          port 3002   provider_profiles, consumer_profiles, contact_events, in_app_messages,
                                    availability, credentials, geo-verify, referrals, saved_providers,
                                    WebSocket server (Socket.IO — 3 namespaces)
services/search/        port 3003   OpenSearch expanding ring search, taxonomy autocomplete,
                                    search intent capture, category browse
services/trust/         port 3004   Trust score calculation (4 entity types, dynamic model),
                                    TSaaS API, certificate trigger, trust history, consumer trust
services/rating/        port 3005   Rating moderation (10-step), daily limits, burst detection,
                                    consumer trust score, dispute flagging, rating eligibility
services/notification/  port 3006   FCM delivery, WhatsApp/Gupshup wrapper, notification log,
                                    delivery monitoring, FCM-to-WhatsApp fallback
services/payment/       port 3007   Razorpay orders and webhook, subscriptions, lead counter,
                                    referral rewards
services/admin/         port 3009   Analytics narration (GAAS), dispute review, scraping monitoring,
                                    city config, credential verification queue, OpenSearch resync
services/scraping/      port 3010   Python/Scrapy pre-launch scraping, NLP extraction,
                                    deduplication, WhatsApp outreach scheduling

CRITICAL: NO booking service. NO provider service as separate entity.
Contact events replace what other platforms call bookings.
Port 3008 does not exist.

---

## 9 LAMBDA FUNCTIONS (lambdas/ folder, TypeScript)

lambdas/trust-recalculate/      Trigger: SQS trust-score-updates. Recalculates after any signal change.
lambdas/certificate-generator/  Trigger: SQS when trust_tier first crosses highly_trusted.
                                 Generates PDF. Once per provider lifetime. Idempotency via certificate_records.
lambdas/push-discovery/         Trigger: SQS when provider.trust_score crosses push_discovery_trust_threshold.
                                 Matches against search_intents table. Sends FCM push.
lambdas/opensearch-sync/        Trigger: SQS CDC from PostgreSQL. Syncs provider_profiles to OpenSearch.
lambdas/outreach-scheduler/     Trigger: EventBridge every 15 min. Sends WhatsApp to scraped providers.
lambdas/delivery-monitor/       Trigger: EventBridge every 15 min. Detects undelivered FCM > 5min.
                                 Triggers WhatsApp fallback for leads + acceptances.
lambdas/anonymisation/          Trigger: SQS on account deletion. Anonymises within 72h. DPDP Act 2023.
lambdas/ai-narration/           Trigger: EventBridge nightly. Claude Sonnet analytics per provider.
lambdas/ratings-refresh/        Trigger: EventBridge daily. Refreshes scraped external ratings.

---

## DATABASE — 31 MIGRATIONS (Prisma format)

TOOL: Prisma migrate. Folder: packages/db/prisma/migrations/ (auto-generated)
CANONICAL SCHEMA: packages/db/prisma/schema.prisma — 32 models, 17 enums
DO NOT use Flyway or Liquibase.

V001  extensions:            uuid-ossp, postgis, pg_trgm, btree_gist, pgcrypto
V002  users:                 id UUID, phone, phone_verified, mode ENUM, subscription_tier,
                             fcm_token, wa_opted_out, deleted_at (soft delete, DPDP)
V003  cities + areas:        PostGIS boundary polygons for launch cities, area centroids
V004  provider_profiles:     listing_type ENUM, tab, geo_point (PostGIS), trust_score,
                             is_claimed, is_scrape_record, all verification boolean flags
V005  consumer_profiles:     user_id, trust_score INT DEFAULT 75, display_name, city_id
V006  trust_scores:          provider_id UNIQUE, display_score, raw_score,
                             verification_score, customer_voice_score, customer_voice_weight,
                             trust_tier ENUM
V007  trust_score_config:    listing_type, signal_name, max_pts, raw_max_total, is_active
                             ALL signal weights stored here. Nothing hardcoded. Admin-editable.
V008  trust_score_history:   IMMUTABLE. provider_id, event_type, delta_pts, new_display_score,
                             new_tier, event_at. Belongs to provider forever.
V009  contact_events:        consumer_id, provider_id, contact_type ENUM (call/message/slot_booking),
                             status, provider_status, consumer_lead_deducted, provider_phone_revealed
V010  ratings:               provider_id, consumer_id, contact_event_id NULLABLE (NULL=open_community),
                             overall_stars, weight_type, weight_value, moderation_status
V011  daily_rating_usage:    consumer_id, tab, date — UNIQUE constraint. Enforces daily tab limits.
V012  search_intents:        user_id, taxonomy_node_id, lat, lng, searched_at,
                             expiry_at (NULL=never), notified_at, user_dismissed_at
                             *** V012 EXISTS. It is NOT deleted. Never skip this migration. ***
V013  consumer_lead_usage:   consumer_id, subscription_plan_id, period_start, period_end,
                             leads_allocated, leads_used
V014  provider_lead_usage:   provider_id, month, leads_allocated, leads_received,
                             leads_accepted, leads_declined, leads_expired
V015  subscription_plans     plan_id, user_type, tier, price_paise, leads_allocated, features JSONB
      + subscription_records: user_id, plan_id, status, razorpay_order_id, idempotency_key
V016  saved_providers:       composite PK (consumer_id + provider_id)
V017  taxonomy_nodes:        1,597 rows seeded from Taxonomy Master v2.
                             l1/l2/l3/l4, attribute_schema JSONB, rating_dimensions JSONB,
                             search_intent_expiry_days (INT, NULL=never), verification_required,
                             home_visit BOOL
V018  OpenSearch CDC:        PostgreSQL trigger on provider_profiles → SQS → Lambda:opensearch-sync
V019  opensearch_sync_log:   provider_id, trigger_type, sync_status, synced_at, error_message
V020  notification_log:      user_id, channel ENUM (fcm/whatsapp), event_type, sent_at,
                             delivered_at, read_at, fcm_message_id, wa_message_id, wa_fallback_sent
V021  in_app_messages:       contact_event_id, sender_id, message_text, photo_url,
                             sent_at, delivered_at, read_at
V022  system_config:         key VARCHAR UNIQUE, value TEXT, description, updated_by, updated_at
                             68 admin-configurable keys. Seeded in V031.
V023  consent_records:       user_id, consent_type ENUM (dpdp_processing/aadhaar_hash/data_sharing_tsaas),
                             granted_at, withdrawn_at
V024  tsaas_api_keys         client_id, hashed_key, monthly_limit, calls_used, is_active
      + tsaas_usage_log:     client_id, provider_id, called_at, response_code
V025  refresh_tokens:        user_id, token_hash (bcrypt hash of JTI), device_id, expires_at
V026  trust_flags:           provider_id, rating_id, flag_type ENUM, severity ENUM,
                             status ENUM, evidence JSONB, resolution, resolved_at
V027  referral_events:       referrer_id, referred_id, referral_code, converted_at, reward_type, reward_granted
V028  scraping tables:       scraping_staging, scraping_jobs, outreach_schedule
V029  external_ratings:      provider_id, platform ENUM (google/zomato/practo/justdial/sulekha),
                             rating_avg, review_count, scraped_at, is_stale
V030  certificate_records:   provider_id UNIQUE (one per lifetime), certificate_id, issued_at,
                             valid_until, s3_key, verification_url
V031  seed_system_config:    INSERT all 68 system_config keys with default values

---

## LISTING TYPES (drives trust signals, profile form, search card, trust formula)

individual_service  — plumber, electrician, maid, cook, driver, photographer, barber, tailor
individual_product  — milkman, vegetable vendor, homemade products
expertise           — cardiologist, advocate, CA, architect, SEBI RIA, IRDAI agent (govt licence required)
establishment       — Ramu di Hatti, Sharma Mithai, Paradise Biryani (named entity with brand equity)
product_brand       — A-Z Milk, Fresh Squeeze Co (new FMCG brand building trust before recognition)

---

## TRUST SCORE MODEL

FORMULA:
  display_score = (verification_score × verification_weight) + (customer_voice_score × customer_voice_weight)
  customer_voice_weight = f(rating_count) via customer_weight_curve config key
  customer_weight_curve = 0:0.10, 3:0.20, 10:0.30, 50:0.65, 200:0.70
  customer_voice_max_weight = 0.70 (hard cap, admin-configurable)
  verification_weight = 1.0 − customer_voice_weight

All signal weights in trust_score_config table. Nothing hardcoded. Admin-editable without code deploy.

TRUST TIERS (CORRECTED — from Coherence Review):
  0–19:   Unverified   Grey #6B6560         Profile exists. No verified signals. Low search rank.
  20–39:  Basic        Saffron #C8691A       OTP verified. Searchable. Features limited.
  60–79:  Trusted      Lt Verdigris #6BA89E  Aadhaar or credential verified. Priority search.
  80–100: Highly Trusted Verdigris #2E7D72   Full verification + customer voice. Certificate eligible.

Config keys: trust_tier_basic_threshold=20 · trust_tier_trusted_threshold=60 · trust_tier_highly_trusted_threshold=80

CERTIFICATE OF VERIFICATION:
  Issues ONCE when score first crosses 80. Never re-issues. Idempotency via certificate_records.
  Expires if score below 80 for certificate_below_grace_days=30 consecutive days.
  ID format: SAT-{CITY}-{YEAR}-{5DIGIT_SEQ} e.g. SAT-HYD-2026-08412
  Stored: s3://satvaaah-documents/certificates/{city_id}/{provider_id}/{certId}.pdf
  Verification URL: satvaaah.com/verify/{certId} — public, no auth, CloudFront served

---

## RATING SYSTEM (3 weight tiers)

verified_contact   1.0  — linked to contact_event where status=accepted. Cannot be faked.
open_community     0.5  — OTP verified, account ≥7 days old, daily limits enforced
scraped_external   0.3  — Google/Zomato/Practo. Source always shown. Consumer cannot submit.
                          Stale after 90 days → weight halved to 0.15

Daily limits per consumer (from system_config, never hardcoded):
  Products:       10/day — contact event NOT required (may have bought before SatvAAh)
  Services:        5/day — contact event MANDATORY (cannot rate a plumber never hired)
  Expertise:       3/day — contact event MANDATORY
  Establishments:  8/day — contact event NOT required (may have visited years ago)

Rating bonus: consumer earns +2 leads for submitting a rating (rating_bonus_leads=2)
Rating expiry: prompt expires after 3 skips (rating_expiry_after_skips=3)

---

## BUSINESS MODEL — CONTACT EVENTS (not bookings)

Consumer contacts provider → contact_event created (type: call / message / slot_booking)
Provider accepts / declines lead on Leads screen
Lead counted against monthly quota ONLY on accept
Consumer phone revealed to provider on accept (reveal_consumer_phone_on_accept=true)
Provider phone always visible to consumer before contact (shown on profile)
Lead cost: contact_lead_cost=0 at launch (admin-configurable, never hardcoded)
Slot booking: Gold tier consumer only + provider must have published calendar (slot_booking contact type)
No-show: consumer reports → trust penalty → lead refunded → priority reroute offered

---

## API RESPONSE FORMAT (every single endpoint, no exceptions)

Success:  { "success": true,  "data": { ... } }
Error:    { "success": false, "error": { "code": "ERROR_CODE", "message": "User-facing message" } }
Paged:    { "success": true,  "data": [...], "meta": { "total", "page", "pages" } }
Rate 429: { "error": { "code": "...", "message": "...", "retry_after": 347 } }

All app endpoints: /api/v1/ prefix
TSaaS endpoints:  /api/v2/tsaas/ prefix (separate auth — X-TSaaS-API-Key header)

---

## KEY API ENDPOINTS

AUTH:
  POST /api/v1/auth/firebase/verify
    Request:  { firebaseIdToken: string, consent_given: boolean }
    consent_given REQUIRED. If false → 400 CONSENT_REQUIRED.
    First-time user + consent_given=true → atomically INSERT consent_record (dpdp_processing) + create user
    Response: { access_token, refresh_token, user_id, is_new_user }

  POST /api/v1/auth/token/refresh
  POST /api/v1/auth/logout
  POST /api/v1/auth/admin/verify   (admin only — email+password Firebase, separate from consumer auth)

USER (port 3002):
  POST   /api/v1/providers/register
  GET    /api/v1/providers/me
  PATCH  /api/v1/providers/me
  POST   /api/v1/providers/me/verify/geo
  GET    /api/v1/providers/me/verify/aadhaar     → returns {digilocker_redirect_url}
  POST   /api/v1/providers/me/verify/aadhaar/callback
  POST   /api/v1/providers/me/credentials
  GET    /api/v1/providers/me/leads
  PATCH  /api/v1/providers/me/leads/:id          → {action: 'accept'|'decline', decline_reason?}
  PUT    /api/v1/providers/me/availability
  PATCH  /api/v1/providers/me/settings
  POST   /api/v1/consumers/profile
  GET    /api/v1/consumers/me
  PATCH  /api/v1/users/me/mode
  DELETE /api/v1/users/me                        → soft delete + SQS anonymisation
  GET    /api/v1/users/me/data-export            → DPDP right to access
  DELETE /api/v1/users/me/consent/:type          → DPDP right to withdraw consent
  GET    /api/v1/messages/:event_id
  POST   /api/v1/messages
  GET    /api/v1/saved-providers
  POST   /api/v1/saved-providers
  DELETE /api/v1/saved-providers/:id
  POST   /api/v1/contact-events
  POST   /api/v1/contact-events/:id/no-show

SEARCH (port 3003):
  GET  /api/v1/search?q=&tab=&lat=&lng=&page=
  GET  /api/v1/search/suggest?q=&tab=
  POST /api/v1/search/intent                     → async, fails silently. Inserts search_intent row.
  GET  /api/v1/categories?tab=
  GET  /api/v1/providers/:id                     → public profile view
  GET  /api/v1/search/availability-changes?since=ISO

TRUST (port 3004):
  GET  /api/v1/trust/:id
  GET  /api/v1/trust/me
  GET  /api/v1/trust/:id/history
  POST /api/v1/trust/:id/recalculate             → X-Service-Key required
  GET  /api/v2/tsaas/trust/:providerId           → TSaaS B2B endpoint
  GET  /api/v2/tsaas/trust/lookup?phone=

RATING (port 3005):
  GET  /api/v1/ratings/eligibility/:providerId
  POST /api/v1/ratings
  POST /api/v1/ratings/:id/flag
  POST /api/v1/consumer-ratings
  GET  /api/v1/consumers/me/trust

NOTIFICATION (port 3006):
  GET   /api/v1/notifications
  PATCH /api/v1/notifications/:id/read

PAYMENT (port 3007):
  GET  /api/v1/subscriptions/plans?user_type=consumer|provider
  POST /api/v1/subscriptions/purchase
  POST /api/v1/payments/webhook/razorpay         → HMAC-SHA256 verify before processing
  POST /api/v1/referrals/apply

ADMIN (port 3009):
  GET  /api/v1/providers/me/analytics?period=30d
  GET  /api/v1/admin/disputes
  PATCH /api/v1/admin/disputes/:id
  + 10 admin portal modules (see Architecture Part 20)

---

## WEBSOCKET (Socket.IO on user :3002)

3 namespaces:
  /availability  — NO auth (public). Consumer joins room: city:{city_id}. Events: availability_updated
  /trust         — JWT required. Provider joins room: provider:{provider_id}. Events: trust_score_updated
  /messages      — JWT required. Both parties join room: conversation:{event_id}.
                   Events: message_received, message_read, typing_start, typing_stop

Reconnection: exponential backoff 1s→30s, infinite retries, REST catchup on reconnect
Redis adapter: required for horizontal scaling (multiple user :3002 instances)
connectionStateRecovery: replays missed events within 2 minute disconnect window

---

## DEEP LINKS (Branch.io)

IMPORTANT: Firebase Dynamic Links deprecated August 2025. Use Branch.io throughout.
Scheme: satvaaah://
Provider profile: satvaaah://provider/{id}
Referral join: satvaaah://join/{code} → satvaaah.com/join/{code} (web fallback)
Certificate verify: satvaaah.com/verify/{cert_id} (public web, no auth, CloudFront)
Branch.io handles: deferred deep linking, install attribution, referral code persistence
Update: hooks/useDeepLink.ts, utils/deepLink.utils.ts, app.json (scheme unchanged: satvaaah://)

---

## WHATSAPP — 16 PRE-APPROVED META TEMPLATES

Policy: wa_channel_policy=cac_and_extraordinary. NEVER for product notifications (FCM only).
WhatsApp for: cold acquisition outreach + extraordinary events (new lead, accepted contact, certificate).
All 16 must be submitted to Meta ≥3 weeks before launch.

Templates:
  1  otp_auth                   Authentication
  2  provider_welcome           Utility — launch day outreach attempt 1
  3  activation_reminder_48h    Utility — outreach attempt 2 (48h after attempt 1)
  4  new_contact_request        Utility — FCM fallback for new lead (provider)
  5  contact_accepted           Utility — FCM fallback for accepted lead (consumer)
  6  contact_declined           Utility
  7  rating_reminder_24h        Utility
  8  trust_score_updated        Utility
  9  aadhaar_verified           Utility
  10 credential_verified        Utility
  11 subscription_confirmed     Utility — subscription activation (extraordinary)
  12 subscription_expiry_7d     Marketing
  13 lead_limit_warning         Utility
  14 consumer_welcome           Utility
  15 certificate_ready          Utility — certificate issued (extraordinary)
  16 provider_final_reminder_7d Utility — outreach attempt 3 (7 days after attempt 1)

---

## SEARCH PARAMETERS (exact names — never change)

GET /api/v1/search
  q        — taxonomy node name or free text (resolved to node)
  tab      — products | services | expertise | establishments
  lat      — latitude (required)
  lng      — longitude (NOT 'lon' — consistent with PostGIS ST_MakePoint(lng, lat))
  page     — pagination
  min_trust — optional filter
  max_distance — optional km filter
  availability — optional filter
  home_visit — optional boolean

Ring expansion: 3km → 7km → 15km → 50km (city-wide) → 150km (cross-city, high-value only)
Never returns zero results. Narration banner explains each expansion step.

---

## CRITICAL RULES — NEVER BREAK

1.  NEVER store Aadhaar number — DB, logs, Redis, S3, anywhere, ever
2.  DigiLocker: store ONLY bcrypt(digilocker_uid + per_record_salt, cost=12) = 72 bytes. Irreversible.
3.  All amounts in PAISE (integer). Rs 1 = 100 paise. Never float. Never rupees in DB.
4.  providers.trust_score auto-updated by V018 DB trigger via SQS. NEVER write from app code.
5.  PostGIS: ST_MakePoint(lng, lat) — longitude FIRST, always
6.  All timestamps: TIMESTAMPTZ DEFAULT NOW(). Store UTC. Convert to Asia/Kolkata in app only.
7.  bcrypt cost 12 for all hashing (passwords, tokens, Aadhaar)
8.  Store bcrypt hash of JTI in refresh_tokens — never raw token
9.  Verify Razorpay webhook HMAC-SHA256 signature before processing any payment
10. Docker hosts: PostgreSQL=postgres, Redis=satvaaah-redis, MongoDB=mongodb, OpenSearch=opensearch
11. All services run inside Docker in local dev. Never npm start or npm run dev on Mac directly.
12. Env vars in docker-compose.yml environment: section. NOT .env file for local dev.
13. V012 = search_intents. EXISTS. Never delete. Never skip. Required for push discovery Lambda.
14. Prisma manages migrations. Do NOT use Flyway or Liquibase.
15. JWT: RS256 only. Never HS256. HS256 means any service can forge tokens.
16. Rate limiter: fail-open during Redis unavailability. Never fail-closed (would bring down API).
17. WhatsApp: NEVER for product notifications. FCM only. WhatsApp = CAC + extraordinary only.
18. Deep links: Branch.io only. Firebase Dynamic Links deprecated August 2025, do not use.
19. Admin portal users from admin_users table only. Phone users cannot escalate to admin.
20. Nothing hardcoded. All thresholds in system_config or trust_score_config table.
21. consent_given: boolean REQUIRED in POST /auth/firebase/verify. If false → 400 error.
22. trust_tier_basic_threshold = 20 (NOT 40). OTP-verified providers show as Basic immediately.
23. Prisma schema is canonical. If schema.prisma and a migration conflict → schema.prisma wins.
24. SQS messages retain for 14 days. DLQ for opensearch-sync. maxReceiveCount=3 before DLQ.
25. X-Correlation-ID header on every request. Log it. Pass it to every SQS message and Lambda.

---

## BRAND

App name: SatvAAh — capital S, capital A, capital A, lowercase h. No exceptions.
Saffron:        #C8691A
Deep Ink:       #1C1C2E
Ivory:          #FAF7F0
Verdigris:      #2E7D72
Light Verdigris: #6BA89E (Trusted tier ring)
Warm Sand:      #F0E4CC (search bar background)
Terracotta:     error/warning accent
Font: Plus Jakarta Sans (all weights)

---

## SHARED PACKAGES (packages/ folder)

packages/types/src/index.ts         — all shared TypeScript types and enums
packages/db/prisma/schema.prisma    — canonical 32-model Prisma schema
packages/db/src/client.ts           — Prisma client singleton
packages/db/src/index.ts            — re-exports client + all types
packages/middleware/src/requireAuth.ts    — RS256 JWT verify middleware
packages/middleware/src/rateLimiter.ts   — Redis-backed rate limiter factory
packages/middleware/src/correlationId.ts — X-Correlation-ID middleware
packages/middleware/src/errorHandler.ts  — global error handler
packages/middleware/src/asyncHandler.ts  — wraps async route handlers
packages/errors/src/index.ts        — all error classes with codes
packages/logger/src/index.ts        — Winston JSON logger (never log Aadhaar or passwords)
packages/config/src/systemConfig.ts — loadSystemConfig() reads system_config table, hot-reload on SIGHUP

---

## INFRASTRUCTURE SERVICES

PostgreSQL 15    AWS RDS Multi-AZ       Source of truth for all transactional data
OpenSearch 2.x   AWS OpenSearch         Geospatial provider search. CDC sync via Lambda.
Redis 7          AWS ElastiCache        Rate limiting, session cache, taxonomy cache (24h TTL)
S3               AWS S3                 Photos, credentials, PDF certificates, admin static
SQS              AWS SQS                4 queues + DLQs for resilience
Lambda (9)       AWS Lambda             Async workloads (TypeScript)
EventBridge      AWS EventBridge        Scheduled: outreach (15min), scraping (weekly), ratings (daily)
Firebase Auth    Google Firebase        Phone OTP → ID token → auth service verifies
Branch.io        Branch                 Deep links, deferred install attribution, referral tracking
Razorpay         Razorpay India         UPI / Cards / Net Banking / Wallets / EMI
CloudFront+S3    AWS                    Certificate public pages, provider web profiles
Socket.IO        Self-hosted user:3002  WebSocket real-time (3 namespaces)
MongoDB Atlas    Atlas M10              Raw scraping results (schema-flexible per source)
Gupshup          Gupshup India          WhatsApp BSP — 16 templates, Meta pre-approved

---
END OF MASTER_CONTEXT.md
Version 2.0 | April 2026 | SatvAAh Technologies | CONFIDENTIAL

/**
 * @package @satvaaah/types
 * Canonical TypeScript enums and DTOs for all 9 SatvAAh microservices.
 * Mirrors packages/db/prisma/schema.prisma — 17 enums, 32 models.
 * CRITICAL RULES:
 *   - Never add Aadhaar numbers to any type
 *   - All monetary amounts are PAISE (integer), never rupees or floats
 *   - All timestamps are ISO strings (UTC); convert to Asia/Kolkata in app only
 *   - RS256 JWT only — never HS256
 */

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — ENUMS (17 total, matching Prisma schema)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enum 1: UserMode
 * A user may operate as a provider, a consumer, or both simultaneously.
 */
export enum UserMode {
  PROVIDER = 'provider',
  CONSUMER = 'consumer',
  BOTH = 'both',
}

/**
 * Enum 2: ListingType
 * Drives trust signals, profile form fields, search card display, and trust formula.
 */
export enum ListingType {
  INDIVIDUAL_SERVICE = 'individual_service', // plumber, electrician, maid, cook, driver…
  INDIVIDUAL_PRODUCT = 'individual_product', // milkman, vegetable vendor, homemade products
  EXPERTISE = 'expertise',                   // cardiologist, advocate, CA, architect (govt licence required)
  ESTABLISHMENT = 'establishment',           // Ramu di Hatti, Paradise Biryani (named entity)
  PRODUCT_BRAND = 'product_brand',           // A-Z Milk, Fresh Squeeze Co (new FMCG brand)
}

/**
 * Enum 3: Tab
 * Maps 1-to-1 with the four SatvAAh discovery tabs.
 * Consistent with GET /api/v1/search?tab= parameter.
 */
export enum Tab {
  PRODUCTS = 'products',
  SERVICES = 'services',
  EXPERTISE = 'expertise',
  ESTABLISHMENTS = 'establishments',
}

/**
 * Enum 4: TrustTier
 * CORRECTED thresholds (Coherence Review v1):
 *   unverified   0–19   grey  #6B6560
 *   basic        20–39  saffron #C8691A  (OTP verified)
 *   trusted      60–79  lt-verdigris #6BA89E (Aadhaar or credential)
 *   highly_trusted 80–100 verdigris #2E7D72 (full + customer voice → certificate eligible)
 */
export enum TrustTier {
  UNVERIFIED = 'unverified',
  BASIC = 'basic',
  TRUSTED = 'trusted',
  HIGHLY_TRUSTED = 'highly_trusted',
}

/**
 * Enum 5: ContactType
 * How a consumer initiates contact with a provider.
 * slot_booking requires Gold-tier consumer + provider published calendar.
 */
export enum ContactType {
  CALL = 'call',
  MESSAGE = 'message',
  SLOT_BOOKING = 'slot_booking',
}

/**
 * Enum 6: ContactStatus
 * Lifecycle of a contact_event from consumer side.
 */
export enum ContactStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
  COMPLETED = 'completed',   // contact concluded normally
  NO_SHOW = 'no_show',       // consumer reported provider no-show
  CANCELLED = 'cancelled',   // consumer cancelled before provider responded (V009 migration value)
}

/**
 * Enum 7: ProviderContactStatus
 * Separate provider-side status for the same contact event.
 * Used in contact_events.provider_status column.
 */
export enum ProviderContactStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
}

/**
 * Enum 8: RatingWeightType
 * Three-tier rating weight system.
 */
export enum RatingWeightType {
  VERIFIED_CONTACT = 'verified_contact', // weight=1.0 — linked to accepted contact_event
  OPEN_COMMUNITY = 'open_community',     // weight=0.5 — OTP verified, account ≥7 days, daily limits
  SCRAPED_EXTERNAL = 'scraped_external', // weight=0.3 (0.15 if stale >90 days) — never consumer-submitted
}

/**
 * Enum 9: RatingModerationStatus
 * 10-step moderation pipeline (services/rating/).
 */
export enum RatingModerationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  FLAGGED = 'flagged',
}

/**
 * Enum 10: SubscriptionTier
 * Consumer and provider subscription tiers.
 * Gold tier required for slot_booking contact type.
 */
export enum SubscriptionTier {
  FREE = 'free',
  SILVER = 'silver',
  GOLD = 'gold',
}

/**
 * Enum 11: ConsentType
 * DPDP Act 2023 consent categories stored in consent_records.
 */
export enum ConsentType {
  DPDP_PROCESSING = 'dpdp_processing',   // mandatory; if false → 400 CONSENT_REQUIRED
  AADHAAR_HASH = 'aadhaar_hash',         // for DigiLocker Aadhaar verification
  DATA_SHARING_TSAAS = 'data_sharing_tsaas', // for Trust Score as a Service B2B API
}

/**
 * Enum 12: NotificationChannel
 * Delivery channel for notification_log.
 * RULE: WhatsApp = CAC + extraordinary only. NEVER product notifications.
 */
export enum NotificationChannel {
  FCM = 'fcm',
  WHATSAPP = 'whatsapp',
}

/**
 * Enum 13: TrustFlagType
 * Types of anomalous signals detected in ratings/trust pipeline.
 */
export enum TrustFlagType {
  RATING_MANIPULATION = 'rating_manipulation',
  FAKE_ACCOUNT = 'fake_account',
  IMPERSONATION = 'impersonation',
  SPAM = 'spam',
  NO_SHOW_PATTERN = 'no_show_pattern',
  CREDENTIAL_FRAUD = 'credential_fraud',
  POLICY_VIOLATION = 'policy_violation',
}

/**
 * Enum 14: TrustFlagSeverity
 */
export enum TrustFlagSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Enum 15: TrustFlagStatus
 * Lifecycle of a trust_flag record in the admin dispute queue.
 */
export enum TrustFlagStatus {
  OPEN = 'open',
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

/**
 * Enum 16: OpenSearchSyncStatus
 * Status of each CDC sync attempt in opensearch_sync_log.
 */
export enum OpenSearchSyncStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  RETRYING = 'retrying',
}

/**
 * Enum 17: ExternalRatingPlatform
 * Scraped external rating sources (ratings-refresh Lambda, every 90 days).
 */
export enum ExternalRatingPlatform {
  GOOGLE = 'google',
  ZOMATO = 'zomato',
  PRACTO = 'practo',
  JUSTDIAL = 'justdial',
  SULEKHA = 'sulekha',
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — CORE ENTITY TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw JWT payload fields as issued by authService.ts
 * Field names are snake_case as issued. requireAuth.ts maps these to camelCase on req.user.
 */
export interface JwtPayload {
  sub: string;                    // user.id (UUID)
  iss: string;                    // 'satvaaah-auth'
  iat: number;
  exp: number;
  jti: string;                    // UUID — bcrypt hash stored in DB, never raw token
  mode: string;                   // 'consumer' | 'provider' | 'both' (lowercase from DB)
  subscription_tier: string;      // 'free' | 'silver' | 'gold' (lowercase from DB)
  phone_verified: boolean;
  role?: 'admin';                 // only present in admin JWT
}

/** Admin JWT additionally carries role and email */
export interface AdminJwtPayload extends JwtPayload {
  role: 'admin';
  email: string;                  // admin email (sub is the admin_users.id)
}

/**
 * Mapped user object attached to req.user by requireAuth middleware.
 * Field names are camelCase for TypeScript ergonomics.
 */
export interface AuthenticatedUser {
  userId: string;                 // mapped from JWT.sub
  mode: UserMode;
  subscriptionTier: SubscriptionTier;
  phoneVerified: boolean;
  role?: 'admin';
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — API RESPONSE ENVELOPE (every endpoint, no exceptions)
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export interface ApiPaged<T = unknown> {
  success: true;
  data: T[];
  meta: {
    total: number;
    page: number;
    pages: number;
  };
}

export interface RateLimitErrorResponse {
  error: {
    code: string;
    message: string;
    retry_after: number; // seconds
  };
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — AUTH SERVICE DTOs (port 3001)
// ─────────────────────────────────────────────────────────────────────────────

/** POST /api/v1/auth/firebase/verify */
export interface FirebaseVerifyRequest {
  firebaseIdToken: string;
  consent_given: boolean; // REQUIRED — if false → 400 CONSENT_REQUIRED
  device_id?: string;
  fcm_token?: string;
}

export interface FirebaseVerifyResponse {
  access_token: string;
  refresh_token: string;
  user_id: string;
  is_new_user: boolean;
}

/** POST /api/v1/auth/token/refresh */
export interface TokenRefreshRequest {
  refresh_token: string;
}

export interface TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
}

/** POST /api/v1/auth/logout */
export interface LogoutRequest {
  refresh_token: string;
}

/** POST /api/v1/auth/admin/verify (email+password Firebase — separate from consumer auth) */
export interface AdminVerifyRequest {
  firebaseIdToken: string; // email+password Firebase token
}

export interface AdminVerifyResponse {
  access_token: string;
  admin_id: string;
  email: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — USER SERVICE DTOs (port 3002)
// ─────────────────────────────────────────────────────────────────────────────

/** POST /api/v1/providers/register */
export interface RegisterProviderRequest {
  display_name: string;
  listing_type: ListingType;
  tab: Tab;
  city_id: string;
  area_id?: string;
  phone: string;       // masked in logs — never full number in log output
  bio?: string;
  home_visit?: boolean;
  latitude?: number;   // ST_MakePoint(lng, lat) — lng first in PostGIS
  longitude?: number;
}

/** GET /api/v1/providers/me — response shape */
export interface ProviderProfileResponse {
  id: string;
  display_name: string;
  listing_type: ListingType;
  tab: Tab;
  city_id: string;
  area_id?: string;
  bio?: string;
  home_visit: boolean;
  trust_score: number;
  trust_tier: TrustTier;
  is_claimed: boolean;
  phone_verified: boolean;
  aadhaar_verified: boolean;
  geo_verified: boolean;
  credential_verified: boolean;
  subscription_tier: SubscriptionTier;
  leads_remaining?: number;
  created_at: string;
  updated_at: string;
}

/** PATCH /api/v1/providers/me */
export interface UpdateProviderRequest {
  display_name?: string;
  bio?: string;
  home_visit?: boolean;
  area_id?: string;
  latitude?: number;
  longitude?: number;
  fcm_token?: string;
}

/** POST /api/v1/providers/me/verify/geo */
export interface GeoVerifyRequest {
  latitude: number;
  longitude: number;
}

/** POST /api/v1/providers/me/credentials */
export interface AddCredentialRequest {
  credential_type: string;       // matches taxonomy_node verification_required types
  credential_number?: string;    // masked/hashed where needed — NEVER Aadhaar number
  issuer?: string;
  issued_at?: string;
  expires_at?: string;
  s3_document_key?: string;      // pre-uploaded to S3
}

/** GET /api/v1/providers/me/leads */
export interface LeadListResponse {
  leads: LeadItem[];
  meta: { total: number; page: number; pages: number };
}

export interface LeadItem {
  id: string;
  consumer_id: string;
  consumer_name?: string;
  contact_type: ContactType;
  status: ContactStatus;
  provider_status: ProviderContactStatus;
  created_at: string;
  expires_at?: string;
}

/** PATCH /api/v1/providers/me/leads/:id */
export interface UpdateLeadRequest {
  action: 'accept' | 'decline';
  decline_reason?: string;
}

/** PUT /api/v1/providers/me/availability */
export interface UpdateAvailabilityRequest {
  is_available: boolean;
  available_from?: string; // ISO datetime
  available_until?: string;
  calendar_slots?: CalendarSlot[];
}

export interface CalendarSlot {
  day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sunday
  start_time: string; // HH:MM
  end_time: string;
}

/** PATCH /api/v1/providers/me/settings */
export interface UpdateProviderSettingsRequest {
  wa_opted_out?: boolean;
  fcm_token?: string;
}

/** POST /api/v1/consumers/profile */
export interface CreateConsumerProfileRequest {
  display_name: string;
  city_id: string;
}

/** GET /api/v1/consumers/me */
export interface ConsumerProfileResponse {
  id: string;
  user_id: string;
  display_name: string;
  city_id: string;
  trust_score: number;
  subscription_tier: SubscriptionTier;
  leads_remaining: number;
  created_at: string;
}

/** PATCH /api/v1/users/me/mode */
export interface UpdateUserModeRequest {
  mode: UserMode;
}

/** POST /api/v1/contact-events */
export interface CreateContactEventRequest {
  provider_id: string;
  contact_type: ContactType;
  message?: string;
  preferred_slot_id?: string; // required if contact_type = slot_booking
}

export interface ContactEventResponse {
  id: string;
  provider_id: string;
  consumer_id: string;
  contact_type: ContactType;
  status: ContactStatus;
  provider_status: ProviderContactStatus;
  consumer_lead_deducted: boolean;
  provider_phone_revealed: boolean;
  created_at: string;
}

/** POST /api/v1/contact-events/:id/no-show */
export interface NoShowRequest {
  reason?: string;
}

/** GET /api/v1/messages/:event_id + POST /api/v1/messages */
export interface InAppMessage {
  id: string;
  contact_event_id: string;
  sender_id: string;
  message_text: string;
  photo_url?: string;
  sent_at: string;
  delivered_at?: string;
  read_at?: string;
}

export interface SendMessageRequest {
  contact_event_id: string;
  message_text: string;
  photo_url?: string;
}

/** POST /api/v1/saved-providers */
export interface SaveProviderRequest {
  provider_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — SEARCH SERVICE DTOs (port 3003)
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/v1/search — parameter names are exact; never change */
export interface SearchQueryParams {
  q?: string;             // taxonomy node name or free text resolved to node
  tab: Tab;
  lat: number;
  lng: number;            // NOT 'lon' — consistent with ST_MakePoint(lng, lat)
  page?: number;
  min_trust?: number;
  max_distance?: number;  // km
  availability?: boolean;
  home_visit?: boolean;
}

export interface SearchResultItem {
  id: string;
  display_name: string;
  listing_type: ListingType;
  tab: Tab;
  trust_score: number;
  trust_tier: TrustTier;
  distance_km: number;
  is_available: boolean;
  home_visit: boolean;
  city_id: string;
  area_name?: string;
  taxonomy_node?: string;
  rating_count: number;
  rating_avg?: number;
}

export interface SearchResponse {
  success: true;
  data: SearchResultItem[];
  meta: {
    total: number;
    page: number;
    pages: number;
    ring_km: number;       // which ring was used: 3 | 7 | 15 | 50 | 150
    narration?: string;    // explains ring expansion if triggered
  };
}

/** GET /api/v1/search/suggest */
export interface SearchSuggestParams {
  q: string;
  tab?: Tab;
}

export interface SearchSuggestItem {
  taxonomy_node_id: string;
  label: string;
  tab: Tab;
  l1?: string;
  l2?: string;
  l3?: string;
}

/** POST /api/v1/search/intent — async, fails silently */
export interface SearchIntentRequest {
  taxonomy_node_id: string;
  lat: number;
  lng: number;
}

/** GET /api/v1/categories */
export interface CategoryBrowseParams {
  tab: Tab;
}

export interface TaxonomyNode {
  id: string;
  l1: string;
  l2?: string;
  l3?: string;
  l4?: string;
  tab: Tab;
  listing_type?: ListingType;
  home_visit: boolean;
  verification_required: boolean;
  search_intent_expiry_days?: number; // null = never
  attribute_schema?: Record<string, unknown>;
  rating_dimensions?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — TRUST SERVICE DTOs (port 3004)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrustScoreResponse {
  provider_id: string;
  display_score: number;
  raw_score: number;
  verification_score: number;
  customer_voice_score: number;
  customer_voice_weight: number;
  trust_tier: TrustTier;
  certificate_issued: boolean;
  certificate_id?: string;
  last_updated_at: string;
}

export interface TrustHistoryItem {
  id: string;
  provider_id: string;
  event_type: string;
  delta_pts: number;
  new_display_score: number;
  new_tier: TrustTier;
  event_at: string;
}

/** GET /api/v2/tsaas/trust/:providerId — TSaaS B2B endpoint */
export interface TsaasTrustResponse {
  provider_id: string;
  display_score: number;
  trust_tier: TrustTier;
  certificate_id?: string;
  queried_at: string;
}

/** GET /api/v2/tsaas/trust/lookup?phone= */
export interface TsaasTrustLookupParams {
  phone: string; // E.164 — never logged in full
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — RATING SERVICE DTOs (port 3005)
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/v1/ratings/eligibility/:providerId */
export interface RatingEligibilityResponse {
  eligible: boolean;
  reason?: string;
  contact_event_required: boolean;
  daily_limit: number;
  daily_used: number;
}

/** POST /api/v1/ratings */
export interface CreateRatingRequest {
  provider_id: string;
  contact_event_id?: string; // null = open_community rating
  overall_stars: 1 | 2 | 3 | 4 | 5;
  dimensions?: Record<string, number>; // per taxonomy_node rating_dimensions
  comment?: string;
}

export interface RatingResponse {
  id: string;
  provider_id: string;
  consumer_id: string;
  contact_event_id?: string;
  overall_stars: number;
  weight_type: RatingWeightType;
  weight_value: number;
  moderation_status: RatingModerationStatus;
  created_at: string;
}

/** POST /api/v1/ratings/:id/flag */
export interface FlagRatingRequest {
  reason: string;
  evidence?: string;
}

/** POST /api/v1/consumer-ratings */
export interface CreateConsumerRatingRequest {
  consumer_id: string;
  overall_stars: 1 | 2 | 3 | 4 | 5;
  note?: string;
  contact_event_id: string; // required — provider rates consumer after accepted lead
}

/** GET /api/v1/consumers/me/trust */
export interface ConsumerTrustResponse {
  consumer_id: string;
  trust_score: number;
  rating_count: number;
  no_show_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — NOTIFICATION SERVICE DTOs (port 3006)
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  user_id: string;
  channel: NotificationChannel;
  event_type: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sent_at: string;
  delivered_at?: string;
  read_at?: string;
  fcm_message_id?: string;
  wa_message_id?: string;
  wa_fallback_sent: boolean;
}

export interface GetNotificationsQuery {
  page?: number;
  unread_only?: boolean;
}

export interface MarkNotificationReadResponse {
  id: string;
  read_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10 — PAYMENT SERVICE DTOs (port 3007)
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/v1/subscriptions/plans */
export interface GetPlansQuery {
  user_type: 'consumer' | 'provider';
}

export interface SubscriptionPlan {
  plan_id: string;
  user_type: 'consumer' | 'provider';
  tier: SubscriptionTier;
  price_paise: number;      // PAISE (integer). Rs 1 = 100 paise. NEVER float.
  leads_allocated: number;
  features: Record<string, unknown>;
  display_name: string;
}

/** POST /api/v1/subscriptions/purchase */
export interface PurchaseSubscriptionRequest {
  plan_id: string;
  idempotency_key: string; // client-generated UUID
}

export interface PurchaseSubscriptionResponse {
  subscription_record_id: string;
  razorpay_order_id: string;
  amount_paise: number;    // PAISE
  currency: 'INR';
}

/** POST /api/v1/payments/webhook/razorpay */
export interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment?: { entity: Record<string, unknown> };
    subscription?: { entity: Record<string, unknown> };
    order?: { entity: Record<string, unknown> };
  };
  created_at: number;
}

/** POST /api/v1/referrals/apply */
export interface ApplyReferralRequest {
  referral_code: string;
}

export interface ApplyReferralResponse {
  reward_type: string;
  reward_value: number; // PAISE if monetary
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11 — ADMIN SERVICE DTOs (port 3009)
// ─────────────────────────────────────────────────────────────────────────────

export interface DisputeItem {
  id: string;
  flag_type: TrustFlagType;
  severity: TrustFlagSeverity;
  status: TrustFlagStatus;
  provider_id: string;
  rating_id?: string;
  evidence?: Record<string, unknown>;
  resolution?: string;
  created_at: string;
  resolved_at?: string;
}

export interface UpdateDisputeRequest {
  status: TrustFlagStatus;
  resolution?: string;
}

export interface ProviderAnalyticsResponse {
  provider_id: string;
  period: string;
  lead_count: number;
  accept_rate: number;
  rating_avg?: number;
  trust_score_delta: number;
  narration?: string; // Claude Sonnet AI narration (GAAS)
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12 — WEBSOCKET EVENT PAYLOADS (Socket.IO, user :3002)
// ─────────────────────────────────────────────────────────────────────────────

/** /availability namespace — NO auth, public. Room: city:{city_id} */
export interface AvailabilityUpdatedEvent {
  provider_id: string;
  is_available: boolean;
  city_id: string;
  updated_at: string;
}

/** /trust namespace — JWT required. Room: provider:{provider_id} */
export interface TrustScoreUpdatedEvent {
  provider_id: string;
  new_display_score: number;
  new_tier: TrustTier;
  delta_pts: number;
  event_type: string;
}

/** /messages namespace — JWT required. Room: conversation:{event_id} */
export interface MessageReceivedEvent {
  message: InAppMessage;
}

export interface MessageReadEvent {
  message_id: string;
  read_at: string;
}

export interface TypingEvent {
  sender_id: string;
  event_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13 — SQS MESSAGE TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Base SQS message — always include correlation_id (critical rule #25) */
export interface SqsBaseMessage {
  correlation_id: string;
  timestamp: string;
}

export interface TrustScoreUpdateMessage extends SqsBaseMessage {
  provider_id: string;
  event_type: string;
  triggered_by?: string;
}

export interface CertificateGenerateMessage extends SqsBaseMessage {
  provider_id: string;
  trust_score: number;
  city_id: string;
}

export interface PushDiscoveryMessage extends SqsBaseMessage {
  provider_id: string;
  trust_score: number;
  taxonomy_node_id?: string;
  city_id: string;
}

export interface AnonymisationMessage extends SqsBaseMessage {
  user_id: string;
  requested_at: string; // must complete within 72h — DPDP Act 2023
}

export interface OpenSearchSyncMessage extends SqsBaseMessage {
  provider_id: string;
  operation: 'upsert' | 'delete';
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14 — DPDP / CONSENT DTOs
// ─────────────────────────────────────────────────────────────────────────────

/** DELETE /api/v1/users/me/consent/:type — DPDP right to withdraw */
export interface WithdrawConsentRequest {
  consent_type: ConsentType;
}

/** GET /api/v1/users/me/data-export — DPDP right to access */
export interface DataExportResponse {
  user_id: string;
  export_url: string;   // S3 pre-signed URL, expires in 24h
  requested_at: string;
  available_until: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15 — SYSTEM CONFIG KEY TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Typed keys for system_config table (68 keys seeded in V031).
 * All thresholds MUST come from system_config — nothing hardcoded.
 */
export type SystemConfigKey =
  // Trust thresholds
  | 'trust_tier_basic_threshold'          // = 20
  | 'trust_tier_trusted_threshold'        // = 60
  | 'trust_tier_highly_trusted_threshold' // = 80
  | 'push_discovery_trust_threshold'      // = 80
  // Certificate
  | 'certificate_below_grace_days'        // = 30
  // Rating limits per tab
  | 'rating_daily_limit_products'         // = 10 (V031 key name)
  | 'rating_daily_limit_services'         // = 5  (V031 key name)
  | 'rating_daily_limit_expertise'        // = 3  (V031 key name)
  | 'rating_daily_limit_establishments'   // = 8  (V031 key name)
  // Rating config
  | 'rating_bonus_leads'                  // = 2
  | 'rating_expiry_after_skips'           // = 3
  | 'scraped_external_stale_days'         // = 90 (V031 key: scraped_external_stale_days)
  | 'scraped_external_stale_weight'       // = 0.15 (V031 key: scraped_external_stale_weight)
  | 'scraped_external_weight'             // = 0.3 base weight
  // Lead / contact
  | 'contact_lead_cost'                   // = 0 at launch
  | 'reveal_consumer_phone_on_accept'     // = true
  | 'lead_expiry_hours'
  // Customer voice curve
  | 'customer_weight_curve'               // JSON: "0:0.10,3:0.20,10:0.30,50:0.65,200:0.70"
  | 'customer_voice_max_weight'           // = 0.70
  // WhatsApp channel policy
  | 'wa_channel_policy'                   // = cac_and_extraordinary
  // Search ring distances (km)
  | 'search_ring_1_km'   // = 3
  | 'search_ring_2_km'   // = 7
  | 'search_ring_3_km'   // = 15
  | 'search_ring_4_km'   // = 50
  | 'search_ring_5_km'   // = 150
  | 'search_ring_6_km'   // = 1000 (pan-India, rare specialists)
  // Referral
  | 'referral_reward_leads'
  | 'referral_code_expiry_days'
  // TSaaS
  | 'tsaas_default_monthly_limit'
  | string; // additional admin-editable keys

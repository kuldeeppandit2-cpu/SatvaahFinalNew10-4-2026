/**
 * SatvAAh — apps/mobile/src/api/provider.api.ts
 * Phase 22 — Provider Onboarding API layer
 * All calls return { success, data } — error throws with message from API
 */

import { apiClient } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ListingType =
  | 'individual_service'
  | 'individual_product'
  | 'expertise'
  | 'establishment'
  | 'product_brand';

export type TrustTier = 'unverified' | 'basic' | 'trusted' | 'highly_trusted';

export type ProviderTab = 'products' | 'services' | 'expertise' | 'establishments';

export interface City {
  id: string;
  name: string;
  state: string;
  isActive: boolean;
  lat: number;
  lng: number;
}

export interface TaxonomyNode {
  id: string;
  name: string;
  l1: string;
  l2: string | null;
  l3: string | null;
  l4: string | null;
  tab: ProviderTab;
  parentId: string | null;
  homeVisit: boolean;
  verificationRequired: boolean;
  attribute_schema: Record<string, unknown> | null;
  ratingDimensions: Record<string, unknown> | null;
  search_intent_expiry_days: number | null;
  // Visual — from taxonomy_nodes.icon_emoji + hex_color (V048)
  icon: string | null;
  color: string | null;
}

export interface ScrapedProfile {
  id: string;
  displayName: string;
  phone: string;
  category: string;
  sub_category: string | null;
  city: string;
  area: string;
  listingType: ListingType;
  photo_url: string | null;
  external_ratings: ExternalRating[];
  isClaimed: boolean;
}

export interface ExternalRating {
  platform: 'google' | 'zomato' | 'practo' | 'justdial' | 'sulekha';
  rating_avg: number;
  review_count: number;
  scraped_at: string;
}

export interface RegisterProviderPayload {
  listingType:    ListingType;
  tab:            ProviderTab;
  taxonomyNodeId: string;
  displayName:    string;
  cityId:         string;
  areaName:       string;
  areaLat?:       number;
  areaLng?:       number;
}

export interface ProviderProfile {
  id: string;
  userId: string;
  listingType: ListingType;
  displayName: string;
  cityId: string;
  cityName: string;
  areaName: string;
  trustScore: number;
  trustTier: TrustTier;
  isClaimed: boolean;
  is_scrape_record: boolean;
  geo_verified: boolean;
  phone: string;
  photo_url: string | null;
  taxonomy_node_id: string;
  category_name: string;
}

export interface GeoVerifyPayload {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface GeoVerifyResult {
  providerId: string;
  // Trust score updated asynchronously via SQS → Lambda
}

export interface NearbySearchIntent {
  id: string;
  category: string;
  area: string;
  search_count: number;       // aggregated from search_intents table
  window_minutes: number;     // e.g. 10
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const providerApi = {

  /**
   * Get all active cities for the city picker in Step 2.
   */
  async getActiveCities(): Promise<City[]> {
    const res = await apiClient.get('/api/v1/cities?active=true');
    if (!res.data.success) throw new Error(res.data.error?.message ?? 'Failed to load cities');
    return res.data.data as City[];
  },

  /**
   * Check if a scraped profile exists for this phone number (Path A — Claim).
   * Returns null if no scraped profile found.
   */
  async getScrapedProfileByPhone(phone: string): Promise<ScrapedProfile | null> {
    try {
      // Scraping service not yet implemented — returns null until live
      return null;
    } catch {
      return null;
    }
  },

  /**
   * Path A — Claim a scraped profile.
   * Sets is_claimed = true, trust_score starts at 20 (Basic).
   */
  async claimProfile(scraped_id: string): Promise<ProviderProfile> {
    const res = await apiClient.post(`/api/v1/providers/${scraped_id}/claim`);
    if (!res.data.success) throw new Error(res.data.error?.message ?? 'Claim failed');
    return res.data.data as ProviderProfile;
  },

  /**
   * Path B — Create a brand new provider profile.
   * After success: trust_score = 20 (Basic), profile is live.
   * POST /api/v1/providers/register
   */
  async registerProvider(payload: RegisterProviderPayload): Promise<ProviderProfile> {
    const res = await apiClient.post('/api/v1/providers/register', payload);
    if (!res.data.success) throw new Error(res.data.error?.message ?? 'Registration failed');
    return res.data.data as ProviderProfile;
  },

  /**
   * Update provider display name / area — used for incremental saves.
   * PATCH /api/v1/providers/me
   */
  async updateProvider(
    payload: Partial<RegisterProviderPayload>
  ): Promise<ProviderProfile> {
    const res = await apiClient.patch('/api/v1/providers/me', payload);
    if (!res.data.success) throw new Error(res.data.error?.message ?? 'Update failed');
    return res.data.data as ProviderProfile;
  },

  /**
   * Geo verification — GPS pin drag confirm.
   * Adds +20 to trust_score. Accuracy must be ≤ 50m.
   * POST /api/v1/providers/me/verify/geo
   * NOTE: ST_MakePoint(lng, lat) — backend handles ordering. We send lat/lng as named fields.
   */
  async verifyGeo(payload: GeoVerifyPayload): Promise<GeoVerifyResult> {
    const res = await apiClient.post('/api/v1/providers/me/verify/geo', payload);
    if (!res.data.success) throw new Error(res.data.error?.message ?? 'Geo verification failed');
    return res.data.data as GeoVerifyResult;
  },

  /**
   * Fetch L1 categories for a tab.
   * GET /api/v1/categories?tab=services
   */
  async getCategories(tab: ProviderTab): Promise<TaxonomyNode[]> {
    const res = await apiClient.get(`/api/v1/categories?tab=${tab}`);
    if (!res.data.success) throw new Error(res.data.error?.message ?? 'Failed to load categories');
    const d = res.data.data;
    if (d?.groups) {
      return (d.groups as any[]).map((g: any) => ({
        id: g.children?.[0]?.id ?? g.l1,
        name: g.l1, l1: g.l1, l2: null, l3: null, l4: null,
        tab, parentId: null, homeVisit: false, verificationRequired: false,
        attribute_schema: null, ratingDimensions: null, search_intent_expiry_days: null,
        icon:  g.icon  ?? null,   // emoji from taxonomy_nodes.icon_emoji (L1_ICONS map)
        color: g.color ?? null,   // hex from taxonomy_nodes.hex_color
      }));
    }
    return d as TaxonomyNode[];
  },

  async getSubCategories(parentId: string): Promise<TaxonomyNode[]> {
    return [];
  },

  /**
   * Fetch nearby search intents — real demand signal shown after profile goes live.
   * Shows "6 people searched for plumbers near Banjara Hills in last 10 min"
   * GET /api/v1/search/intents/nearby?lat=&lng=&tab=
   */
  async getNearbySearchIntents(
    lat: number,
    lng: number,
    tab?: ProviderTab
  ): Promise<NearbySearchIntent[]> {
    try {
      const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
      if (tab) params.set('tab', tab);
      const res = await apiClient.get(`/api/v1/search/intents/nearby?${params.toString()}`);
      if (!res.data.success) return [];
      return res.data.data as NearbySearchIntent[] ?? [];
    } catch {
      return []; // Non-critical — fail silently
    }
  },

  /**
   * Fetch own profile — used after claim/register to hydrate store.
   * GET /api/v1/providers/me
   */
  async getMe(): Promise<ProviderProfile> {
    const res = await apiClient.get('/api/v1/providers/me');
    if (!res.data.success) throw new Error(res.data.error?.message ?? 'Failed to load profile');
    return res.data.data as ProviderProfile;
  },
};


// ─── Phase 23 additions ─────────────────────────────────────────────────────
// getProviderDashboard, getTrustMe, getLeads, updateLead
// updateAvailability, getAvailabilitySchedule, saveAvailabilitySchedule


// ─── Types ────────────────────────────────────────────────────────────────────
// Note: TrustTier and ListingType are exported above — no re-declaration needed.

type AvailabilityStatus = 'available_now' | 'by_appointment' | 'unavailable';
type AvailabilityMode   = 'simple' | 'schedule';

// Server Availability enum: available | busy | away | offline
// Mobile uses: available_now | by_appointment | unavailable
const AVAILABILITY_TO_SERVER: Record<AvailabilityStatus, string> = {
  available_now:  'available',
  by_appointment: 'busy',
  unavailable:    'offline',
};
const SERVER_TO_AVAILABILITY: Record<string, AvailabilityStatus> = {
  available: 'available_now',
  busy:      'by_appointment',
  away:      'by_appointment',
  offline:   'unavailable',
};
type ContactType        = 'call' | 'message' | 'slot_booking';
type LeadStatus         = 'pending' | 'accepted' | 'declined' | 'expired';
type LeadAction         = 'accept' | 'decline' | 'defer';

export interface DashboardData {
  providerId:                   string;
  displayName:                  string;
  trustScore:                   number;
  trustTier:                    TrustTier;
  customerVoiceWeight:         number;   // 0.0–0.70
  customerVoiceRatingCount:   number;
  monthsSinceJoin:             number;
  initialScore:                 number;   // always 20
  momentum: {
    deltaPtsWeek: number;
    items: { signal: string; delta: number }[];
  } | null;
  nextAction: {
    signalName:      string;
    ptsAvailable:    number;
    wouldUnlockTier: string | null;
    screen:           string;
  } | null;
  earningsThisYearPaise:    number;   // paise — divide by 100 for Rs
  competitorCommissionRate:  number;   // e.g. 0.25
  availabilityStatus:         AvailabilityStatus;
  subscriptionTier:           string;   // free|silver|gold
}

export interface Lead {
  id:             string;
  contactType:   ContactType;
  status:         LeadStatus;
  consumer: {
    trustTier:   TrustTier;
    trustScore:  number;
    displayName: string;  // "Priya S." — first name + last initial from API
  };
  createdAt:      string;  // ISO
  expiresAt:      string;  // ISO — 48h after created_at
  message_preview?: string;
  area_hint?:      string;  // non-PII area name
}

export interface LeadsResponse {
  data:          Lead[];
  meta:          { total: number; page: number; pages: number };
  monthly_usage: {
    allocated: number;
    received:  number;
    accepted:  number;
    declined:  number;
  };
}

export interface LeadQueryParams {
  status?: string;
  page?:   number;
  limit?:  number;
  sort_by?: string;
  contactType?: string;
  consumer_tier?: string;
  period?: string;
}

export interface UpdateLeadPayload {
  action:          LeadAction;
  declineReason?: string;  // Required when action=decline
}

export interface AvailabilityPayload {
  status:       AvailabilityStatus;
  mode?:        AvailabilityMode;
  dnd_enabled?: boolean;
}

export interface SchedulePayload extends AvailabilityPayload {
  schedule: Record<string, number[]>;  // Day → sorted slot indices
}

export interface AvailabilityScheduleResponse {
  isAvailable: boolean;
  availabilityMode: AvailabilityMode;
  // schedule: not yet in schema
  schedule?:   Record<string, number[]>;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/providers/me/analytics?period=dashboard
 * Returns aggregated dashboard data including trust, momentum, next action,
 * zero commission counter, and availability status.
 * Service: admin:3009 (analytics) + trust:3004 merged by API gateway.
 */
export async function getProviderDashboard(): Promise<DashboardData> {
  const resp = await apiClient.get<{ success: true; data: DashboardData }>(
    '/api/v1/providers/me/analytics?period=dashboard',
  );
  return resp.data.data;
}

/**
 * GET /api/v1/trust/me
 * Direct trust score read from trust service (port 3004).
 * Used for WS catch-up on reconnect.
 */
export async function getTrustMe(): Promise<{
  displayScore:  number;
  trustTier:     TrustTier;
  raw_score:      number;
  verification_score:    number;
  customer_voice_score:  number;
  customerVoiceWeight: number;
}> {
  const resp = await apiClient.get('/api/v1/trust/me');
  return resp.data.data;
}

// ─── Leads ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/providers/me/leads
 * Returns paginated lead list + monthly_usage aggregate.
 * status, sort_by, contact_type, consumer_tier, period passed as query params.
 */
export async function getLeads(params: LeadQueryParams): Promise<LeadsResponse> {
  const query = new URLSearchParams();
  if (params.status)         query.set('status',         params.status);
  if (params.page)           query.set('page',           String(params.page));
  if (params.limit)          query.set('limit',          String(params.limit));
  if (params.sort_by)        query.set('sort_by',        params.sort_by);
  if (params.contactType)   query.set('contact_type',   params.contactType);
  if (params.consumer_tier)  query.set('consumer_tier',  params.consumer_tier);
  if (params.period)         query.set('period',         params.period);

  const resp = await apiClient.get<{ success: true } & LeadsResponse>(
    `/api/v1/providers/me/leads?${query.toString()}`,
  );
  return {
    data:          resp.data.data,
    meta:          resp.data.meta,
    monthly_usage: resp.data.monthly_usage,
  };
}

/**
 * PATCH /api/v1/providers/me/leads/:id
 * Body: { action: 'accept' | 'decline' | 'defer', decline_reason? }
 *
 * accept  → status=accepted, provider_phone_revealed to consumer, lead counted.
 * decline → status=declined, decline_reason stored for analytics (not shown to consumer).
 * defer   → status stays pending, expiry extended by system_config defer_hours (default 24h).
 *
 * RULE: Lead counted against monthly quota ONLY on accept (MASTER_CONTEXT).
 */
export async function updateLead(
  leadId:  string,
  payload: UpdateLeadPayload,
): Promise<Lead> {
  const resp = await apiClient.patch<{ success: true; data: Lead }>(
    `/api/v1/providers/me/leads/${leadId}`,
    payload,
  );
  return resp.data.data;
}

// ─── Availability ─────────────────────────────────────────────────────────────

/**
 * PUT /api/v1/providers/me/availability
 * Updates availability status and/or DND setting.
 * Server broadcasts event to /availability WS namespace → consumer sees within 1s.
 *
 * Simple mode: { status, mode: 'simple', dnd_enabled }
 * Schedule mode: { status, mode: 'schedule', schedule, dnd_enabled }
 */
export async function updateAvailability(
  payload: AvailabilityPayload,
): Promise<void> {
  const serverPayload = {
    ...payload,
    status: AVAILABILITY_TO_SERVER[payload.status] ?? 'available',
  };
  await apiClient.put('/api/v1/providers/me/availability', serverPayload);
}

/**
 * GET /api/v1/providers/me/availability
 * Returns current availability config including schedule (if set).
 */
export async function getAvailabilitySchedule(): Promise<AvailabilityScheduleResponse> {
  const resp = await apiClient.get<{ success: true; data: AvailabilityScheduleResponse }>(
    '/api/v1/providers/me/availability',
  );
  const data = resp.data.data;
  if (data.status) {
    data.status = (SERVER_TO_AVAILABILITY[data.status] ?? 'available_now') as any;
  }
  return data;
}

/**
 * PUT /api/v1/providers/me/availability (schedule payload)
 * Saves full weekly schedule. Convenience wrapper over updateAvailability.
 */
export async function saveAvailabilitySchedule(
  payload: SchedulePayload,
): Promise<void> {
  const serverPayload = {
    ...payload,
    status: AVAILABILITY_TO_SERVER[payload.status] ?? 'available',
  };
  await apiClient.put('/api/v1/providers/me/availability', serverPayload);
}

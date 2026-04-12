/**
 * apps/mobile/src/api/search.api.ts
 * SatvAAh Phase 18 — Consumer Search API
 *
 * Covers:
 *   GET  /api/v1/search                        — ring-expansion provider search
 *   GET  /api/v1/search/suggest                — taxonomy autocomplete (≥2 chars, max 8)
 *   POST /api/v1/search/intent                 — fire-and-forget (V012 search_intents)
 *   GET  /api/v1/categories                    — category grid per tab
 *   GET  /api/v1/providers/:id                 — public provider profile
 *   GET  /api/v1/search/availability-changes   — REST catchup on WS reconnect
 *
 * CRITICAL RULES (from MASTER_CONTEXT):
 *   • lng NOT lon — PostGIS ST_MakePoint(lng, lat) — longitude always first
 *   • storeSearchIntent is void — silently drops errors, never throws to UI
 *   • Tab values match backend enum exactly: products | services | expertise | establishments
 *   • Trust tiers: unverified=Grey, basic=Saffron, trusted=Lt.Verdigris, highly_trusted=Verdigris
 */

import { apiClient } from './client';

// ─── Enums & Core Types ────────────────────────────────────────────────────────

/** Surface tabs — match backend provider_profiles.tab enum exactly */
export type Tab = 'products' | 'services' | 'expertise' | 'establishments';

/** Trust tier enum — matches Prisma schema trust_tier */
export type TrustTier = 'unverified' | 'basic' | 'trusted' | 'highly_trusted';

/** Sort order for search results */
export type SortOrder = 'trust_score' | 'distance' | 'rating';

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

/**
 * Taxonomy node from V017 (1,597 rows seeded from Taxonomy Master v2).
 * Returned by /search/suggest — used for taxonomy-constrained search only.
 */
export interface TaxonomyNode {
  id: string;
  name: string;
  l1: string;
  l2?: string | null;
  l3?: string | null;
  l4?: string | null;
  tab: Tab;
  homeVisit: boolean;
  search_intent_expiry_days: number | null; // NULL = intent never expires
  verification_required: boolean;
}

/** Suggestion result — same shape as TaxonomyNode */
export type SearchSuggestion = TaxonomyNode;

// ─── Search Params ─────────────────────────────────────────────────────────────

/**
 * Full search query params for GET /api/v1/search.
 *
 * NOTE: lng not lon — consistent with PostGIS ST_MakePoint(lng, lat).
 * Pagination is 10 results per page. Default sort: trust_score DESC.
 */
export interface SearchParams {
  q: string;
  tab: Tab;
  lat: number;
  lng: number;            // longitude FIRST — PostGIS convention
  page?: number;          // 1-based, default 1
  ring_km?: number;       // locked ring for page > 1 pagination
  min_trust?: number;     // filter: minimum trust_score (0–100)
  max_distance?: number;  // filter: max km radius override
  availability?: boolean; // filter: show only available-now providers
  homeVisit?: boolean;    // filter: show only home-visit providers
  sort?: SortOrder;       // default: trust_score
  languages?: string;     // comma-separated BCP-47 e.g. "en-IN,te-IN,hi-IN"
  min_rating?: number;    // filter: min rating_avg (1.0–5.0)
  // Taxonomy anchor — set by CategoryBrowseScreen (S1) and SearchScreen (S2 post-select)
  taxonomy_node_id?: string;   // L4 UUID — primary relevance constraint
  taxonomy_l4?: string;        // L4 label
  taxonomy_l3?: string;        // L3 label
  taxonomy_l2?: string;        // L2 label
  taxonomy_l1?: string;        // L1 label
}

// ─── Search Response ──────────────────────────────────────────────────────────

/** Provider card returned in search results list */
export interface ProviderCardData {
  id: string;
  displayName: string;
  listingType: string;
  tab: Tab;
  taxonomy_node_id: string;
  taxonomy_name: string;          // human-readable category
  trustScore: number;            // 0–100
  trustTier: TrustTier;
  distance_km: number;
  profile_photo_url: string | null;
  is_available: boolean;
  homeVisit: boolean;
  cityId: string;
  areaName: string;
  rating_avg: number | null;
  rating_count: number;
  languages: string[];            // BCP-47 codes
  is_saved: boolean;              // consumer has saved this provider
  certificate_id: string | null;  // non-null → Highly Trusted, shows verified badge
  isScrapeRecord: boolean;        // true → unverified scraped provider, show Unverified path
}

/**
 * Pagination + ring metadata on search response.
 *
 * ring_km reflects actual ring used: 3 → 7 → 15 → 50 → 150 → 1000.
 * narration is set by the search service for ring expansion or taxonomy fallback.
 * taxonomy_level_used: 'l4'|'l3'|'l2'|'l1'|null — which taxonomy level produced results.
 */
export interface SearchMeta {
  total: number;
  page: number;
  has_more: boolean;
  ring_km: number;
  ring_label: string;
  narration: string | null;
  taxonomy_level_used: string | null;
}

export interface SearchResponse {
  success: true;
  data: ProviderCardData[];
  meta: SearchMeta;
}

// ─── Search Intent ─────────────────────────────────────────────────────────────

/**
 * Body for POST /api/v1/search/intent.
 * Inserts into search_intents table (V012 migration).
 * push-discovery Lambda reads this table to target FCM push notifications
 * when a matching provider's trust_score crosses push_discovery_trust_threshold.
 */
export interface SearchIntentPayload {
  taxonomy_node_id: string;
  lat: number;
  lng: number;
}

// ─── Categories ───────────────────────────────────────────────────────────────

export interface L2Group { l2: string; icon: string; child_count: number; }
export interface L4Leaf { id: string; l4: string; serviceType: string; pricingModel: string | null; priceUnit: string | null; verificationLabel: string; locationLabel: string; slotLabel: string; }
export interface L3Group { l3: string; icon: string; leaves: L4Leaf[]; }

export interface Category {
  id: string;
  name: string;
  l1: string;
  icon: string;
  color: string;
  icon_url: string | null;
  provider_count: number;
}

// ─── Availability Changes ─────────────────────────────────────────────────────

export interface AvailabilityChange {
  providerId: string;
  is_available: boolean;
  cityId: string;
  updatedAt: string; // ISO 8601 UTC
}

// ─── Rising Brands ────────────────────────────────────────────────────────────

/** Rising brand entry for HomeScreen Products tab */
export interface RisingBrand {
  id: string;
  displayName: string;
  profile_photo_url: string | null;
  trustScore: number;
  trustTier: TrustTier;
  taxonomy_name: string;
  areaName: string;
  score_delta_30d: number; // trust score gain in last 30 days
}

// ─── API Functions ─────────────────────────────────────────────────────────────

/**
 * Taxonomy-constrained autocomplete.
 * Min 2 chars — enforced here and at caller.
 * Returns max 8 taxonomy nodes (sliced if server returns more).
 *
 * GET /api/v1/search/suggest?q=&tab=
 */
export async function getSearchSuggestions(
  q: string,
  tab: Tab,
): Promise<SearchSuggestion[]> {
  if (q.trim().length < 2) return [];
  const { data } = await apiClient.get<{ success: true; data: SearchSuggestion[] }>(
    '/api/v1/search/suggest',
    { params: { q: q.trim(), tab } },
  );
  // Hard-cap at 8 — server enforces too but double-guard on mobile
  return (data.data ?? []).slice(0, 8);
}

/**
 * Ring-expansion provider search.
 * Rings: 3km → 7km → 15km → 50km → 150km.
 * Never returns zero results.
 * Default sort: trust_score DESC.
 * Pagination: 10 results per page.
 *
 * GET /api/v1/search?q=&tab=&lat=&lng=&page=&...
 */
export async function searchProviders(
  params: SearchParams,
): Promise<SearchResponse> {
  const { data } = await apiClient.get<any>('/api/v1/search', {
    params: {
      sort: 'trust_score',
      page: 1,
      ...params,
    },
  });
  const inner = data?.data ?? {};
  return {
    success: true,
    data: (inner.results ?? []).map((h: any) => ({
      id:                h.providerId,
      displayName:       h.displayName,
      listingType:       h.listingType ?? h.listing_type ?? '',
      tab:               h.tab,
      taxonomy_node_id:  h.category_id ?? '',
      taxonomy_name:     h.taxonomy_name ?? h.category ?? '',
      trustScore:        h.trustScore ?? h.trust_score ?? 0,
      trustTier:         h.trustTier ?? h.trust_tier ?? 'basic',
      distance_km:       h.distance_km ?? 0,
      profile_photo_url: h.profile_photo_url ?? h.profilePhotoS3Key ?? null,
      is_available:      h.isAvailable ?? h.is_available ?? false,
      homeVisit:         h.homeVisit ?? h.home_visit_available ?? false,
      cityId:            h.cityId ?? h.city_id ?? '',
      areaName:          h.areaName ?? h.area ?? '',
      rating_avg:        h.rating_avg ?? h.avg_rating ?? null,
      rating_count:      h.rating_count ?? h.reviewCount ?? 0,
      languages:         h.languages ?? [],
      is_saved:          h.is_saved ?? false,
      certificate_id:    h.certificate_id ?? null,
      isScrapeRecord:    h.isScrapeRecord ?? h.is_scrape_record ?? false,
    })),
    meta: {
      total:                inner.total ?? 0,
      page:                 inner.page ?? 1,
      has_more:             inner.has_more ?? false,
      ring_km:              inner.ring_km ?? 0,
      ring_label:           inner.ring_label ?? '',
      narration:            inner.narration ?? null,
      taxonomy_level_used:  inner.taxonomy_level_used ?? null,
    },
  };
}

/**
 * Store search intent — FIRE AND FORGET.
 *
 * Returns void. NEVER await this. NEVER surface errors to UI.
 * Silently drops all errors (network, server, validation).
 * Inserts row into search_intents (V012 migration).
 * Used by push-discovery Lambda to match providers when trust
 * crosses push_discovery_trust_threshold.
 *
 * POST /api/v1/search/intent
 */
export function storeSearchIntent(payload: SearchIntentPayload): void {
  apiClient.post('/api/v1/search/intent', payload).catch(() => {
    // Intentionally empty — spec: "async, fails silently, never shows error to user"
  });
}

/**
 * Category grid data per tab.
 * Ordered by provider_count DESC.
 *
 * GET /api/v1/categories?tab=
 */
export async function getCategories(tab: Tab): Promise<Category[]> {
  const { data } = await apiClient.get<{
    success: true;
    data: { tab: string; groups: Array<{ l1: string; icon: string; color: string; children: Array<any> }> };
  }>('/api/v1/categories', { params: { tab } });
  const groups = data.data?.groups ?? [];
  return groups.map((g: any) => ({
    id:             g.l1,
    name:           g.l1,
    l1:             g.l1,
    icon:           g.icon ?? '📦',
    color:          g.color ?? '#6B6560',
    icon_url:       null,
    provider_count: g.children?.length ?? 0,
  }));
}

export async function getCategoriesL2(tab: Tab, l1: string): Promise<L2Group[]> {
  const { data } = await apiClient.get<{
    success: true; data: { tab: string; l1: string; groups: L2Group[] };
  }>('/api/v1/categories/l2', { params: { tab, l1 } });
  return data.data?.groups ?? [];
}

export async function getCategoriesL3(tab: Tab, l1: string, l2: string): Promise<L3Group[]> {
  const { data } = await apiClient.get<{
    success: true; data: { tab: string; l1: string; l2: string; groups: L3Group[] };
  }>('/api/v1/categories/l3', { params: { tab, l1, l2 } });
  return data.data?.groups ?? [];
}


export async function getProviderProfile(id: string): Promise<ProviderCardData> {
  const { data } = await apiClient.get<{ success: true; data: ProviderCardData }>(
    `/api/v1/providers/${id}`,
  );
  return data.data;
}

/**
 * REST catchup after WebSocket /availability reconnect.
 * Fetch all availability changes since last known timestamp,
 * then apply to cached result list.
 *
 * GET /api/v1/search/availability-changes?since=ISO
 */
export async function getAvailabilityChanges(
  since: string,
): Promise<AvailabilityChange[]> {
  const { data } = await apiClient.get<{ success: true; data: AvailabilityChange[] }>(
    '/api/v1/search/availability-changes',
    { params: { since } },
  );
  return (data.data as any) ?? [];
}


/**
 * Rising brands for HomeScreen Products tab.
 * Wraps search with listing_type=product_brand&sort=rising.
 *
 * GET /api/v1/search?tab=products&listing_type=product_brand&sort=rising&page=1
 */
// getRisingBrands: not yet implemented server-side

// ─── Presentation Helpers ─────────────────────────────────────────────────────

/**
 * Map trust_tier to brand ring colour.
 *
 * Thresholds (from system_config):
 *   unverified:     0–19   → Grey   #6B6560
 *   basic:         20–59   → Saffron #C8691A
 *   trusted:       60–79   → Light Verdigris #6BA89E
 *   highly_trusted: 80–100 → Verdigris #2E7D72
 */
export function trustRingColor(tier: TrustTier): string {
  switch (tier) {
    case 'highly_trusted': return '#2E7D72';
    case 'trusted':        return '#6BA89E';
    case 'basic':          return '#C8691A';
    case 'unverified':
    default:               return '#6B6560';
  }
}

/** Human-readable tier label (used for accessibility) */
export function trustTierLabel(tier: TrustTier): string {
  switch (tier) {
    case 'highly_trusted': return 'Highly Trusted';
    case 'trusted':        return 'Trusted';
    case 'basic':          return 'Basic';
    case 'unverified':
    default:               return 'Unverified';
  }
}

/**
 * Lead counter pill colour for consumer HomeScreen.
 *   > 10  → Saffron  #C8691A
 *   1–10  → Amber    #D97706
 *   0     → Terracotta #C4502A
 */
export function leadPillColor(remaining: number): string {
  if (remaining > 10) return '#C8691A';  // Saffron
  if (remaining > 0)  return '#D97706';  // Amber
  return '#C4502A';                       // Terracotta
}

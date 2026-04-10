// services/search/src/services/expandingRingSearch.ts
//
// Expanding ring search for SatvAAh.
//
// Strategy:
//   Start with the smallest ring (3 km). If zero results are found for the
//   requested page, expand to the next ring. Keep expanding until results are
//   found OR all rings are exhausted.
//
//   NEVER returns zero results — the outermost ring (150 km) returns any active
//   provider in that band, prioritising is_claimed=true and listing_type=premium.
//
// Ring definitions:
//   3km   → hyperlocal (default start)
//   7km   → local neighbourhood
//   15km  → city district
//   50km  → city-wide
//   150km → cross-city (high-value only: is_claimed=true AND listing_type=premium)
//
// Parameter notes:
//   • API accepts `lat` and `lng`  (NOT lon — matches ST_MakePoint(lng,lat) convention)
//   • OpenSearch geo_distance query uses `lon` internally for the coordinate object
//   • We translate at the boundary — `lng` → `lon` when building the OS query body

import { getOpenSearchClient, OPENSEARCH_INDEX } from '../lib/opensearchClient';
import { logger } from '@satvaaah/logger';
import { getConfigInt } from '@satvaaah/config';

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAGE_SIZE = 20;

// Tabs accepted by the search endpoint
const VALID_TABS = ['products', 'services', 'expertise', 'establishments'] as const;
export type SearchTab = (typeof VALID_TABS)[number];

// Ring ladder: expand from smallest to largest
interface RingDef {
  radiusKm: number;
  label: string;
  /** At 150 km we only surface high-value providers (is_claimed + premium) */
  crossCityOnly?: boolean;
}

// Ring distances loaded from system_config (Rule #20 — nothing hardcoded)
// system_config keys: search_ring_1_km..5_km (fallback to MASTER_CONTEXT defaults)
export const DEFAULT_RINGS: RingDef[] = [
  { radiusKm: 3,   label: '3 km' },
  { radiusKm: 7,   label: '7 km' },
  { radiusKm: 15,  label: '15 km' },
  { radiusKm: 50,  label: '50 km' },
  { radiusKm: 150, label: '150 km', crossCityOnly: true },
];

function getRings(): RingDef[] {
  // Load per-ring distances from system_config; fall back to defaults
  try {
    const r1 = getConfigInt('search_ring_1_km', 3);
    const r2 = getConfigInt('search_ring_2_km', 7);
    const r3 = getConfigInt('search_ring_3_km', 15);
    const r4 = getConfigInt('search_ring_4_km', 50);
    const r5 = getConfigInt('search_ring_5_km', 150);
    return [
      { radiusKm: r1, label: `${r1} km` },
      { radiusKm: r2, label: `${r2} km` },
      { radiusKm: r3, label: `${r3} km` },
      { radiusKm: r4, label: `${r4} km` },
      { radiusKm: r5, label: `${r5} km`, crossCityOnly: true },
    ];
  } catch {
    // system_config not loaded yet — use defaults
    return DEFAULT_RINGS;
  }
}

// RINGS is computed fresh on each call to pick up SIGHUP hot-reload changes
function RINGS(): RingDef[] { return getRings(); }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RingSearchInput {
  q?: string;
  tab?: string;
  lat: number;
  lng: number;
  page: number;
  /** Locked ring radius (km) for pages > 1 — supplied by client from page-1 response */
  ringKm?: number;
  locationName?: string;
  correlationId: string;
}

export interface ProviderHit {
  providerId: string;
  displayName: string;
  category_id: string;
  tab: string;
  cityId: string;
  geo_point: { lat: number; lon: number };
  trustScore: number;
  trustTier: string;
  isAvailable: boolean;
  availabilityMode: string;
  isActive: boolean;
  isClaimed: boolean;
  listingType: string;
  profilePhotoS3Key: string | null;
  tagline: string | null;
  years_of_experience: number | null;
  reviewCount: number;
  avg_rating: number | null;
}

export interface RingSearchResult {
  results: ProviderHit[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
  ring_km: number;
  ring_label: string;
  narration: string;
  expanded: boolean;
}

// ─── buildOsQuery ─────────────────────────────────────────────────────────────

/**
 * Build the OpenSearch query body for a given ring.
 * `lng` is the API parameter name; `lon` is what OpenSearch expects internally.
 */
function buildOsQuery(
  input: RingSearchInput,
  ring: RingDef,
  from: number,
): object {
  const { q, tab, lat, lng } = input;

  // Base must clauses
  const mustClauses: object[] = [];

  // Full-text on display_name + taxonomy_l4 when query term is provided
  if (q && q.trim().length > 0) {
    mustClauses.push({
      multi_match: {
        query: q.trim(),
        fields: ['display_name^2', 'taxonomy_l4', 'taxonomy_name'],
        type: 'best_fields',
        fuzziness: 'AUTO',
        prefix_length: 2,
      },
    });
  } else {
    // No query term → match_all (all providers in the geo ring)
    mustClauses.push({ match_all: {} });
  }

  // Filter clauses — always applied
  const filterClauses: object[] = [
    { term: { is_active: true } },
    {
      geo_distance: {
        distance: `${ring.radiusKm}km`,
        // `lng` (our API param) → `lon` (OpenSearch geo_point field key)
        geo_point: { lat, lon: lng },
      },
    },
  ];

  // Tab filter (optional — if provided and valid)
  if (tab && VALID_TABS.includes(tab as SearchTab)) {
    filterClauses.push({ term: { tab } });
  }

  // 150 km cross-city ring: claimed providers only
  // 'premium' is NOT a valid ListingType — using is_claimed=true only
  if (ring.crossCityOnly) {
    filterClauses.push({ term: { is_claimed: true } });
  }

  return {
    from,
    size: PAGE_SIZE,
    query: {
      bool: {
        must: mustClauses,
        filter: filterClauses,
      },
    },
    sort: [
      { trust_score: { order: 'desc' } },
      // Secondary sort: distance (nearest first within same trust score band)
      {
        _geo_distance: {
          geo_point: { lat, lon: lng },
          order: 'asc',
          unit: 'km',
          distance_type: 'arc',
        },
      },
    ],
    // Return distance in response metadata
    script_fields: {},
    _source: [
      'provider_id',
      'display_name',
      'category_id',
      'tab',
      'city_id',
      'geo_point',
      'trust_score',
      'trust_tier',
      'is_available',
      'availability_mode',
      'is_active',
      'is_claimed',
      'listing_type',
      'profile_photo_s3_key',
      'tagline',
      'years_of_experience',
      'review_count',
      'avg_rating',
    ],
  };
}

// ─── buildNarration ───────────────────────────────────────────────────────────

function buildNarration(
  total: number,
  ring: RingDef,
  locationName: string,
  tab: string | undefined,
  q: string | undefined,
): string {
  // Entity label: use query term if provided, else the tab label
  const entityLabel =
    q && q.trim().length > 0
      ? q.trim().toLowerCase()
      : tab
        ? tab.toLowerCase()
        : 'providers';

  if (total === 0) {
    return `No ${entityLabel} found within ${ring.label} of ${locationName}.`;
  }

  const countLabel = total > 999 ? '999+' : `${total}`;

  if (ring.crossCityOnly) {
    return `Found ${countLabel} verified ${entityLabel} within ${ring.label} of ${locationName} (premium listings only).`;
  }

  return `Found ${countLabel} ${entityLabel} within ${ring.label} of ${locationName}.`;
}

// ─── expandingRingSearch ──────────────────────────────────────────────────────

/**
 * Executes an expanding ring search.
 *
 * Algorithm:
 *  1. If `ringKm` is provided (page > 1), lock to that ring and paginate.
 *  2. Otherwise start at 3 km and expand until results are found.
 *  3. Always return results — even if the outermost ring has none, return
 *     the response with total=0 (should never happen in production with data).
 */
export async function expandingRingSearch(
  input: RingSearchInput,
): Promise<RingSearchResult> {
  const { page, ringKm, locationName = 'your location', correlationId } = input;
  const from = (page - 1) * PAGE_SIZE;
  const osClient = getOpenSearchClient();

  // ── Locked ring mode (page > 1 from client) ──────────────────────────────
  if (ringKm !== undefined) {
    const lockedRing = RINGS().find((r) => r.radiusKm === ringKm) ?? RINGS()[RINGS().length - 1];
    return await executeRingQuery(osClient, input, lockedRing, from, locationName, false, correlationId);
  }

  // ── Expanding ring mode (page 1 or no lock) ───────────────────────────────
  let expanded = false;
  for (const ring of RINGS()) {
    const result = await executeRingQuery(osClient, input, ring, from, locationName, expanded, correlationId);

    if (result.total > 0) {
      return result;
    }

    // No results in this ring — expand to next
    logger.info('search.ring.expanding', {
      correlationId,
      currentRingKm: ring.radiusKm,
      reason: 'zero_results',
    });
    expanded = true;
  }

  // If absolutely no providers found across all rings, return the last ring's
  // empty result (should never happen in a live system with data).
  return await executeRingQuery(
    osClient,
    input,
    RINGS()[RINGS().length - 1],
    from,
    locationName,
    true,
    correlationId,
  );
}

// ─── executeRingQuery ─────────────────────────────────────────────────────────

async function executeRingQuery(
  osClient: ReturnType<typeof getOpenSearchClient>,
  input: RingSearchInput,
  ring: RingDef,
  from: number,
  locationName: string,
  expanded: boolean,
  correlationId: string,
): Promise<RingSearchResult> {
  const query = buildOsQuery(input, ring, from);

  logger.info('search.opensearch.query', {
    correlationId,
    radiusKm: ring.radiusKm,
    page: input.page,
    from,
    q: input.q ?? null,
    tab: input.tab ?? null,
  });

  const response = await osClient.search({
    index: OPENSEARCH_INDEX,
    body: query,
  });

  const hits = response.body.hits;
  const total =
    typeof hits.total === 'number'
      ? hits.total
      : (hits.total as { value: number }).value ?? 0;

  const results: ProviderHit[] = (hits.hits as any[]).map((hit: any) => {
    const s = hit._source ?? {};
    // Distance is in sort values (second sort = _geo_distance)
    const distanceKm: number | null =
      hit.sort && hit.sort[1] != null ? Number(hit.sort[1]) : null;

    return {
      providerId:          s.provider_id ?? '',
      displayName:         s.display_name ?? '',
      category_id:         s.category_id ?? '',
      tab:                 s.tab ?? '',
      cityId:              s.city_id ?? '',
      geo_point:           s.geo_point ?? null,
      trustScore:          s.trust_score ?? 0,
      trustTier:           s.trust_tier ?? 'basic',
      isAvailable:         s.is_available ?? false,
      availabilityMode:    s.availability_mode ?? 'offline',
      isActive:            s.is_active ?? false,
      isClaimed:           s.is_claimed ?? false,
      listingType:         s.listing_type ?? '',
      profilePhotoS3Key:   s.profile_photo_s3_key ?? null,
      profile_photo_url:   s.profile_photo_s3_key ?? null,
      tagline:             s.tagline ?? null,
      years_of_experience: s.years_of_experience ?? null,
      reviewCount:         s.review_count ?? 0,
      rating_count:        s.review_count ?? 0,
      avg_rating:          s.avg_rating ?? null,
      rating_avg:          s.avg_rating ?? null,
      taxonomy_name:       s.taxonomy_name ?? null,
      distance_km:         distanceKm,
    };
  });

  const narration = buildNarration(
    total,
    ring,
    locationName,
    input.tab,
    input.q,
  );

  logger.info('search.opensearch.result', {
    correlationId,
    radiusKm: ring.radiusKm,
    total,
    returned: results.length,
    expanded,
  });

  return {
    results,
    total,
    page: input.page,
    page_size: PAGE_SIZE,
    has_more: from + results.length < total,
    ring_km: ring.radiusKm,
    ring_label: ring.label,
    narration,
    expanded,
  };
}

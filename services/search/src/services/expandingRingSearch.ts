// services/search/src/services/expandingRingSearch.ts
//
// 7-Bucket Waterfall Search for SatvAAh.
//
// Strategy: try each bucket in priority order. Return up to
// search_bucket_max_results (default 5) from the FIRST bucket
// that has results. Never mix buckets in one response.
//
// Bucket priority (all admin-configurable in system_config):
//   1. Verified vendors   0–6km     exact L4
//   2. Verified vendors   7–50km    exact L4
//   3. Verified vendors   0–50km    L3 fallback (related category)
//   4. Unverified vendors 0–6km     exact L4
//   5. Unverified vendors 7–50km    exact L4
//   6. Unverified vendors 0–50km    L3 fallback (related category)
//   7. Any vendor         0–1000km  exact L4 + L3 (tabs: services,expertise only)
//
// Sort within every bucket: trust_score DESC → distance ASC
//
// Parameter notes:
//   lng (our API param) → lon (OpenSearch geo_point field key) at boundary

import { getOpenSearchClient, OPENSEARCH_INDEX } from '../lib/opensearchClient';
import { logger } from '@satvaaah/logger';
import { getConfigInt, getConfigOptional } from '@satvaaah/config';

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAGE_SIZE = 20;

const VALID_TABS = ['products', 'services', 'expertise', 'establishments'] as const;
export type SearchTab = (typeof VALID_TABS)[number];

// ─── Config helpers ───────────────────────────────────────────────────────────

function cfg(key: string, fallback: number): number {
  try { return getConfigInt(key as any); } catch { return fallback; }
}

function cfgStr(key: string, fallback: string): string {
  return getConfigOptional(key as any) ?? fallback;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RingSearchInput {
  q?: string;
  tab?: string;
  lat: number;
  lng: number;
  page: number;
  ringKm?: number;
  locationName?: string;
  correlationId: string;
  taxonomyNodeId?: string;
  taxonomyL4?: string;
  taxonomyL3?: string;
  taxonomyL2?: string;
  taxonomyL1?: string;
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
  isScrapeRecord: boolean;
  listingType: string;
  profilePhotoS3Key: string | null;
  tagline: string | null;
  years_of_experience: number | null;
  reviewCount: number;
  rating_count: number;
  contact_count: number;
  avg_rating: number | null;
  homeVisit: boolean;
  home_visit_available: boolean;
  areaName: string;
  area: string;
  languages: string[];
  has_certificate: boolean;
  certificate_id: string | null;
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
  taxonomy_level_used: string | null;
  bucket_used: number | null;
  bucket_label: string | null;
}

// ─── Bucket definitions ───────────────────────────────────────────────────────

interface Bucket {
  id: number;
  label: string;
  minKm: number;
  maxKm: number;
  verifiedOnly: boolean;    // true = is_claimed=true filter
  useL3Fallback: boolean;   // true = L3 taxonomy instead of exact L4
  tabsAllowed: string[];    // empty = all tabs
}

function getBuckets(tab: string | undefined): Bucket[] {
  const b1max  = cfg('search_bucket_1_max_km', 6);
  const b2min  = cfg('search_bucket_2_min_km', 7);
  const b2max  = cfg('search_bucket_2_max_km', 50);
  const b3max  = cfg('search_bucket_3_max_km', 50);
  const b4max  = cfg('search_bucket_4_max_km', 6);
  const b5min  = cfg('search_bucket_5_min_km', 7);
  const b5max  = cfg('search_bucket_5_max_km', 50);
  const b6max  = cfg('search_bucket_6_max_km', 50);
  const b7max  = cfg('search_bucket_7_max_km', 1000);
  const b7tabs = cfgStr('search_bucket_7_tabs', 'services,expertise,products,establishments')
    .split(',').map(s => s.trim()).filter(Boolean);

  const all: Bucket[] = [
    { id: 1, label: 'Verified vendors near you',                   minKm: 0,     maxKm: b1max, verifiedOnly: false, useL3Fallback: false, tabsAllowed: [] },
    { id: 2, label: 'Verified vendors in your city',               minKm: b2min, maxKm: b2max, verifiedOnly: false, useL3Fallback: false, tabsAllowed: [] },
    { id: 3, label: 'Verified vendors in related categories',       minKm: 0,     maxKm: b3max, verifiedOnly: true,  useL3Fallback: true,  tabsAllowed: [] },
    { id: 4, label: 'Other vendors near you',                      minKm: 0,     maxKm: b4max, verifiedOnly: false, useL3Fallback: false, tabsAllowed: [] },
    { id: 5, label: 'Other vendors in your city',                  minKm: b5min, maxKm: b5max, verifiedOnly: false, useL3Fallback: false, tabsAllowed: [] },
    { id: 6, label: 'Other vendors in related categories',          minKm: 0,     maxKm: b6max, verifiedOnly: false, useL3Fallback: true,  tabsAllowed: [] },
    { id: 7, label: 'Vendors across India',                        minKm: 0,     maxKm: b7max, verifiedOnly: false, useL3Fallback: false, tabsAllowed: b7tabs },
  ];

  // Filter bucket 7 by tab
  return all.filter(b => {
    if (b.id !== 7) return true;
    if (b.tabsAllowed.length === 0) return true;
    return tab ? b.tabsAllowed.includes(tab) : false;
  });
}

// ─── buildOsQuery ─────────────────────────────────────────────────────────────

function buildOsQuery(
  input: RingSearchInput,
  bucket: Bucket,
  from: number,
  size: number,
): object {
  const { q, tab, lat, lng } = input;

  const mustClauses: object[] = [];

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
    mustClauses.push({ match_all: {} });
  }

  const filterClauses: object[] = [
    { term: { is_active: true } },
  ];

  // Geo filter: range band (minKm → maxKm)
  // Bucket 1,4: 0–6km → just a single geo_distance at maxKm
  // Bucket 2,5: 7–50km → geo_distance at maxKm + geo_distance exclusion at minKm
  if (bucket.minKm > 0) {
    // Outer ring: within maxKm but NOT within minKm
    filterClauses.push({
      geo_distance: { distance: `${bucket.maxKm}km`, geo_point: { lat, lon: lng } },
    });
    filterClauses.push({
      bool: {
        must_not: {
          geo_distance: { distance: `${bucket.minKm}km`, geo_point: { lat, lon: lng } },
        },
      },
    });
  } else {
    filterClauses.push({
      geo_distance: { distance: `${bucket.maxKm}km`, geo_point: { lat, lon: lng } },
    });
  }

  // Verified filter
  if (bucket.verifiedOnly) {
    filterClauses.push({ term: { is_claimed: true } });
  }

  // Taxonomy filter
  if (bucket.useL3Fallback) {
    // L3 fallback: match any provider in the same L3 category
    if (input.taxonomyL3 && input.taxonomyL1) {
      filterClauses.push({
        bool: {
          filter: [
            { term: { taxonomy_l3: input.taxonomyL3 } },
            { term: { taxonomy_l1: input.taxonomyL1 } },
          ],
        },
      });
    } else if (input.taxonomyL2 && input.taxonomyL1) {
      filterClauses.push({
        bool: {
          filter: [
            { term: { taxonomy_l2: input.taxonomyL2 } },
            { term: { taxonomy_l1: input.taxonomyL1 } },
          ],
        },
      });
    } else if (input.taxonomyL1) {
      filterClauses.push({ term: { taxonomy_l1: input.taxonomyL1 } });
    }
  } else {
    // Exact L4 match via taxonomy_node_id
    if (input.taxonomyNodeId) {
      filterClauses.push({ term: { taxonomy_node_id: input.taxonomyNodeId } });
    }
  }

  // Tab filter
  if (tab && VALID_TABS.includes(tab as SearchTab)) {
    filterClauses.push({ term: { tab } });
  }

  return {
    from,
    size,
    query: { bool: { must: mustClauses, filter: filterClauses } },
    sort: [
      { is_claimed: { order: 'desc' } },
      { trust_score: { order: 'desc' } },
      { _geo_distance: { geo_point: { lat, lon: lng }, order: 'asc', unit: 'km', distance_type: 'arc' } },
    ],
    _source: [
      'provider_id', 'display_name', 'category_id', 'taxonomy_node_id', 'tab', 'city_id', 'geo_point',
      'trust_score', 'trust_tier', 'is_available', 'availability_mode', 'is_active',
      'is_claimed', 'is_scrape_record', 'listing_type', 'profile_photo_s3_key',
      'tagline', 'years_of_experience', 'review_count', 'avg_rating', 'contact_count',
      'taxonomy_name', 'taxonomy_l1', 'taxonomy_l2', 'taxonomy_l3', 'taxonomy_l4',
      'home_visit_available', 'area_name', 'languages', 'has_certificate',
    ],
  };
}

// ─── buildNarration ───────────────────────────────────────────────────────────

function buildNarration(
  total: number,
  bucket: Bucket,
  requestedLabel: string,
  locationName: string,
): string {
  const count = total > 999 ? '999+' : `${total}`;
  const loc   = locationName || 'your location';

  if (total === 0) return `No ${requestedLabel} found.`;

  // L3 fallback narration
  if (bucket.useL3Fallback) {
    return bucket.verifiedOnly
      ? `No exact match — showing ${count} verified providers in related categories within ${bucket.maxKm}km of ${loc}.`
      : `No exact match — showing ${count} providers in related categories within ${bucket.maxKm}km of ${loc}.`;
  }

  // Outside city (bucket 7)
  if (bucket.id === 7) {
    return `No ${requestedLabel} found near you — showing ${count} available across India.`;
  }

  // Vicinity
  if (bucket.minKm === 0 && bucket.maxKm <= 10) {
    return bucket.verifiedOnly
      ? `Found ${count} verified ${requestedLabel} within ${bucket.maxKm}km of ${loc}.`
      : `Found ${count} ${requestedLabel} within ${bucket.maxKm}km of ${loc}.`;
  }

  // City-wide
  return bucket.verifiedOnly
    ? `Found ${count} verified ${requestedLabel} in your city.`
    : `Found ${count} ${requestedLabel} in your city.`;
}

// ─── mapHit ───────────────────────────────────────────────────────────────────

function mapHit(hit: any): ProviderHit {
  const s = hit._source ?? {};
  const distanceKm: number | null =
    hit.sort && hit.sort[2] != null ? Number(hit.sort[2]) : null;
  const categoryId = s.category_id ?? s.taxonomy_node_id ?? '';
  const contactCount: number = typeof s.contact_count === 'number'
    ? s.contact_count
    : (parseInt(String(s.contact_count ?? '0'), 10) || 0);

  return {
    providerId:           s.provider_id ?? '',
    displayName:          s.display_name ?? '',
    category_id:          categoryId,
    tab:                  s.tab ?? '',
    cityId:               s.city_id ?? '',
    geo_point:            s.geo_point ?? null,
    trustScore:           s.trust_score ?? 0,
    trustTier:            s.trust_tier ?? 'unverified',
    isAvailable:          s.is_available === true || s.is_available === 'true',
    availabilityMode:     s.availability_mode ?? 'unavailable',
    isActive:             s.is_active === true || s.is_active === 'true',
    isClaimed:            s.is_claimed === true || s.is_claimed === 'true',
    isScrapeRecord:       s.is_scrape_record === true || s.is_scrape_record === 'true',
    listingType:          s.listing_type ?? '',
    profilePhotoS3Key:    s.profile_photo_s3_key ?? null,
    profile_photo_url:    s.profile_photo_s3_key ?? null,
    tagline:              s.tagline ?? null,
    years_of_experience:  s.years_of_experience ?? null,
    reviewCount:          contactCount,
    rating_count:         contactCount,
    contact_count:        contactCount,
    avg_rating:           s.avg_rating ?? null,
    rating_avg:           s.avg_rating ?? null,
    taxonomy_name:        s.taxonomy_name ?? null,
    distance_km:          distanceKm,
    homeVisit:            s.home_visit_available === true || s.home_visit_available === 'true',
    home_visit_available: s.home_visit_available === true || s.home_visit_available === 'true',
    areaName:             s.area_name ?? '',
    area:                 s.area_name ?? '',
    languages:            Array.isArray(s.languages) ? s.languages : [],
    has_certificate:      s.has_certificate === true || s.has_certificate === 'true',
    certificate_id:       (s.has_certificate === true || s.has_certificate === 'true') ? 'verified' : null,
  };
}

// ─── expandingRingSearch ──────────────────────────────────────────────────────

export async function expandingRingSearch(
  input: RingSearchInput,
): Promise<RingSearchResult> {
  const { page, locationName = 'your location', correlationId } = input;

  const maxResults  = cfg('search_bucket_max_results', 20);
  const minResults  = cfg('search_min_results', 5);
  const from        = (page - 1) * maxResults;
  const osClient   = getOpenSearchClient();

  const requestedLabel = input.taxonomyL4 ?? input.q ?? 'providers';
  const buckets        = getBuckets(input.tab);

  // Page > 1: locked to the bucket that gave page-1 results
  // ringKm is passed by SearchResultsScreen for pagination
  if (input.ringKm !== undefined) {
    // For pagination we re-run the same query that produced page 1
    // We encode bucket_id in ringKm as a convention: bucket_id * 10000 + actualKm
    // But to keep backward compat, just run open search at that radius
    const openBucket: Bucket = {
      id: 0, label: 'paginating', minKm: 0, maxKm: input.ringKm,
      verifiedOnly: false, useL3Fallback: false, tabsAllowed: [],
    };
    const q = buildOsQuery(input, openBucket, from, maxResults);
    const response = await osClient.search({ index: OPENSEARCH_INDEX, body: q });
    const hits = response.body.hits;
    const total = typeof hits.total === 'number'
      ? hits.total : (hits.total as any).value ?? 0;
    const results = (hits.hits as any[]).map(mapHit);
    return {
      results, total, page: input.page, page_size: maxResults,
      has_more: from + results.length < total,
      ring_km: input.ringKm, ring_label: `${input.ringKm}km`,
      narration: '', expanded: true, taxonomy_level_used: null, bucket_used: null,
      bucket_label: null,
    };
  }

  // Waterfall through buckets — accumulate until minResults reached
  const accumulated: ProviderHit[] = [];
  const seenIds = new Set<string>();
  let bestBucket: Bucket | null = null;
  let bestTotal = 0;

  for (const bucket of buckets) {
    const query = buildOsQuery(input, bucket, 0, maxResults);

    logger.info('search.bucket.trying', {
      correlationId,
      bucketId: bucket.id,
      bucketLabel: bucket.label,
      maxKm: bucket.maxKm,
      verifiedOnly: bucket.verifiedOnly,
      useL3Fallback: bucket.useL3Fallback,
      taxonomyNodeId: input.taxonomyNodeId ?? null,
    });

    const response = await osClient.search({ index: OPENSEARCH_INDEX, body: query });
    const hits     = response.body.hits;
    const total    = typeof hits.total === 'number'
      ? hits.total : (hits.total as any).value ?? 0;

    if (total > 0) {
      const bucketResults = (hits.hits as any[]).map(mapHit);

      // Add deduplicated results
      for (const r of bucketResults) {
        if (!seenIds.has(r.providerId)) {
          seenIds.add(r.providerId);
          accumulated.push(r);
        }
      }

      if (bestBucket === null) {
        bestBucket = bucket;
        bestTotal  = total;
      }

      logger.info('search.bucket.hit', {
        correlationId, bucketId: bucket.id, total, accumulated: accumulated.length,
      });

      // Stop once we have enough results
      if (accumulated.length >= minResults) break;
    } else {
      logger.info('search.bucket.miss', {
        correlationId, bucketId: bucket.id, label: bucket.label,
      });
    }
  }

  if (accumulated.length > 0 && bestBucket !== null) {
    const pageSlice = accumulated.slice(from, from + maxResults);
    const narration = buildNarration(bestTotal, bestBucket, requestedLabel, locationName);
    return {
      results: pageSlice,
      total: accumulated.length,
      page: input.page,
      page_size: maxResults,
      has_more: from + pageSlice.length < accumulated.length,
      ring_km: bestBucket.maxKm,
      ring_label: `${bestBucket.maxKm}km`,
      narration,
      expanded: bestBucket.id > 1,
      taxonomy_level_used: bestBucket.useL3Fallback ? 'l3' : 'l4',
      bucket_used: bestBucket.id,
      bucket_label: bestBucket.label,
    };
  }

  // All buckets exhausted — return empty with helpful narration
  logger.info('search.bucket.all_exhausted', { correlationId, requestedLabel });

  return {
    results: [], total: 0, page: input.page, page_size: maxResults,
    has_more: false, ring_km: 0, ring_label: 'none',
    narration: `No ${requestedLabel} found anywhere in India yet.`,
    expanded: true, taxonomy_level_used: null, bucket_used: null,
    bucket_label: null,
  };
}

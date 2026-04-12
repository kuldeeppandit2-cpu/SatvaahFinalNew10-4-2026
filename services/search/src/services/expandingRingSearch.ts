// services/search/src/services/expandingRingSearch.ts
//
// Expanding ring search for SatvAAh.
//
// Two-axis expansion strategy:
//   AXIS 1 — Geographic rings (3→7→15→50→150→1000 km): try each ring at the
//     current taxonomy level. If zero results at all rings, climb the tree.
//   AXIS 2 — Taxonomy tree-climb (L4→L3→L2→L1): only triggered when all rings
//     at the current level return zero. Each climb resets ring expansion from 3 km.
//
// Taxonomy filter:
//   When taxonomyNodeId is provided, filter by exact taxonomy_node_id UUID.
//   Tree-climb uses taxonomy_l1/l2/l3 keyword fields for broader matches.
//
// Parameter notes:
//   lng (our API param) → lon (OpenSearch geo_point field key) at boundary

import { getOpenSearchClient, OPENSEARCH_INDEX } from '../lib/opensearchClient';
import { logger } from '@satvaaah/logger';
import { getConfigInt } from '@satvaaah/config';

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAGE_SIZE = 20;

const VALID_TABS = ['products', 'services', 'expertise', 'establishments'] as const;
export type SearchTab = (typeof VALID_TABS)[number];

interface RingDef {
  radiusKm: number;
  label: string;
  crossCityOnly?: boolean;
}

export const DEFAULT_RINGS: RingDef[] = [
  { radiusKm: 3,    label: '3 km' },
  { radiusKm: 7,    label: '7 km' },
  { radiusKm: 15,   label: '15 km' },
  { radiusKm: 50,   label: '50 km' },
  { radiusKm: 150,  label: '150 km', crossCityOnly: true },
  { radiusKm: 1000, label: '1000 km', crossCityOnly: true },
];

function getRings(): RingDef[] {
  try {
    const r1 = getConfigInt('search_ring_1_km');
    const r2 = getConfigInt('search_ring_2_km');
    const r3 = getConfigInt('search_ring_3_km');
    const r4 = getConfigInt('search_ring_4_km');
    const r5 = getConfigInt('search_ring_5_km');
    const r6 = getConfigInt('search_ring_6_km');
    return [
      { radiusKm: r1, label: `${r1} km` },
      { radiusKm: r2, label: `${r2} km` },
      { radiusKm: r3, label: `${r3} km` },
      { radiusKm: r4, label: `${r4} km` },
      { radiusKm: r5, label: `${r5} km`, crossCityOnly: true },
      { radiusKm: r6, label: `${r6} km`, crossCityOnly: true },
    ];
  } catch {
    return DEFAULT_RINGS;
  }
}

function RINGS(): RingDef[] { return getRings(); }

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
  // Taxonomy anchor (S1 browse + S2 after suggestion selected)
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
}

// ─── Taxonomy level descriptor ────────────────────────────────────────────────

interface TaxonomyLevel {
  level: 'l4' | 'l3' | 'l2' | 'l1';
  filter: object;
  label: string;
}

function buildTaxonomyLevels(input: RingSearchInput): TaxonomyLevel[] {
  const levels: TaxonomyLevel[] = [];

  if (input.taxonomyNodeId) {
    levels.push({
      level: 'l4',
      filter: { term: { taxonomy_node_id: input.taxonomyNodeId } },
      label: input.taxonomyL4 ?? 'providers',
    });
  }

  if (input.taxonomyL3 && input.taxonomyL1) {
    levels.push({
      level: 'l3',
      filter: { bool: { filter: [
        { term: { taxonomy_l3: input.taxonomyL3 } },
        { term: { taxonomy_l1: input.taxonomyL1 } },
      ] } },
      label: input.taxonomyL3,
    });
  }

  if (input.taxonomyL2 && input.taxonomyL1) {
    levels.push({
      level: 'l2',
      filter: { bool: { filter: [
        { term: { taxonomy_l2: input.taxonomyL2 } },
        { term: { taxonomy_l1: input.taxonomyL1 } },
      ] } },
      label: input.taxonomyL2,
    });
  }

  if (input.taxonomyL1) {
    levels.push({
      level: 'l1',
      filter: { term: { taxonomy_l1: input.taxonomyL1 } },
      label: input.taxonomyL1,
    });
  }

  return levels;
}

// ─── buildOsQuery ─────────────────────────────────────────────────────────────

function buildOsQuery(
  input: RingSearchInput,
  ring: RingDef,
  from: number,
  taxonomyFilter: object | null,
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
    {
      geo_distance: {
        distance: `${ring.radiusKm}km`,
        geo_point: { lat, lon: lng },
      },
    },
  ];

  if (taxonomyFilter) {
    filterClauses.push(taxonomyFilter);
  }

  if (tab && VALID_TABS.includes(tab as SearchTab)) {
    filterClauses.push({ term: { tab } });
  }

  // crossCityOnly: do NOT filter by is_claimed — show all providers at long range
  // is_claimed is already in the sort (desc) so verified providers still rank first

  return {
    from,
    size: PAGE_SIZE,
    query: { bool: { must: mustClauses, filter: filterClauses } },
    sort: [
      { is_claimed: { order: 'desc' } },
      { trust_score: { order: 'desc' } },
      { _geo_distance: { geo_point: { lat, lon: lng }, order: 'asc', unit: 'km', distance_type: 'arc' } },
    ],
    script_fields: {},
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
  ring: RingDef,
  locationName: string,
  tab: string | undefined,
  q: string | undefined,
  taxonomyLevelUsed: string | null,
  requestedLabel: string | undefined,
  foundLabel: string | undefined,
): string {
  const entityLabel =
    q && q.trim().length > 0
      ? q.trim().toLowerCase()
      : tab ? tab.toLowerCase() : 'providers';

  const displayLabel = foundLabel ?? entityLabel;
  const countLabel = total > 999 ? '999+' : `${total}`;

  // Taxonomy fallback narration (fell back from L4 → L3/L2/L1)
  if (taxonomyLevelUsed && requestedLabel && foundLabel && requestedLabel !== foundLabel) {
    if (total === 0) {
      return `No ${requestedLabel} found anywhere — try a different category.`;
    }
    if (ring.crossCityOnly) {
      return `No ${requestedLabel} found near you — showing ${countLabel} ${foundLabel} available across India.`;
    }
    return `No ${requestedLabel} found — showing ${countLabel} ${foundLabel} within ${ring.label} of ${locationName}.`;
  }

  if (total === 0) {
    return `No ${displayLabel} found near you.`;
  }

  if (ring.crossCityOnly) {
    return `We could not find ${displayLabel} in your city — showing ${countLabel} available across India.`;
  }

  return `Found ${countLabel} ${displayLabel} within ${ring.label} of ${locationName}.`;
}

// ─── expandingRingSearch ──────────────────────────────────────────────────────

export async function expandingRingSearch(
  input: RingSearchInput,
): Promise<RingSearchResult> {
  const { page, ringKm, locationName = 'your location', correlationId } = input;
  const from = (page - 1) * PAGE_SIZE;
  const osClient = getOpenSearchClient();

  // Locked ring mode (page > 1)
  if (ringKm !== undefined) {
    const lockedRing = RINGS().find((r) => r.radiusKm === ringKm) ?? RINGS()[RINGS().length - 1];
    const taxonomyFilter = input.taxonomyNodeId
      ? { term: { taxonomy_node_id: input.taxonomyNodeId } }
      : null;
    return executeRingQuery(
      osClient, input, lockedRing, from, locationName, false, correlationId,
      taxonomyFilter, 'l4', input.taxonomyL4, input.taxonomyL4,
    );
  }

  const taxonomyLevels = buildTaxonomyLevels(input);

  // Taxonomy-constrained expanding search
  if (taxonomyLevels.length > 0) {
    const requestedLabel = taxonomyLevels[0].label;

    for (const txLevel of taxonomyLevels) {
      let expanded = false;
      for (const ring of RINGS()) {
        const result = await executeRingQuery(
          osClient, input, ring, from, locationName, expanded, correlationId,
          txLevel.filter, txLevel.level, requestedLabel, txLevel.label,
        );
        if (result.total > 0) return result;

        logger.info('search.ring.expanding', {
          correlationId, currentRingKm: ring.radiusKm,
          taxonomyLevel: txLevel.level, reason: 'zero_results',
        });
        expanded = true;
      }

      logger.info('search.taxonomy.climbing', {
        correlationId, fromLevel: txLevel.level, fromLabel: txLevel.label,
      });
    }

    // All levels + all rings exhausted
    return executeRingQuery(
      osClient, input, RINGS()[RINGS().length - 1],
      from, locationName, true, correlationId,
      null, null, requestedLabel, requestedLabel,
    );
  }

  // Open search (no taxonomy anchor)
  let expanded = false;
  for (const ring of RINGS()) {
    const result = await executeRingQuery(
      osClient, input, ring, from, locationName, expanded, correlationId,
      null, null, undefined, undefined,
    );
    if (result.total > 0) return result;

    logger.info('search.ring.expanding', {
      correlationId, currentRingKm: ring.radiusKm, reason: 'zero_results',
    });
    expanded = true;
  }

  return executeRingQuery(
    osClient, input, RINGS()[RINGS().length - 1],
    from, locationName, true, correlationId,
    null, null, undefined, undefined,
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
  taxonomyFilter: object | null,
  taxonomyLevelUsed: string | null,
  requestedLabel: string | undefined,
  foundLabel: string | undefined,
): Promise<RingSearchResult> {
  const query = buildOsQuery(input, ring, from, taxonomyFilter);

  logger.info('search.opensearch.query', {
    correlationId, radiusKm: ring.radiusKm, page: input.page, from,
    q: input.q ?? null, tab: input.tab ?? null,
    taxonomyNodeId: input.taxonomyNodeId ?? null, taxonomyLevel: taxonomyLevelUsed,
  });

  const response = await osClient.search({ index: OPENSEARCH_INDEX, body: query });

  const hits = response.body.hits;
  const total =
    typeof hits.total === 'number'
      ? hits.total
      : (hits.total as { value: number }).value ?? 0;

  const results: ProviderHit[] = (hits.hits as any[]).map((hit: any) => {
    const s = hit._source ?? {};
    // sort[2] = _geo_distance (after is_claimed + trust_score)
    const distanceKm: number | null =
      hit.sort && hit.sort[2] != null ? Number(hit.sort[2]) : null;

    // category_id is an alias for taxonomy_node_id in the index (set by bulk-index script).
    // Fall back to taxonomy_node_id in case the doc was indexed before the alias was added.
    const categoryId = s.category_id ?? s.taxonomy_node_id ?? '';

    // contact_count = accepted contact events (indexed in Step 19, BUG-12 fix).
    // Used for "N customers served" on provider cards.
    const contactCount: number = typeof s.contact_count === 'number'
      ? s.contact_count
      : (parseInt(String(s.contact_count ?? '0'), 10) || 0);

    return {
      providerId:          s.provider_id ?? '',
      displayName:         s.display_name ?? '',
      category_id:         categoryId,
      tab:                 s.tab ?? '',
      cityId:              s.city_id ?? '',
      geo_point:           s.geo_point ?? null,
      trustScore:          s.trust_score ?? 0,
      trustTier:           s.trust_tier ?? 'unverified',
      isAvailable:         s.is_available === true || s.is_available === 'true',
      availabilityMode:    s.availability_mode ?? 'unavailable',
      isActive:            s.is_active === true || s.is_active === 'true',
      isClaimed:           s.is_claimed === true || s.is_claimed === 'true',
      isScrapeRecord:      s.is_scrape_record === true || s.is_scrape_record === 'true',
      listingType:         s.listing_type ?? '',
      profilePhotoS3Key:   s.profile_photo_s3_key ?? null,
      profile_photo_url:   s.profile_photo_s3_key ?? null,
      tagline:             s.tagline ?? null,
      years_of_experience: s.years_of_experience ?? null,
      // Customers served — from contact_count (accepted events in index)
      reviewCount:         contactCount,
      rating_count:        contactCount,
      contact_count:       contactCount,
      avg_rating:          s.avg_rating ?? null,
      rating_avg:          s.avg_rating ?? null,
      taxonomy_name:       s.taxonomy_name ?? null,
      distance_km:         distanceKm,
      // Previously dead fields — now indexed (Fix-18/19/20)
      homeVisit:           s.home_visit_available === true || s.home_visit_available === 'true',
      home_visit_available: s.home_visit_available === true || s.home_visit_available === 'true',
      areaName:            s.area_name ?? '',
      area:                s.area_name ?? '',
      languages:           Array.isArray(s.languages) ? s.languages : [],
      has_certificate:     s.has_certificate === true || s.has_certificate === 'true',
      certificate_id:      (s.has_certificate === true || s.has_certificate === 'true') ? 'verified' : null,
    };
  });

  const narration = buildNarration(
    total, ring, locationName, input.tab, input.q,
    taxonomyLevelUsed, requestedLabel, foundLabel,
  );

  logger.info('search.opensearch.result', {
    correlationId, radiusKm: ring.radiusKm,
    total, returned: results.length, expanded, taxonomyLevel: taxonomyLevelUsed,
  });

  return {
    results, total,
    page: input.page,
    page_size: PAGE_SIZE,
    has_more: from + results.length < total,
    ring_km: ring.radiusKm,
    ring_label: ring.label,
    narration, expanded,
    taxonomy_level_used: taxonomyLevelUsed,
  };
}

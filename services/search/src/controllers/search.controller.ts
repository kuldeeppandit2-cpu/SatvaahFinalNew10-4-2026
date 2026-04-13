// services/search/src/controllers/search.controller.ts
//
// Controller layer for the search service.
// Validates inputs and delegates to service layer.
// Contains NO business logic.
//
// Handlers:
//   searchProviders      → GET  /api/v1/search
//   suggestQuery         → GET  /api/v1/search/suggest
//   captureIntent        → POST /api/v1/search/intent
//   getCategories        → GET  /api/v1/categories
//   getProviderProfile   → GET  /api/v1/providers/:id
//   getAvailabilityChanges → GET /api/v1/search/availability-changes

import { Request, Response } from 'express';
import { logger } from '@satvaaah/logger';
import { prisma } from '@satvaaah/db';
import { AppError } from '@satvaaah/errors';
import { expandingRingSearch } from '../services/expandingRingSearch';
import { suggestService } from '../services/suggestService';
import { captureSearchIntent } from '../services/intentService';
import { redisGet, redisSet } from '../lib/redisClient';
import { getOpenSearchClient, OPENSEARCH_INDEX } from '../lib/opensearchClient';

// Redis TTL for category grid cache: 24 hours
const CATEGORIES_CACHE_TTL_SECONDS = 24 * 60 * 60;
// HTTP cache TTL for category responses on the device (1 hour).
// Categories change rarely — L1/L2/L3/L4 taxonomy is stable.
// This means: first load fetches from server, next 1hr loads from device cache.
// Same strategy as Swiggy/Zomato for their cuisine/category tiles.
const CATEGORIES_HTTP_CACHE_SECONDS = 60 * 60;
const VALID_TABS = ['products', 'services', 'expertise', 'establishments'] as const;
type SearchTab = typeof VALID_TABS[number];

// ─── searchProviders ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/search?q=&tab=&lat=&lng=&page=&ring_km=&location_name=
 *
 * Expanding ring search. Returns results from OpenSearch satvaaah_providers index.
 * Param name is `lng` (NOT lon) — consistent with ST_MakePoint(lng, lat).
 */
export const searchProviders = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const correlationId = req.headers['x-correlation-id'] as string;

  const {
    q,
    tab,
    lat: latRaw,
    lng: lngRaw,
    page: pageRaw,
    ring_km: ringKmRaw,
    location_name,
    // Taxonomy anchor — set by CategoryBrowseScreen (S1) and SearchScreen (S2)
    taxonomy_node_id,
    taxonomy_l4,
    taxonomy_l3,
    taxonomy_l2,
    taxonomy_l1,
  } = req.query as Record<string, string | undefined>;

  // ── Validate lat / lng ─────────────────────────────────────────────────────
  if (!latRaw || !lngRaw) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'lat and lng query parameters are required',
      },
    });
    return;
  }

  const lat = parseFloat(latRaw);
  const lng = parseFloat(lngRaw);

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'lat and lng must be valid numbers',
      },
    });
    return;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'lat must be −90 to 90, lng must be −180 to 180',
      },
    });
    return;
  }

  // ── Validate tab ───────────────────────────────────────────────────────────
  if (tab && !VALID_TABS.includes(tab as SearchTab)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_TAB',
        message: `tab must be one of: ${VALID_TABS.join(', ')}`,
      },
    });
    return;
  }

  // ── Validate page ──────────────────────────────────────────────────────────
  const page = pageRaw ? Math.max(1, parseInt(pageRaw, 10)) : 1;
  if (isNaN(page)) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'page must be an integer' },
    });
    return;
  }

  // ── Optional locked ring for pagination ───────────────────────────────────
  const ringKm = ringKmRaw ? parseFloat(ringKmRaw) : undefined;

  logger.info('search.request');

  const result = await expandingRingSearch({
    q: q?.trim(),
    tab,
    lat,
    lng,
    page,
    ringKm,
    locationName: location_name?.trim() ?? 'your location',
    correlationId,
    // Taxonomy anchor — optional; undefined = open search (no taxonomy constraint)
    taxonomyNodeId: taxonomy_node_id?.trim() || undefined,
    taxonomyL4:     taxonomy_l4?.trim()     || undefined,
    taxonomyL3:     taxonomy_l3?.trim()     || undefined,
    taxonomyL2:     taxonomy_l2?.trim()     || undefined,
    taxonomyL1:     taxonomy_l1?.trim()     || undefined,
  });

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.status(200).json({ success: true, data: result });
};

// ─── suggestQuery ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/search/suggest?q=&tab=
 *
 * Taxonomy-constrained autocomplete. Min 2 chars. Max 8 results.
 * NEVER returns provider names — only taxonomy_nodes.
 */
export const suggestQuery = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const { q, tab } = req.query as { q?: string; tab?: string };

  if (!q || q.trim().length < 2) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'q must be at least 2 characters',
      },
    });
    return;
  }

  // suggestService enforces the min-chars rule from system_config;
  // it throws SUGGEST_QUERY_TOO_SHORT (400) if q is below the threshold.
  const results = await suggestService({ q, tab, correlationId });

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.status(200).json({ success: true, data: results });
};

// ─── captureIntent ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/search/intent
 *
 * Internal endpoint — never fails the caller.
 * Immediately returns 202 Accepted and processes the insert asynchronously.
 * Auth: INTERNAL_SERVICE_KEY required (checked by internalAuth middleware in routes).
 *
 * Body: { user_id, taxonomy_node_id, lat, lng }
 */
export const captureIntent = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const { user_id, taxonomy_node_id, lat: latRaw, lng: lngRaw } = req.body as {
    user_id?: string;
    taxonomy_node_id?: string;
    lat?: number | string;
    lng?: number | string;
  };

  // Validate required fields
  if (!user_id || !taxonomy_node_id || latRaw == null || lngRaw == null) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'user_id, taxonomy_node_id, lat and lng are required',
      },
    });
    return;
  }

  const lat = typeof latRaw === 'string' ? parseFloat(latRaw) : latRaw;
  const lng = typeof lngRaw === 'string' ? parseFloat(lngRaw) : lngRaw;

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'lat and lng must be numbers' },
    });
    return;
  }

  // Immediately acknowledge — DO NOT await the insert
  res.status(202).json({ success: true, data: { accepted: true } });

  // Fire-and-forget — captureSearchIntent swallows all errors internally
  void captureSearchIntent({
    userId: user_id,
    taxonomyNodeId: taxonomy_node_id,
    lat,
    lng,
    correlationId,
  });
};

// ─── L1 icon lookup — 45 L1 category names → emoji ───────────────────────────
// Hardcoded because L1 names are stable taxonomy roots.
// If a new L1 is added to taxonomy_nodes, add it here too.
const L1_ICONS: Record<string, string> = {
  // PRODUCTS
  'Fresh & Daily Produce':              '🥦',
  'Grocery & FMCG':                     '🛒',
  'Building & Construction':            '🏗️',
  'Electronics & Technology':           '📱',
  'Automotive Products':                '🚗',
  'Healthcare & Medical':               '💊',
  'Fashion & Apparel':                  '👗',
  'Furniture & Home':                   '🛋️',
  'Personal Care Products':             '🧴',
  'Cleaning & Household':               '🧹',
  'Agriculture & Farming':              '🌾',
  'Sports & Fitness':                   '⚽',
  'Gifts & Occasions':                  '🎁',
  'Pet Supplies':                       '🐾',
  'New & Emerging Brands':              '✨',
  'Stationery & Office':                '📝',
  // SERVICES
  'Home Maintenance & Repair':          '🔧',
  'Household Help':                     '🧺',
  'Personal Care & Grooming':           '✂️',
  'Education & Tutoring':               '📚',
  'Events & Celebrations':              '🎉',
  'Transport & Logistics':              '🚚',
  'IT & Digital Services':              '💻',
  'Wellness & Fitness':                 '🧘',
  'Pet Services':                       '🐕',
  'Other Services':                     '🔩',
  // EXPERTISE
  'Legal Services':                     '⚖️',
  'Financial & Accounting':             '💰',
  'Medical Specialists':                '🩺',
  'Architecture & Design':              '📐',
  'Mental Health & Counselling':        '🧠',
  'Business & Management Consulting':   '📊',
  'Technology Consulting':              '🖥️',
  // ESTABLISHMENTS
  'Food & Beverage':                    '🍽️',
  'Daily Needs':                        '🏪',
  'Healthcare':                         '🏥',
  'Education':                          '🎓',
  'Retail':                             '🛍️',
  'Service Establishments':             '🏢',
  'Transport & Fuel':                   '⛽',
  'Vehicle Repair':                     '🔨',
  'Neighbourhood Services':             '🏘️',
  'Health & Wellness':                  '💆',
  'Pet & Nature':                       '🌿',
  'Travel & Local Services':            '✈️',
};

// ─── Translation maps — raw DB values → human-readable mobile labels ─────────
// Mobile never sees raw DB values like 'home_visit', 'Mandatory', 'saved_home'.

const SERVICE_AREA_LABEL: Record<string, string> = {
  delivery:       'Delivered to you',
  home_visit:     'Comes to your home',
  fixed_location: 'Visit their shop',
  remote:         'Online / phone',
};

const GEO_LABEL: Record<string, string> = {
  current_location: 'Near you now',
  saved_home:       'At your home address',
  remote:           'Online — no location needed',
  either:           'Near you or at home',
};

const VERIFICATION_LABEL: Record<string, string> = {
  Mandatory: 'Licence verified',
  Optional:  'Verification available',
  No:        'No licence required',
};

function slotLabel(minutes: number | null): string {
  if (!minutes || minutes === 0) return 'On-demand — no booking';
  if (minutes < 60) return `~${minutes} min session`;
  if (minutes === 60) return '~1 hour session';
  return `~${(minutes / 60).toFixed(1).replace('.0', '')} hour session`;
}

// ─── getCategories ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/categories?tab=products|services|expertise|establishments
 *
 * Returns L1 category groups with icon + color for the HomeScreen grid.
 * Uses $queryRaw to read icon_emoji + hex_color (added in V048, not in schema.prisma).
 * Cache key: categories:v2:${tab} — v2 includes icon + color in response shape.
 */
export const getCategories = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { tab } = req.query as { tab?: string };

  if (!tab || !VALID_TABS.includes(tab as SearchTab)) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_TAB',
        message: `tab must be one of: ${VALID_TABS.join(', ')}`,
      },
    });
    return;
  }

  const cacheKey = `categories:v2:${tab}`;

  const cached = await redisGet<object>(cacheKey);
  if (cached) {
    logger.info('categories.cache.hit');
    res.set('Cache-Control', `public, max-age=${CATEGORIES_HTTP_CACHE_SECONDS}, stale-while-revalidate=60`);
    res.status(200).json({ success: true, data: cached, meta: { from_cache: true } });
    return;
  }

  logger.info('categories.cache.miss');

  type NodeRow = {
    id: string;
    l1: string;
    l2: string | null;
    l3: string | null;
    l4: string | null;
    sort_order: number;
    icon_emoji: string | null;
    icon_emoji_l3: string | null;
    hex_color: string | null;
  };

  // ── Run DB query + OpenSearch agg IN PARALLEL (PERF-02 fix) ───────────────
  // Previously sequential: DB → await OS → res.json (~200-400ms blocked).
  // Now parallel: both fire simultaneously, response is built when both resolve.
  // OS agg is non-fatal — categories still serve without provider_count if OS fails.
  const [nodes, osCountMap] = await Promise.all([
    prisma.$queryRaw<NodeRow[]>`
      SELECT id, l1, l2, l3, l4, sort_order, icon_emoji, icon_emoji_l3, hex_color
      FROM taxonomy_nodes
      WHERE tab::text = ${tab}
        AND is_active = true
      ORDER BY sort_order ASC, l1 ASC, l4 ASC
    `,
    (async (): Promise<Record<string, number>> => {
      try {
        const osClient = getOpenSearchClient();
        const aggResponse = await osClient.search({
          index: OPENSEARCH_INDEX,
          body: {
            size: 0,
            query: { bool: { filter: [{ term: { is_active: true } }, { term: { tab } }] } },
            aggs: { by_l1: { terms: { field: 'taxonomy_l1', size: 100 } } },
          },
        });
        const buckets: Array<{ key: string; doc_count: number }> =
          aggResponse.body.aggregations?.by_l1?.buckets ?? [];
        const map: Record<string, number> = {};
        for (const b of buckets) map[b.key] = b.doc_count;
        return map;
      } catch (osErr) {
        logger.warn('categories.opensearch.agg.failed', { error: (osErr as Error).message });
        return {};
      }
    })(),
  ]);

  // Group taxonomy nodes by l1
  const grouped: Record<string, {
    color: string | null;
    children: Array<{ id: string; l2: string | null; l3: string | null; l4: string | null; icon: string | null; }>;
  }> = {};

  for (const node of nodes) {
    const key = node.l1 ?? 'Other';
    if (!grouped[key]) grouped[key] = { color: node.hex_color ?? null, children: [] };
    grouped[key].children.push({
      id:   node.id,
      l2:   node.l2,
      l3:   node.l3,
      l4:   node.l4 ?? null,
      icon: (node.l3 ? node.icon_emoji_l3 : node.icon_emoji) ?? null,
    });
  }

  const data = {
    tab,
    groups: Object.entries(grouped).map(([l1, { color, children }]) => ({
      l1,
      icon:           L1_ICONS[l1] ?? '📦',
      color:          color ?? '#6B6560',
      children,
      provider_count: osCountMap[l1] ?? 0,
    })),
  };

  void redisSet(cacheKey, data, CATEGORIES_CACHE_TTL_SECONDS);

  res.set('Cache-Control', `public, max-age=${CATEGORIES_HTTP_CACHE_SECONDS}, stale-while-revalidate=60`);
  res.status(200).json({ success: true, data, meta: { from_cache: false } });
};

// ─── getCategoriesL2 ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/categories/l2?tab=products&l1=Fresh+%26+Daily+Produce
 *
 * Returns distinct L2 groups under a given L1 with icon + child_count.
 * Cached in Redis 24h per tab+l1 key.
 */
export const getCategoriesL2 = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { tab, l1 } = req.query as { tab?: string; l1?: string };

  if (!tab || !VALID_TABS.includes(tab as SearchTab)) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_TAB', message: `tab must be one of: ${VALID_TABS.join(', ')}` },
    });
    return;
  }
  if (!l1 || l1.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'l1 query parameter is required' },
    });
    return;
  }

  const cacheKey = `categories:v2:l2:${tab}:${l1}`;
  const cached = await redisGet<object>(cacheKey);
  if (cached) {
    res.set('Cache-Control', `public, max-age=${CATEGORIES_HTTP_CACHE_SECONDS}, stale-while-revalidate=60`);
    res.status(200).json({ success: true, data: cached, meta: { from_cache: true } });
    return;
  }

  type L2Row = { l2: string; icon_emoji: string | null; child_count: bigint; };

  const rows = await prisma.$queryRaw<L2Row[]>`
    SELECT
      l2,
      MAX(icon_emoji) AS icon_emoji,
      COUNT(*) AS child_count
    FROM taxonomy_nodes
    WHERE tab::text = ${tab}
      AND l1 = ${l1}
      AND is_active = true
      AND l2 IS NOT NULL
    GROUP BY l2
    ORDER BY l2 ASC
  `;

  const data = {
    tab,
    l1,
    groups: rows.map(r => ({
      l2:          r.l2,
      icon:        r.icon_emoji ?? '📦',
      child_count: Number(r.child_count),
    })),
  };

  void redisSet(cacheKey, data, CATEGORIES_CACHE_TTL_SECONDS);
  res.set('Cache-Control', `public, max-age=${CATEGORIES_HTTP_CACHE_SECONDS}, stale-while-revalidate=60`);
  res.status(200).json({ success: true, data, meta: { from_cache: false } });
};

// ─── getCategoriesL3 ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/categories/l3?tab=products&l1=Fresh+%26+Daily+Produce&l2=Vegetables
 *
 * Returns distinct L3 groups with their L4 leaf nodes + taxonomy characteristics.
 * All raw DB values are translated to human-readable labels before sending to mobile.
 * Cached in Redis 24h per tab+l1+l2 key.
 */
export const getCategoriesL3 = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { tab, l1, l2 } = req.query as { tab?: string; l1?: string; l2?: string };

  if (!tab || !VALID_TABS.includes(tab as SearchTab)) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_TAB', message: `tab must be one of: ${VALID_TABS.join(', ')}` },
    });
    return;
  }
  if (!l1 || l1.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'l1 query parameter is required' },
    });
    return;
  }
  if (!l2 || l2.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'l2 query parameter is required' },
    });
    return;
  }

  const cacheKey = `categories:v2:l3:${tab}:${l1}:${l2}`;
  const cached = await redisGet<object>(cacheKey);
  if (cached) {
    res.set('Cache-Control', `public, max-age=${CATEGORIES_HTTP_CACHE_SECONDS}, stale-while-revalidate=60`);
    res.status(200).json({ success: true, data: cached, meta: { from_cache: true } });
    return;
  }

  type L3Row = {
    id: string;
    l3: string | null;
    l4: string | null;
    icon_emoji: string | null;
    icon_emoji_l3: string | null;
    pricing_model: string | null;
    price_unit: string | null;
    verification_gate: string | null;
    provider_service_area: string | null;
    geo_search_default: string | null;
    default_slot_minutes: number | null;
  };

  const rows = await prisma.$queryRaw<L3Row[]>`
    SELECT
      id, l3, l4, icon_emoji, icon_emoji_l3, icon_emoji_l3, icon_emoji_l3,
      pricing_model, price_unit, verification_gate,
      provider_service_area, geo_search_default, default_slot_minutes
    FROM taxonomy_nodes
    WHERE tab::text = ${tab}
      AND l1 = ${l1}
      AND l2 = ${l2}
      AND is_active = true
    ORDER BY l3 ASC, l4 ASC
  `;

  // Group by l3 — collect L4 leaf nodes with translated taxonomy fields
  const grouped: Record<string, {
    icon: string | null;
    leaves: Array<{
      id: string;
      l4: string;
      serviceType: string;
      pricingModel: string | null;
      priceUnit: string | null;
      verificationLabel: string;
      locationLabel: string;
      slotLabel: string;
    }>;
  }> = {};

  for (const row of rows) {
    if (!row.l3 || !row.l4) continue;
    if (!grouped[row.l3]) {
      grouped[row.l3] = { icon: row.icon_emoji_l3 ?? row.icon_emoji ?? null, leaves: [] };
    }
    grouped[row.l3].leaves.push({
      id:                row.id,
      l4:                row.l4,
      serviceType:       SERVICE_AREA_LABEL[row.provider_service_area ?? ''] ?? 'Service available',
      pricingModel:      row.pricing_model ?? null,
      priceUnit:         row.price_unit ?? null,
      verificationLabel: VERIFICATION_LABEL[row.verification_gate ?? ''] ?? 'No licence required',
      locationLabel:     GEO_LABEL[row.geo_search_default ?? ''] ?? 'Location based',
      slotLabel:         slotLabel(row.default_slot_minutes ?? null),
    });
  }

  const data = {
    tab, l1, l2,
    groups: Object.entries(grouped).map(([l3, { icon, leaves }]) => ({
      l3,
      icon: icon ?? '📦',
      leaves,
    })),
  };

  void redisSet(cacheKey, data, CATEGORIES_CACHE_TTL_SECONDS);
  res.set('Cache-Control', `public, max-age=${CATEGORIES_HTTP_CACHE_SECONDS}, stale-while-revalidate=60`);
  res.status(200).json({ success: true, data, meta: { from_cache: false } });
};

// ─── getProviderProfile ───────────────────────────────────────────────────────

/**
 * GET /api/v1/providers/:id
 *
 * Public provider profile. No auth required.
 * Returns provider_profiles JOIN trust_scores.
 */
export const getProviderProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const { id } = req.params;

  if (!id || typeof id !== 'string') {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'provider id is required' },
    });
    return;
  }

  const profileCacheKey = `provider:profile:${id}`;
  logger.info('provider.profile.fetch');

  // findUnique on primary key is O(1) index scan (faster than findFirst)
  const provider = await prisma.providerProfile.findUnique({
    where: { id },
    select: {
      id: true,
      display_name: true,
      bio: true,
      profile_photo_s3_key: true,
      taxonomy_node: {
        select: {
          id: true,
          l1: true,
          l2: true,
          l3: true,
          l4: true,
          tab: true,
          display_name: true,
        },
      },
      slot_calendar_enabled: true,
      area: { select: { name: true } },
      city_id: true,
      city: { select: { name: true, state: true } },
      availability: true,
      home_visit_available: true,
      is_claimed: true,
      is_scrape_record: true,
      is_phone_verified: true,
      is_aadhaar_verified: true,
      is_geo_verified: true,
      has_credentials: true,
      listing_type: true,
      tab: true,
      is_active: true,
      created_at: true,
      phone: true,
      whatsapp_phone: true,
      languages_spoken: true,
      years_experience: true,
      address_line: true,
      trust_score_record: {
        select: {
          display_score: true,
          trust_tier: true,
          rating_count: true,
          customer_voice_weight: true,
          signal_breakdown: true,
          last_calculated_at: true,
        },
      },
      _count: {
        select: {
          contact_events: true,
        },
      },
    },
  });

  if (!provider || !provider.is_active) {
    throw new AppError('PROVIDER_NOT_FOUND', 'Provider not found', 404);
  }
  // DPDP: reject if owner account is soft-deleted
  // Note: user relation must be included in select for this check
  // (omitted for now — will be added when user select is confirmed)

  const data = {
    id:                   provider.id,
    // camelCase for mobile ProviderProfileScreen
    displayName:          provider.display_name,
    bio:                  provider.bio,
    photoUrl:             provider.profile_photo_s3_key,
    category:             provider.taxonomy_node?.display_name ?? null,
    city:                 provider.city?.name ?? null,
    cityId:               provider.city_id,
    availability:         provider.availability,
    homeVisitAvailable:   provider.home_visit_available,
    isClaimed:            provider.is_claimed,
    isScrapeRecord:       provider.is_scrape_record,
    isPhoneVerified:      provider.is_phone_verified,
    isAadhaarVerified:    provider.is_aadhaar_verified,
    isGeoVerified:        provider.is_geo_verified,
    listingType:          provider.listing_type,
    tab:                  provider.tab,
    isActive:             provider.is_active,
    contactCount:         provider._count?.contact_events ?? 0,
    // snake_case aliases for any callers using old contract
    display_name:         provider.display_name,
    profile_photo_s3_key: provider.profile_photo_s3_key,
    taxonomyNode:         provider.taxonomy_node,
    city_id:              provider.city_id,
    home_visit_available: provider.home_visit_available,
    is_claimed:           provider.is_claimed,
    is_scrape_record:     provider.is_scrape_record,
    is_phone_verified:    provider.is_phone_verified,
    is_aadhaar_verified:  provider.is_aadhaar_verified,
    is_geo_verified:      provider.is_geo_verified,
    listing_type:         provider.listing_type,
    is_active:            provider.is_active,
    trust: provider.trust_score_record
      ? {
          // camelCase for mobile ProviderProfileScreen
          displayScore:       provider.trust_score_record.display_score,
          trustTier:          provider.trust_score_record.trust_tier,
          ratingCount:        provider.trust_score_record.rating_count,
          customerVoiceWeight: provider.trust_score_record.customer_voice_weight ?? 0,
          verificationWeight:  1 - (provider.trust_score_record.customer_voice_weight ?? 0),
          signalBreakdown:    provider.trust_score_record.signal_breakdown,
          lastCalculatedAt:   provider.trust_score_record.last_calculated_at,
          // snake aliases for legacy reads
          display_score:      provider.trust_score_record.display_score,
          trust_tier:         provider.trust_score_record.trust_tier,
          rating_count:       provider.trust_score_record.rating_count,
          // certificate fields — populated by certificate join if available
          has_certificate:     false,
          certificate_id:      null,
          peer_context_percentage: 0,
        }
      : null,
    created_at: provider.created_at,
    // Added fields for mobile ProviderProfileScreen contract
    photo_url:          provider.profile_photo_s3_key ?? null,
    phone:              provider.phone ?? null,
    whatsapp_phone:     provider.whatsapp_phone ?? null,
    address_line:       provider.address_line ?? null,
    area:               provider.area?.name ?? null,
    has_calendar:       provider.slot_calendar_enabled ?? false,
    distance_km:        null,
    experience_years:   provider.years_experience ?? null,
    languages:          (provider.languages_spoken as string[]) ?? [],
    rating_avg:         0,
    famous_for:         null,
    geo_confirmed:      provider.is_geo_verified,
    aadhaar_verified:   provider.is_aadhaar_verified,
    credential_verified: provider.has_credentials ?? false,
    otp_verified:       provider.is_phone_verified,
  };

  // Cache for 5 minutes — fire-and-forget
  void redisSet(profileCacheKey, data, 5 * 60);

  res.set('Cache-Control', 'no-store, no-cache');
  res.status(200).json({ success: true, data });
};

// ─── getAvailabilityChanges ───────────────────────────────────────────────────

/**
 * GET /api/v1/search/availability-changes?since=ISO
 *
 * Returns providers whose availability changed after the `since` ISO timestamp.
 * Used by WebSocket reconnection catch-up to reconcile missed events.
 * Queries OpenSearch (real-time) not PostgreSQL.
 */
export const getAvailabilityChanges = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const correlationId = req.headers['x-correlation-id'] as string;
  const { since } = req.query as { since?: string };

  if (!since) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'since query parameter is required (ISO 8601 timestamp)',
      },
    });
    return;
  }

  // Validate ISO timestamp
  const sinceDate = new Date(since);
  if (isNaN(sinceDate.getTime())) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'since must be a valid ISO 8601 timestamp',
      },
    });
    return;
  }

  logger.info('availability.changes.fetch');

  const osClient = getOpenSearchClient();

  // Query OpenSearch for docs whose availability_updated_at > since
  const response = await osClient.search({
    index: OPENSEARCH_INDEX,
    body: {
      size: 500, // Reconnect window — bounded by connectionStateRecovery 2-min window
      query: {
        range: {
          availability_updated_at: {
            gt: sinceDate.toISOString(),
          },
        },
      },
      _source: [
        'provider_id',
        'is_available',
        'availability_mode',
        'availability_updated_at',
        'city_id',
      ],
      sort: [{ availability_updated_at: { order: 'asc' } }],
    },
  });

  const hits = response.body.hits.hits as any[];
  const changes = hits.map((hit: any) => ({
    providerId: hit._source.provider_id,
    isAvailable: hit._source.is_available,
    availabilityMode: hit._source.availability_mode,
    availability_updated_at: hit._source.availability_updated_at,
    cityId: hit._source.city_id,
  }));

  logger.info('availability.changes.result');

  res.set('Cache-Control', 'no-store, no-cache');
  res.status(200).json({
    success: true,
    data: {
      since,
      changes,
      count: changes.length,
    },
  });
};

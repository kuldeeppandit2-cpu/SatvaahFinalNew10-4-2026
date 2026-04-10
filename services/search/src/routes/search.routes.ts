// services/search/src/routes/search.routes.ts
//
// Search routes:
//   GET  /api/v1/search                          — expanding ring search
//   GET  /api/v1/search/suggest                  — taxonomy autocomplete
//   POST /api/v1/search/intent                   — internal async intent capture
//   GET  /api/v1/search/intents/nearby           — provider dashboard hero moment
//   GET  /api/v1/search/availability-changes      — WebSocket reconnect catch-up

import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { rateLimiter, requireAuth } from '@satvaaah/middleware';
import { asyncHandler } from '@satvaaah/middleware';
import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';
import {
  searchProviders,
  suggestQuery,
  captureIntent,
  getAvailabilityChanges,
} from '../controllers/search.controller';

const router = Router();

// ── GET /api/v1/search ────────────────────────────────────────────────────────
// No auth required — search is fully public.
// Params: q, tab, lat, lng, page, ring_km (optional, for pagination), location_name
// Tighter limit than global: 30/min — prevents bulk provider harvesting
const searchLimiter = rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'rl:search:q:' });
router.get('/search', searchLimiter, asyncHandler(searchProviders));

// ── GET /api/v1/search/suggest ────────────────────────────────────────────────
// No auth required.
// Params: q (min 2 chars per system_config), tab (optional)
// Returns taxonomy_nodes only — NEVER raw provider names.
router.get('/search/suggest', asyncHandler(suggestQuery));

// ── POST /api/v1/search/intent ────────────────────────────────────────────────
// Internal endpoint. Secured by INTERNAL_SERVICE_KEY.
// Returns 202 immediately; insert is async / fire-and-forget.
// Body: { user_id, taxonomy_node_id, lat, lng }
router.post(
  '/search/intent',
  internalAuth,
  asyncHandler(captureIntent),
);

// ── GET /api/v1/search/availability-changes ───────────────────────────────────
// No auth required — used by WebSocket reconnect logic in the client.
// Params: since (ISO 8601 timestamp)
router.get(
  '/search/availability-changes',
  asyncHandler(getAvailabilityChanges),
);

// ── GET /api/v1/search/intents/nearby ────────────────────────────────────────
// Authenticated — provider-only endpoint (requireAuth).
// Returns aggregated count of active search intents within 10km of provider location.
// Powers the "6 people searched for plumbers near Banjara Hills" hero moment in
// CreateProfileStep2Screen and ProviderDashboardScreen.
// Params: lat, lng, tab (optional)
// Response: Array<{ id, category, area, search_count, window_minutes }>
router.get(
  '/search/intents/nearby',
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { lat, lng, tab } = req.query as { lat?: string; lng?: string; tab?: string };

    if (!lat || !lng) {
      throw new AppError('VALIDATION_ERROR', 'lat and lng are required', 400);
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      throw new AppError('VALIDATION_ERROR', 'lat and lng must be valid numbers', 400);
    }

    // Find active search intents within 10km using PostGIS ST_Distance
    // Group by taxonomy_node to get per-category counts
    const RADIUS_METRES = 10_000;
    const WINDOW_MINUTES = 10;
    const windowSince = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

    const intents = await prisma.$queryRaw<Array<{
      taxonomy_node_id: string;
      display_name: string;
      tab: string | null;
      search_count: bigint;
    }>>`
      SELECT
        si.taxonomy_node_id,
        COALESCE(tn.l4, tn.l3, tn.l2, tn.l1, 'Other') AS display_name,
        si.tab,
        COUNT(*) AS search_count
      FROM search_intents si
      LEFT JOIN taxonomy_nodes tn ON tn.id = si.taxonomy_node_id
      WHERE
        si.searched_at >= ${windowSince}
        AND si.user_dismissed_at IS NULL
        AND (si.expiry_at IS NULL OR si.expiry_at > NOW())
        AND ST_Distance(
          ST_SetSRID(ST_MakePoint(si.lng, si.lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${lngNum}, ${latNum}), 4326)::geography
        ) <= ${RADIUS_METRES}
        ${tab ? prisma.$queryRaw`AND si.tab = ${tab}::\"Tab\"` : prisma.$queryRaw``}
      GROUP BY si.taxonomy_node_id, display_name, si.tab
      ORDER BY search_count DESC
      LIMIT 10
    `;

    const result = intents.map((row) => ({
      id:             row.taxonomy_node_id ?? 'unknown',
      category:       row.display_name,
      area:           'your area',
      search_count:   Number(row.search_count),
      window_minutes: WINDOW_MINUTES,
    }));

    logger.info('search.intents.nearby', { lat: latNum, lng: lngNum, tab, count: result.length });

    res.json({ success: true, data: result });
  }),
);

export default router;

// ─── internalAuth ─────────────────────────────────────────────────────────────
// Lightweight internal service key guard.
// Mirrors the pattern used in Phase 6 auth service and Phase 7 verification.
// Full middleware extraction to @satvaaah/middleware is a future refactor.

function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-internal-key'] as string | undefined;
  const expected = process.env.INTERNAL_SERVICE_KEY;

  if (!expected) {
    // Misconfiguration — block all internal calls until key is set
    res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_MISCONFIGURED',
        message: 'INTERNAL_SERVICE_KEY is not configured',
      },
    });
    return;
  }

  // Use constant-time comparison to prevent timing attacks
  const keyBuf      = Buffer.from(key ?? '');
  const expectedBuf = Buffer.from(expected);
  const keysMatch   = keyBuf.length === expectedBuf.length
    && timingSafeEqual(keyBuf, expectedBuf);

  if (!key || !keysMatch) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid x-internal-key header',
      },
    });
    return;
  }

  next();
}

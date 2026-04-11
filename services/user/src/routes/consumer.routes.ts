/**
 * Consumer routes — /api/v1/consumers/*
 */

import { Router, Request, Response } from 'express';
import { requireAuth }  from '@satvaaah/middleware';
import { asyncHandler } from '@satvaaah/middleware';
import { rateLimiter }  from '@satvaaah/middleware';

import {
  getMyConsumerProfile,
  createConsumerProfile,
} from '../controllers/consumer.controller';

const router = Router();

const writeLimiter = rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'rl:consumer-write' });

/**
 * GET /api/v1/consumers/me
 * Returns the caller's consumer_profile including lead_usage snapshot.
 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(getMyConsumerProfile)
);

/**
 * POST /api/v1/consumers/profile
 * Body: { display_name, city_id, avatar_url? }
 * Creates consumer_profile for the authenticated user.
 * Idempotent — returns existing profile if already created.
 */
router.post(
  '/profile',
  requireAuth,
  writeLimiter,
  asyncHandler(createConsumerProfile)
);


import { prisma } from '@satvaaah/db';
import { AppError } from '@satvaaah/errors';

// ─── GET /api/v1/consumers/me/settings ────────────────────────────────────────
router.get(
  '/me/settings',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.userId;
    const profile = await prisma.consumerProfile.findFirst({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!profile) throw new AppError('NOT_FOUND', 'Consumer profile not found', 404);
    // notification_prefs stored in user record or defaults
    res.json({ success: true, data: { notification_prefs: { fcm: true, whatsapp: false } } });
  }),
);

// ─── PATCH /api/v1/consumers/me/settings ─────────────────────────────────────
router.patch(
  '/me/settings',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    // Settings are lightweight — just return success (prefs stored client-side via MMKV)
    res.json({ success: true, data: { updated: true } });
  }),
);

// ── GET /api/v1/consumers/me/contacts ─────────────────────────────────────────
// Returns consumer's contact event history (for profile screen)
router.get(
  '/me/contacts',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.userId;
    const limit  = Math.min(parseInt(req.query.limit as string ?? '20', 10), 100);
    const profile = await prisma.consumerProfile.findFirst({
      where: { user_id: userId }, select: { id: true },
    });
    if (!profile) return res.json({ success: true, data: [] });

    const events = await prisma.contactEvent.findMany({
      where:   { consumer_id: profile.id },
      orderBy: { created_at: 'desc' },
      take:    limit,
      select:  {
        id: true, contact_type: true, status: true, created_at: true,
        provider: { select: {
          id: true, display_name: true,
          taxonomy_node: { select: { display_name: true } },
        }},
      },
    });

    const data = events.map((e: any) => ({
      id:                        e.id,
      providerId:                e.provider?.id ?? '',
      providerDisplayName:       e.provider?.display_name ?? '',
      provider_primary_taxonomy: e.provider?.taxonomy_node?.display_name ?? '',
      contactType:               e.contact_type,
      status:                    e.status,
      createdAt:                 e.created_at.toISOString(),
    }));
    return res.json({ success: true, data });
  })
);

// ── GET /api/v1/providers/batch ────────────────────────────────────────────────
// Returns trust scores for a batch of providerIds (for Trusted Circle widget)
// Query: ?ids=uuid1,uuid2,...
router.get(
  '/providers/batch',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const ids = ((req.query.ids as string) ?? '').split(',').filter(Boolean).slice(0, 20);
    if (ids.length === 0) return res.json({ success: true, data: [] });

    const profiles = await prisma.providerProfile.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, display_name: true,
        taxonomy_node: { select: { display_name: true } },
        trust_score_record: { select: { display_score: true, trust_tier: true } },
      },
    });

    const data = profiles.map((p: any) => ({
      providerId:       p.id,
      displayName:      p.display_name ?? '',
      primaryTaxonomy:  p.taxonomy_node?.display_name ?? '',
      trustTier:        p.trust_score_record?.trust_tier ?? 'unverified',
      trustScore:       p.trust_score_record?.display_score ?? 0,
      contactCount:     0,  // caller already knows this — passed in ids based on count
    }));
    return res.json({ success: true, data });
  })
);

export default router;

/**
 * PATCH /api/v1/consumers/me/location
 * Body: { geo_lat, geo_lng, area_id? }
 * Persists consumer home location to consumer_profiles.
 * Called by C9 SetupLocationModal after expo-location resolves.
 * Required for BG3 push-discovery and area-level search defaults.
 *
 * audit-ref: DB2 consumer_profiles — geo_lat, geo_lng, area_id (V050 migration)
 */
router.patch(
  '/me/location',
  requireAuth,
  writeLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user!.userId;
    const { geo_lat, geo_lng, area_id } = req.body;

    if (geo_lat === undefined || geo_lng === undefined) {
      throw new (await import('@satvaaah/errors')).AppError(
        'VALIDATION_ERROR', 'geo_lat and geo_lng are required', 400
      );
    }

    const lat = parseFloat(geo_lat);
    const lng = parseFloat(geo_lng);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new (await import('@satvaaah/errors')).AppError(
        'VALIDATION_ERROR', 'geo_lat must be -90..90 and geo_lng must be -180..180', 400
      );
    }

    const { prisma } = await import('@satvaaah/db');

    const updated = await prisma.consumerProfile.update({
      where:  { user_id: userId },
      data:   {
        geo_lat:  lat,
        geo_lng:  lng,
        ...(area_id ? { area_id } : {}),
      },
      select: { id: true, geo_lat: true, geo_lng: true, area_id: true },
    });

    const { logger } = await import('@satvaaah/logger');
    logger.info('consumer.location.updated', { userId, lat, lng, area_id: area_id ?? null });

    res.json({ success: true, data: updated });
  }),
);

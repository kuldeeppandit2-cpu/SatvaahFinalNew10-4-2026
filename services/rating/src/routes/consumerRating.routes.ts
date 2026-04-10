/**
 * SatvAAh — services/rating/src/routes/consumerRating.routes.ts
 *
 * POST /api/v1/consumer-ratings   — provider rates consumer after accepted contact_event
 * GET  /api/v1/consumers/me/trust — consumer views own trust score + 6 signals
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '@satvaaah/middleware';
import { asyncHandler } from '@satvaaah/middleware';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';
import { z } from 'zod';
import { submitConsumerRating, getConsumerTrust } from '../services/consumerTrustService';

const router = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ConsumerRatingSchema = z.object({
  consumerId:      z.string().uuid('consumer_id must be a valid UUID'),
  contactEventId: z.string().uuid('contact_event_id must be a valid UUID'),
  overallStars:    z.number().int().min(1).max(5),
  review_text:      z.string().max(500).optional(),
});

// ── GET /api/v1/consumer-ratings/eligibility/:contactEventId ────────────────────
// Provider checks if they can rate a consumer for a given contact event
router.get(
  '/consumer-ratings/eligibility/:contactEventId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const callerUserId   = req.user!.userId;
    const contactEventId = req.params.contactEventId;
    const { prisma } = await import('@satvaaah/db');
    const event = await prisma.contactEvent.findUnique({
      where: { id: contactEventId },
      select: { consumer_id: true, provider_id: true, status: true },
    });
    if (!event) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    const provider = await prisma.providerProfile.findFirst({
      where: { user_id: callerUserId }, select: { id: true },
    });
    if (!provider || event.provider_id !== provider.id) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
    }
    return res.status(200).json({ success: true, data: { eligible: event.status === 'accepted' } });
  })
);

// ── POST /api/v1/consumer-ratings ─────────────────────────────────────────────
// Provider → rates consumer after an accepted contact_event.
// Updates consumer_profiles.trust_score via SQS (Lambda recalculates).

router.post(
  '/consumer-ratings',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = ConsumerRatingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', parsed.error.errors[0].message, 400);
    }

    // callerUserId is the JWT sub — must be a registered provider
    const callerUserId  = req.user!.userId;
    const correlationId = req.headers['x-correlation-id'] as string ?? '';
    const { consumerId, contactEventId, overallStars, review_text } = parsed.data;

    logger.info('rating.route.event');

    // consumerId can be omitted — service derives it from contactEventId
    const result = await submitConsumerRating({
      callerUserId,
      consumerId:     consumerId ?? '',
      contactEventId,
      overallStars,
      reviewText: review_text,
      correlationId,
    });

    return res.status(201).json({ success: true, data: result });
  })
);

// ── GET /api/v1/consumers/me/trust ────────────────────────────────────────────
// Consumer trust score (starts 75) + 6 signal breakdown.
// Authoritative score from consumer_profiles.trust_score (set by Lambda).
// Signal breakdown computed live for display.

router.get(
  '/consumers/me/trust',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const consumerId    = req.user!.userId;
    const correlationId = req.headers['x-correlation-id'] as string ?? '';

    logger.info('rating.route.event');

    const trustData = await getConsumerTrust(consumerId, correlationId);
    return res.status(200).json({ success: true, data: trustData });
  })
);

export default router;

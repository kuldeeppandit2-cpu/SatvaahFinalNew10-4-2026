/**
 * SatvAAh — services/rating/src/routes/dispute.routes.ts
 *
 * POST /api/v1/ratings/:id/flag
 *
 * Access: provider only — must be the provider whose listing was rated.
 *
 * What happens:
 *   rating.moderationStatus → HELD       (weight contribution frozen)
 *   rating.weightValue      → 0.1        (system_config: rating_held_weight)
 *   trust_flag row created  → admin queue
 *   SQS trust-score-updates → Lambda recalculates provider score immediately
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '@satvaaah/middleware';
import { asyncHandler } from '@satvaaah/middleware';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';
import { z } from 'zod';
import { flagRating } from '../services/disputeService';

const router = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const FlagParamsSchema = z.object({
  id: z.string().uuid('Rating ID must be a valid UUID'),
});

const FlagBodySchema = z.object({
  reason: z.enum(
    ['fake_review', 'competitor', 'blackmail', 'wrong_provider', 'abusive_content', 'other'],
    {
      errorMap: () => ({
        message:
          'reason must be one of: fake_review, competitor, blackmail, wrong_provider, abusive_content, other',
      }),
    }
  ),
  evidence_notes: z.string().max(500).optional(),
});

// ── POST /api/v1/ratings/:id/flag ─────────────────────────────────────────────

router.post(
  '/ratings/:id/flag',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const paramsResult = FlagParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      throw new AppError('VALIDATION_ERROR', paramsResult.error.errors[0].message, 400);
    }

    const bodyResult = FlagBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      throw new AppError('VALIDATION_ERROR', bodyResult.error.errors[0].message, 400);
    }

    // callerUserId is the JWT sub — must be a provider whose profile was rated
    const callerUserId  = req.user!.userId;
    const correlationId = req.headers['x-correlation-id'] as string ?? '';
    const { id: ratingId } = paramsResult.data;
    const { reason, evidence_notes } = bodyResult.data;

    logger.info('rating.route.event');

    const result = await flagRating({
      ratingId,
      callerUserId,
      reason,
      evidenceNotes: evidence_notes,
      correlationId,
    });

    return res.status(200).json({ success: true, data: result });
  })
);

export default router;

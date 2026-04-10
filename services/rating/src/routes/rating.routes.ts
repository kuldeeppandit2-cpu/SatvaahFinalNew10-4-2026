/**
 * SatvAAh — services/rating/src/routes/rating.routes.ts
 *
 * GET  /api/v1/ratings/eligibility/:providerId
 *   Returns { eligible, reason?, daily_remaining, tab? }
 *   Pre-flight check without running the full pipeline.
 *
 * POST /api/v1/ratings
 *   Runs the full 10-step moderation pipeline then inserts rating.
 *   Returns { rating_id, weight_type, moderation_status, bonus_leads_granted }
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '@satvaaah/middleware';
import { asyncHandler } from '@satvaaah/middleware';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';
import { z } from 'zod';
import { getRatingEligibility, submitRating } from '../services/ratingService';

const router = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const EligibilityParamsSchema = z.object({
  providerId: z.string().uuid('providerId must be a valid UUID'),
});

const SubmitRatingSchema = z.object({
  providerId:       z.string().uuid('provider_id must be a valid UUID'),
  contactEventId:  z.string().uuid().optional().nullable(),
  overallStars:     z.number().int().min(1).max(5),
  text:              z.string().max(1000).optional(),
  dimensions:        z.record(z.string(), z.number().min(1).max(5)).optional(),
});

// ── POST /api/v1/ratings/photo-upload-url ────────────────────────────────────
// Returns a pre-signed S3 PUT URL for rating photo uploads.
router.post(
  '/ratings/photo-upload-url',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { content_type = 'image/jpeg' } = req.body;
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED.includes(content_type)) {
      throw new AppError('VALIDATION_ERROR', 'content_type must be image/jpeg, image/png, or image/webp', 400);
    }
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const { v4: uuidv4 } = await import('uuid');
    const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' });
    const ext = content_type.split('/')[1];
    const s3Key = `rating-photos/${uuidv4()}.${ext}`;
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket:      process.env.S3_UPLOADS_BUCKET ?? process.env.S3_DOCUMENTS_BUCKET ?? '',
        Key:         s3Key,
        ContentType: content_type,
      }),
      { expiresIn: 600 }  // 10 minutes
    );
    return res.status(200).json({ success: true, data: { upload_url: url, s3_key: s3Key } });
  })
);

// ── GET /api/v1/ratings/eligibility/:providerId ───────────────────────────────

router.get(
  '/ratings/eligibility/:providerId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = EligibilityParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', parsed.error.errors[0].message, 400);
    }

    const userId        = req.user!.userId;
    const correlationId = req.headers['x-correlation-id'] as string ?? '';
    const { providerId } = parsed.data;

    logger.info('rating.route.event');

    const result = await getRatingEligibility(userId, providerId, correlationId);
    return res.status(200).json({ success: true, data: result });
  })
);

// ── POST /api/v1/ratings ──────────────────────────────────────────────────────

router.post(
  '/ratings',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = SubmitRatingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', parsed.error.errors[0].message, 400);
    }

    const userId        = req.user!.userId;
    const correlationId = req.headers['x-correlation-id'] as string ?? '';
    const { providerId, contactEventId, overallStars, text, dimensions } = parsed.data;

    logger.info('rating.route.event');

    const result = await submitRating({
      consumerId:      userId,
      providerId,
      contactEventId:  contactEventId ?? undefined,
      overallStars,
      text,
      dimensionsData:  dimensions,
      correlationId,
    });

    return res.status(201).json({
      success: true,
      data: {
        rating_id:            result.ratingId,
        weightType:          result.weightType,
        weightValue:         result.weightValue,
        moderationStatus:    result.moderationStatus,
        isBurstFlagged:     result.isBurstFlagged,
        bonus_leads_granted:  result.bonusLeadsGranted,
        message: result.isBurstFlagged
          ? 'Rating submitted and is under review due to high submission frequency.'
          : 'Rating submitted successfully.',
      },
    });
  })
);


// ── GET /api/v1/ratings/daily-usage?tab=products|services|expertise|establishments ──────
// Returns how many ratings the consumer has submitted today for the given tab.
// Used by mobile to show "X of N daily ratings used" UI.

router.get(
  '/ratings/daily-usage',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const tab = req.query.tab as string;
    if (!tab || !['products','services','expertise','establishments'].includes(tab)) {
      throw new AppError('VALIDATION_ERROR', 'tab must be products|services|expertise|establishments', 400);
    }
    const consumerId = (req as any).user.userId;
    const { prisma } = await import('@satvaaah/db');
    const today = new Date(); today.setUTCHours(0,0,0,0);
    const usage = await prisma.dailyRatingUsage.findUnique({
      where: { consumerId_tab_date: { consumer_id: consumerId, tab: tab as any, date: today } },
      select: { ratings_submitted: true },
    });
    res.json({ success: true, data: { tab, submitted: usage?.ratingsSubmitted ?? 0 } });
  }),
);

export default router;

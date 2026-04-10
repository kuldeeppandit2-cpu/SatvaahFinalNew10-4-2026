/**
 * Verification / misc routes — /api/v1/saved-providers + /api/v1/referrals
 * Mounted at /api/v1 in app.ts.
 */

import { Router } from 'express';
import { requireAuth }  from '@satvaaah/middleware';
import { asyncHandler } from '@satvaaah/middleware';
import { rateLimiter }  from '@satvaaah/middleware';

import {
  getSavedProviders,
  saveProvider,
  unsaveProvider,
} from '../controllers/consumer.controller';

import { applyReferral } from '../controllers/user.controller';

const router = Router();

const writeLimiter = rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'rl:saved' });

/**
 * GET /api/v1/saved-providers
 * Returns the caller's saved provider list (with basic profile info).
 */
router.get(
  '/saved-providers',
  requireAuth,
  asyncHandler(getSavedProviders)
);

/**
 * POST /api/v1/saved-providers
 * Body: { provider_id }
 * Adds a provider to the consumer's saved list.
 * Idempotent — ignores duplicate saves.
 */
router.post(
  '/saved-providers',
  requireAuth,
  writeLimiter,
  asyncHandler(saveProvider)
);

/**
 * DELETE /api/v1/saved-providers/:id
 * :id = provider_id UUID
 * Removes from saved list.
 */
router.delete(
  '/saved-providers/:id',
  requireAuth,
  writeLimiter,
  asyncHandler(unsaveProvider)
);

/**
 * POST /api/v1/referrals/apply
 * Body: { referral_code }
 * Validates code, links referrer → referred relationship,
 * notifies payment service to grant referral reward.
 */
router.post(
  '/referrals/apply',
  requireAuth,
  rateLimiter({ windowMs: 3_600_000, max: 3, keyPrefix: 'rl:referral' }),
  asyncHandler(applyReferral)
);


// ─── POST /api/v1/uploads/presigned-url ──────────────────────────────────────
// Returns an S3 pre-signed URL for direct credential document upload from mobile.
router.post(
  '/uploads/presigned-url',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { file_type, credential_type } = req.body;
    if (!file_type || !credential_type) {
      throw new AppError('VALIDATION_ERROR', 'file_type and credential_type are required', 400);
    }
    const { getPresignedUploadUrl } = await import('../services/credentialService');
    const result = await getPresignedUploadUrl({
      userId: (req as any).user.userId,
      fileType: file_type,
      credentialType: credential_type,
      correlationId: (req as any).correlationId,
    });
    res.json({ success: true, data: result });
  }),
);

export default router;

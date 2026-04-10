/**
 * User routes — /api/v1/users/*
 * Covers:
 *   PATCH  /users/me                 — update FCM token (device registration)
 *   PATCH  /users/me/mode            — switch consumer ↔ provider
 *   GET    /users/me/data-export     — DPDP Act 2023 right to access
 *   DELETE /users/me                 — soft delete + SQS anonymisation
 *   DELETE /users/me/consent/:type   — DPDP right to withdraw consent
 */

import { Router, Request, Response } from 'express';
import { requireAuth }  from '@satvaaah/middleware';
import { asyncHandler } from '@satvaaah/middleware';
import { rateLimiter }  from '@satvaaah/middleware';
import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';

import {
  switchMode,
  dataExport,
  deleteAccount,
  withdrawConsent,
} from '../controllers/user.controller';

const router = Router();

const strictLimiter = rateLimiter({ windowMs: 60_000, max: 5, keyPrefix: 'rl:user-write' });
const exportLimiter = rateLimiter({ windowMs: 3_600_000, max: 3, keyPrefix: 'rl:data-export' }); // 3 per hour
const fcmLimiter    = rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'rl:user-fcm' });

/**
 * PATCH /api/v1/users/me
 * Body: { fcm_token?: string }
 * Registers or refreshes the device FCM push token for the authenticated user.
 * Called from App.tsx on startup and whenever the token refreshes.
 * CRITICAL: All FCM notifications depend on this. Zero leads/messages delivered without it.
 */
router.patch(
  '/me',
  requireAuth,
  fcmLimiter,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user.userId;
    const { fcm_token } = req.body as { fcm_token?: string };

    if (!fcm_token || typeof fcm_token !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'fcm_token is required', 400);
    }
    if (fcm_token.length > 512) {
      throw new AppError('VALIDATION_ERROR', 'fcm_token too long', 400);
    }

    await prisma.user.update({
      where: { id: userId },
      data:  { fcm_token },
    });

    logger.info('user.fcm_token.registered', { userId });

    res.json({ success: true });
  }),
);

/**
 * PATCH /api/v1/users/me/mode
 * Body: { mode: 'consumer' | 'provider' }
 * Switches active mode; validates provider_profile exists when switching to provider.
 */
router.patch(
  '/me/mode',
  requireAuth,
  strictLimiter,
  asyncHandler(switchMode)
);

/**
 * GET /api/v1/users/me/data-export
 * DPDP Act 2023 — Right to Access personal data.
 * Returns aggregated JSON of all user-owned rows.
 * Rate-limited to 3 exports per hour.
 */
router.get(
  '/me/data-export',
  requireAuth,
  exportLimiter,
  asyncHandler(dataExport)
);

/**
 * DELETE /api/v1/users/me
 * DPDP Act 2023 — Right to Erasure.
 * Sets deleted_at = NOW() on users row (soft delete).
 * Publishes SQS anonymisation message (lambdas/anonymisation handles within 72 h).
 */
router.delete(
  '/me',
  requireAuth,
  strictLimiter,
  asyncHandler(deleteAccount)
);

/**
 * DELETE /api/v1/users/me/consent/:type
 * DPDP Act 2023 — Right to Withdraw Consent.
 * :type = 'dpdp_processing' | 'aadhaar_hash' | 'data_sharing_tsaas'
 * Sets withdrawn_at on consent_records row.
 * Does NOT delete the user — only withdraws the specific consent.
 */
router.delete(
  '/me/consent/:type',
  requireAuth,
  strictLimiter,
  asyncHandler(withdrawConsent)
);

export default router;

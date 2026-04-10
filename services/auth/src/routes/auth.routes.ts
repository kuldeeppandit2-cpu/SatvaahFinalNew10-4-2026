/**
 * auth.routes.ts — Route definitions for the auth service.
 *
 * Routes:
 *   POST /firebase/verify   → otpRateLimiter → firebaseVerify
 *   POST /token/refresh     → refreshRateLimiter → tokenRefresh
 *   POST /logout            → requireAuth → logout
 *   POST /admin/verify      → adminRateLimiter → adminVerify
 *
 * Full paths (mounted at /api/v1/auth in app.ts):
 *   POST /api/v1/auth/firebase/verify
 *   POST /api/v1/auth/token/refresh
 *   POST /api/v1/auth/logout
 *   POST /api/v1/auth/admin/verify
 */

import { Router } from 'express';
import { requireAuth, asyncHandler, rateLimiter } from '@satvaaah/middleware';
import { authController } from '../controllers/auth.controller';
import { otpRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// 10 refresh attempts per minute per IP (replay attack throttle)
const refreshRateLimiter = rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'rl:auth:refresh:' });

// 5 admin login attempts per 15 minutes per IP (brute force protection)
const adminRateLimiter = rateLimiter({ windowMs: 15 * 60_000, max: 5, keyPrefix: 'rl:auth:admin:' });

/**
 * POST /api/v1/auth/firebase/verify
 * Public. Rate limited: 5 per phone per 10 minutes (see otpRateLimiter).
 * Body: { firebaseIdToken: string, consent_given: boolean }
 * Critical Rule #21: consent_given MUST be true.
 */
router.post('/firebase/verify', otpRateLimiter, asyncHandler(authController.firebaseVerify));

/**
 * POST /api/v1/auth/token/refresh
 * Public (refresh token is the credential).
 * Rate limited: 10/min per IP (prevents replay amplification).
 * Body: { refresh_token: string }
 */
router.post('/token/refresh', refreshRateLimiter, asyncHandler(authController.tokenRefresh));

/**
 * POST /api/v1/auth/logout
 * Protected — valid access token required in Authorization header.
 * Body: { refresh_token?: string }
 */
router.post('/logout', requireAuth, asyncHandler(authController.logout));

/**
 * POST /api/v1/auth/admin/verify
 * Public. Rate limited: 5/15min per IP (brute force protection).
 * Body: { firebaseIdToken: string }
 */
router.post('/admin/verify', adminRateLimiter, asyncHandler(authController.adminVerify));

export { router as authRoutes };

/**
 * auth.controller.ts — Request/response handlers for all auth endpoints.
 *
 * Delegates all business logic to authService.
 * Handles input validation, response shaping, and HTTP status codes.
 * Errors are thrown and caught by the global errorHandler middleware.
 */

import { Request, Response } from 'express';
import { AuthError, ValidationError } from '@satvaaah/errors';
import { logger } from '@satvaaah/logger';
import { authService } from '../services/authService';

// Extended Request type — requireAuth middleware injects `user`
interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;   // set by requireAuth middleware (mapped from JWT sub)
    mode: string;
    subscriptionTier: string;
    phoneVerified: boolean;
    role?: string;
  };
}

export const authController = {
  /**
   * POST /api/v1/auth/firebase/verify
   *
   * Body: { firebaseIdToken: string, consent_given: boolean }
   *
   * Flow:
   *  1. Validate request body
   *  2. consent_given=false → 400 CONSENT_REQUIRED (Critical Rule #21)
   *  3. Delegate to authService.verifyFirebaseAndIssueTokens
   *  4. Return standard token pair response
   */
  async firebaseVerify(req: Request, res: Response): Promise<void> {
    const correlationId = req.headers['x-correlation-id'] as string | undefined;

    // Input validation
    const { firebaseIdToken, consent_given } = req.body ?? {};

    if (typeof firebaseIdToken !== 'string' || firebaseIdToken.trim().length === 0) {
      throw new ValidationError('INVALID_REQUEST', 'firebaseIdToken is required and must be a string');
    }

    // undefined, null, false, or missing all result in 400
    // consent_given must be explicitly true (Critical Rule #21)
    if (consent_given !== true) {
      throw new ValidationError(
        'CONSENT_REQUIRED',
        'You must provide consent to process your data under the DPDP Act 2023 to use SatvAAh.',
      );
    }

    const userAgent = req.headers['user-agent'] ?? 'unknown';

    const result = await authService.verifyFirebaseAndIssueTokens({
      firebaseIdToken: firebaseIdToken.trim(),
      consent_given: true,
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      userAgent,
      correlationId,
    });

    res.status(200).json({
      success: true,
      data: {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        userId: result.user_id,
        is_new_user: result.is_new_user,
      },
    });
  },

  /**
   * POST /api/v1/auth/token/refresh
   *
   * Body: { refresh_token: string }
   *
   * Flow:
   *  1. Validate refresh_token present
   *  2. Verify RS256 signature + JTI match in DB
   *  3. Rotate: delete old refresh_token, issue new pair
   */
  async tokenRefresh(req: Request, res: Response): Promise<void> {
    const { refresh_token } = req.body ?? {};

    if (typeof refresh_token !== 'string' || refresh_token.trim().length === 0) {
      throw new ValidationError('INVALID_REQUEST', 'refresh_token is required');
    }

    const ip       = req.ip || req.socket?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    const result = await authService.refreshTokens(refresh_token.trim(), ip, userAgent);

    res.status(200).json({
      success: true,
      data: {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        userId: result.user_id,
      },
    });
  },

  /**
   * POST /api/v1/auth/logout
   *
   * Requires: Authorization: Bearer <access_token>  (enforced by requireAuth middleware)
   * Body:     { refresh_token?: string }
   *
   * Flow:
   *  1. requireAuth has already verified access token and put req.user
   *  2. Add access token JTI to Redis blocklist (TTL = remaining life)
   *  3. Invalidate refresh token from DB
   */
  async logout(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = req.user;
    if (!user?.userId) {
      // requireAuth guarantees this; defensive check
      throw new AuthError('UNAUTHORIZED', 'Authentication required');
    }

    const rawAccessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!rawAccessToken) {
      throw new AuthError('UNAUTHORIZED', 'Access token missing from Authorization header');
    }

    const { refresh_token, device_id } = req.body ?? {};

    await authService.logout({
      userId: user.userId,
      rawAccessToken,
      refreshToken: typeof refresh_token === 'string' ? refresh_token.trim() : undefined,
      deviceId: typeof device_id === 'string' ? device_id.trim() : undefined,
    });

    res.status(200).json({
      success: true,
      data: {
        message: 'Logged out successfully',
      },
    });
  },

  /**
   * POST /api/v1/auth/admin/verify
   *
   * Body: { firebaseIdToken: string }
   *
   * Flow:
   *  1. Verify Firebase email+password token (not phone OTP)
   *  2. Look up email in admin_users table (Critical Rule #19)
   *  3. Issue admin JWT with role: 'admin'
   *
   * NOTE: No refresh token for admin — short-lived access only.
   * Admin sessions expire in 24h and must re-authenticate.
   */
  async adminVerify(req: Request, res: Response): Promise<void> {
    const { firebaseIdToken } = req.body ?? {};

    if (typeof firebaseIdToken !== 'string' || firebaseIdToken.trim().length === 0) {
      throw new ValidationError('INVALID_REQUEST', 'firebaseIdToken is required');
    }

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    logger.info(`Admin login attempt from IP ${ip}`);

    const result = await authService.verifyAdminFirebase(firebaseIdToken.trim());

    logger.info(`Admin login SUCCESS: user_id=${result.user_id} role=${result.role} ip=${ip}`);

    res.status(200).json({
      success: true,
      data: {
        access_token: result.access_token,
        userId: result.user_id,
        role: result.role,
      },
    });
  },
};

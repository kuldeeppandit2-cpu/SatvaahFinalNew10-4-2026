import { timingSafeEqual } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '@satvaaah/middleware';
import { asyncHandler } from '@satvaaah/middleware';
import { TrustController } from '../controllers/trust.controller';
import { certificateController } from '../controllers/certificate.controller';

const router = Router();
const ctrl = new TrustController();

// ─── Service-Key Middleware (internal only) ───────────────────────────────────
// POST /api/v1/trust/:id/recalculate — X-Service-Key header required
function requireServiceKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-service-key'];
  const expected = process.env.INTERNAL_SERVICE_KEY;

  if (!expected) {
    res.status(500).json({
      success: false,
      error: { code: 'MISCONFIGURED', message: 'Service key not configured' },
    });
    return;
  }
  const keyBuf = Buffer.from(typeof key === 'string' ? key : '');
  const expBuf = Buffer.from(expected);
  const valid  = keyBuf.length === expBuf.length && timingSafeEqual(keyBuf, expBuf);
  if (!key || !valid) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing service key' },
    });
    return;
  }
  next();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/trust/certificate/mine
 * Authenticated provider's own Certificate of Verification.
 * Returns CertificateData with pre-signed S3 PDF URL (30-min expiry).
 * Must be defined BEFORE /:id — otherwise 'certificate' matches as a UUID param.
 */
router.get(
  '/certificate/mine',
  requireAuth,
  asyncHandler(certificateController.getMine.bind(certificateController)),
);

/**
 * GET /api/v1/trust/certificate/:certId
 * Public certificate lookup — no auth required.
 * Used by satvaaah.com/verify/:certId (CloudFront → Next.js → this API).
 * Also used by CertificateScreen when certId is passed in navigation params.
 */
router.get(
  '/certificate/:certId',
  asyncHandler(certificateController.getByCertId.bind(certificateController)),
);

/**
 * GET /api/v1/trust/me
 * Provider's own full trust breakdown (requires JWT — provider mode).
 * Must be defined BEFORE /:id to prevent "me" matching as a UUID.
 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(ctrl.getMyTrust.bind(ctrl)),
);

/**
 * GET /api/v1/trust/:id
 * Public trust breakdown for any provider. Authenticated consumers/providers
 * can view full breakdown; unauthenticated callers receive a public subset.
 */
router.get(
  '/:id',
  // No requireAuth — trust profiles are public; controller provides reduced payload
  // to unauthenticated callers (no signal breakdown, no history detail)
  asyncHandler(ctrl.getTrust.bind(ctrl)),
);

/**
 * GET /api/v1/trust/:id/history
 * Trust biography — immutable chronological timeline of trust events.
 * Includes peer context percentile ("higher than X% in Hyderabad").
 */
router.get(
  '/:id/history',
  asyncHandler(ctrl.getTrustHistory.bind(ctrl)),
);

/**
 * POST /api/v1/trust/:id/recalculate
 * Internal endpoint — enqueues an SQS message to trust-score-updates queue.
 * Auth: X-Service-Key header. NOT user-facing.
 */
router.post(
  '/:id/recalculate',
  requireServiceKey,
  asyncHandler(ctrl.recalculate.bind(ctrl)),
);

export default router;

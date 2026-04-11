/**
 * services/user/src/routes/internal.routes.ts
 *
 * Internal-only endpoints called by Lambdas and other services.
 * Protected by x-internal-key header (timingSafeEqual check).
 * NEVER exposed through nginx to the public internet.
 *
 * Routes:
 *   POST /api/v1/internal/trust/broadcast  — BG1 Lambda notifies user service
 *                                            after writing trust score to DB.
 *                                            User service broadcasts via WS3 /trust
 *                                            to the provider's connected P8 dashboard.
 *
 * audit-ref: WS3 — broadcastTrustUpdate was defined but never called.
 *            This file closes that gap.
 */

import { Router, Request, Response }   from 'express';
import { timingSafeEqual }             from 'crypto';
import { asyncHandler }                from '@satvaaah/middleware';
import { logger }                      from '@satvaaah/logger';
import { broadcastTrustUpdate }        from '../websocket/server';

const router = Router();

// ── Internal key middleware ───────────────────────────────────────────────────
function requireInternalKey(req: Request, res: Response, next: () => void): void {
  const key      = req.headers['x-internal-key'] as string | undefined;
  const expected = process.env.INTERNAL_SERVICE_KEY;

  if (!expected) {
    res.status(503).json({ error: 'INTERNAL_SERVICE_KEY not configured' });
    return;
  }

  const keyBuf = Buffer.from(key ?? '');
  const expBuf = Buffer.from(expected);

  if (!key || keyBuf.length !== expBuf.length || !timingSafeEqual(keyBuf, expBuf)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

// ── POST /api/v1/internal/trust/broadcast ─────────────────────────────────────
/**
 * Called by Lambda:trust-recalculate (BG1) after writing updated trust score to DB.
 * Broadcasts via Socket.IO WS3 /trust namespace to the provider's dashboard (P8).
 *
 * Body: {
 *   provider_id:  string   — UUID of the provider
 *   display_score: number  — new trust score 0-100
 *   trust_tier:   string   — unverified|basic|trusted|highly_trusted
 *   delta_pts:    number   — signed point change
 *   event_type:   string   — what triggered this (e.g. 'rating_added', 'geo_verified')
 * }
 */
router.post(
  '/internal/trust/broadcast',
  requireInternalKey,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { provider_id, display_score, trust_tier, delta_pts, event_type } = req.body ?? {};

    if (!provider_id || display_score === undefined) {
      res.status(400).json({ error: 'provider_id and display_score are required' });
      return;
    }

    broadcastTrustUpdate(provider_id, {
      displayScore: Number(display_score),
      trustTier:    String(trust_tier ?? 'basic'),
      delta_pts:    Number(delta_pts ?? 0),
      eventType:    String(event_type ?? 'trust_recalculated'),
    });

    logger.info('internal.trust.broadcast.sent', {
      provider_id,
      display_score,
      trust_tier,
      event_type,
    });

    res.json({ success: true });
  }),
);

export default router;

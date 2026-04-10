/**
 * SatvAAh — Payment Routes
 *
 * GET  /subscriptions/plans?user_type=consumer|provider
 * POST /subscriptions/purchase
 * POST /payments/webhook/razorpay
 * POST /referrals/apply
 *
 * Authentication middleware is applied to all routes except the webhook
 * (Razorpay calls the webhook from their servers, not from our users).
 */

import { Router, Request, Response } from 'express';
import { requireAuth, asyncHandler } from '@satvaaah/middleware';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';
import { getPlans, purchaseSubscription } from '../services/subscriptionService';
import { handleRazorpayWebhook } from '../services/razorpayWebhook';
import { applyReferral } from '../services/referralService';

const router = Router();

// requireAuth is the shared RS256 JWT middleware from @satvaaah/middleware.
// It injects req.user = { user_id: userId, mode, subscriptionTier, phoneVerified }.
// It also checks the JTI blocklist in Redis (P11 fix applied here).

// ─── GET /subscriptions/plans ─────────────────────────────────────────────────
// Returns from subscription_plans table. All prices in PAISE.
router.get(
  '/subscriptions/plans',
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const userType = (req.query.user_type as string) || (req as any).user?.mode;

    if (!userType || !['consumer', 'provider'].includes(userType)) {
      throw new AppError('VALIDATION_ERROR', 'user_type must be consumer or provider', 400);
    }

    const rawPlans = await getPlans(userType as 'consumer' | 'provider');
    // Map DB snake_case → camelCase for mobile SubscriptionPlan interface
    const plans = rawPlans.map((p: any) => ({
      id:             p.id,
      name:           p.name,
      tier:           p.name?.toLowerCase().includes('silver') ? 'silver'
                      : p.name?.toLowerCase().includes('gold') ? 'gold' : 'free',
      userType:       p.user_type,
      amountPaise:    p.amount_paise,
      durationDays:   p.duration_days,
      leadsAllocated: p.lead_credits,
      features:       p.features ?? {},
      isActive:       p.is_active,
    }));
    res.json({ success: true, data: plans });
  })
);

// ─── POST /subscriptions/purchase ─────────────────────────────────────────────
// Creates a Razorpay order. Idempotency via sha256(userId+planId+monthYear).
router.post(
  '/subscriptions/purchase',
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { plan_id } = req.body;
    if (!plan_id) throw new AppError('VALIDATION_ERROR', 'plan_id is required', 400);

    const result = await purchaseSubscription({
      userId: (req as any).user.userId,
      planId: plan_id as string,
    });
    res.status(201).json(result);
  }),
);

// ─── POST /payments/webhook/razorpay ──────────────────────────────────────────
// Body is raw Buffer (express.raw() applied in app.ts BEFORE express.json()).
// Must return 200 immediately — Razorpay retries on non-2xx.
router.post(
  '/payments/webhook/razorpay',
  async (req: Request, res: Response): Promise<void> => {
    // Acknowledge immediately (Razorpay requires fast response)
    res.status(200).json({ received: true });

    // Process asynchronously — errors must not bubble to HTTP layer
    setImmediate(async () => {
      try {
        await handleRazorpayWebhook(req);
      } catch (err) {
        // Log only — response already sent
        logger.error(`webhook processing error: ${(err as Error).message}`);
      }
    });
  },
);

// ─── POST /referrals/apply ────────────────────────────────────────────────────
router.post(
  '/referrals/apply',
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { referral_code } = req.body;
    if (!referral_code) throw new AppError('VALIDATION_ERROR', 'referral_code is required', 400);

    const result = await applyReferral({
      newUserId: (req as any).user.userId,
      referralCode: referral_code as string,
    });
    res.json(result);
  }),
);


// ─── GET /api/v1/subscriptions/me ─────────────────────────────────────────────
// Returns the user's active subscription record (if any).

router.get(
  '/subscriptions/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { prisma } = await import('@satvaaah/db');
    const userId = (req as any).user.userId;
    const record = await prisma.subscriptionRecord.findFirst({
      where: { user_id: userId, status: { in: ['active','pending'] } },
      orderBy: { created_at: 'desc' },
      include: { plan: { select: { display_name: true, tier: true, validity_days: true, price_paise: true } } },
    });
    res.json({ success: true, data: record ?? null });
  }),
);

// ─── POST /subscriptions/confirm ──────────────────────────────────────────────
// Mobile calls this after Razorpay SDK success to trigger server-side verification.
// Signature verification happens in the webhook — this is an idempotent trigger.
router.post(
  '/subscriptions/confirm',
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new AppError('VALIDATION_ERROR', 'razorpay_order_id, razorpay_payment_id, razorpay_signature required', 400);
    }
    // Verify HMAC signature
    const crypto = await import('crypto');
    const secret = process.env.RAZORPAY_KEY_SECRET ?? '';
    const body   = razorpay_order_id + '|' + razorpay_payment_id;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (expected !== razorpay_signature) {
      throw new AppError('INVALID_SIGNATURE', 'Payment signature verification failed', 400);
    }
    // Find and activate subscription record
    const { prisma } = await import('@satvaaah/db');
    const record = await prisma.subscriptionRecord.findFirst({
      where: { razorpay_order_id, status: { in: ['created', 'captured'] } },
    });
    if (record && record.status !== 'active') {
      await prisma.subscriptionRecord.update({
        where: { id: record.id },
        data:  { status: 'active', razorpay_payment_id },
      });
    }
    res.json({ success: true, data: { activated: true } });
  })
);

export default router;

import { createLogger, transports, format } from 'winston';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

/**
 * SatvAAh — Razorpay Webhook Handler
 *
 * Security Rule #9 (Critical):
 *   Verify sha256_hmac(rawPayload, RAZORPAY_WEBHOOK_SECRET) === x-razorpay-signature
 *   before processing ANY event. Reject if mismatch.
 *
 * On payment.captured:
 *   1. Verify HMAC signature
 *   2. Idempotency check — if already processed, return silently (webhooks fire twice)
 *   3. Atomic DB transaction:
 *        a. Activate subscription (subscription_records upsert)
 *        b. Reset lead counter to plan's lead_credits
 *        c. Mark subscription_records status = 'captured'
 *   4. Send FCM push notification (subscription_confirmed)
 *   5. Send WhatsApp (subscription_confirmed — Extraordinary event, allowed by policy)
 *
 * HTTP contract:
 *   Routes layer sends 200 immediately (req object passed async).
 *   This function does NOT touch res — it's called via setImmediate in routes.
 */

import crypto from 'crypto';
import { Request } from 'express';
import { PoolClient } from 'pg';
import { db } from '../app';

// ─── Lazily imported to keep circular-dep surface small ──────────────────────
// (notification service is a separate microservice on port 3006;
//  here we call its internal helper or HTTP client)
import { sendSubscriptionConfirmedFCM } from './notificationClient';
import { sendSubscriptionConfirmedWhatsApp } from './notificationClient';

// ─── Types ────────────────────────────────────────────────────────────────────
interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number;   // always paise (Razorpay never uses rupees in API)
  currency: string;
  status: string;
  notes?: Record<string, string>;
}

interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment?: {
      entity: RazorpayPaymentEntity;
    };
  };
}

// ─── HMAC signature verification ─────────────────────────────────────────────
/**
 * Returns true if x-razorpay-signature matches
 * sha256_hmac(rawBody, RAZORPAY_WEBHOOK_SECRET).
 *
 * rawBody MUST be the original Buffer — which is why express.raw() is
 * registered BEFORE express.json() in app.ts.
 */
function verifySignature(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET env var is not set');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(signature, 'utf8'),
  );
}

// ─── Main webhook handler ─────────────────────────────────────────────────────
export async function handleRazorpayWebhook(req: Request): Promise<void> {
  const rawBody = req.body as Buffer;
  const signature = req.headers['x-razorpay-signature'] as string;

  // ── Guard: raw body must be Buffer ────────────────────────────────────────
  if (!Buffer.isBuffer(rawBody)) {
    logger.error(
      '[webhook] rawBody is not a Buffer — express.raw() may not have been applied',
    );
    return;
  }

  // ── Guard: signature header must be present ───────────────────────────────
  if (!signature) {
    logger.warn('[webhook] Missing x-razorpay-signature header — ignoring');
    return;
  }

  // ── Step 1: Verify HMAC ───────────────────────────────────────────────────
  let isValid: boolean;
  try {
    isValid = verifySignature(rawBody, signature);
  } catch (err) {
    logger.error('[webhook] Signature verification threw:', err);
    return;
  }

  if (!isValid) {
    logger.warn('[webhook] Invalid signature — possible replay / spoofed request');
    return;
  }

  // ── Step 2: Parse payload ─────────────────────────────────────────────────
  let webhookData: RazorpayWebhookPayload;
  try {
    webhookData = JSON.parse(rawBody.toString('utf8'));
  } catch {
    logger.error('[webhook] Failed to parse JSON payload');
    return;
  }

  const { event, payload } = webhookData;
  logger.info(`[webhook] Received event: ${event}`);

  // ── Step 3: Route event ───────────────────────────────────────────────────
  if (event === 'payment.captured') {
    const paymentEntity = payload.payment?.entity;
    if (!paymentEntity) {
      logger.error('[webhook] payment.captured missing payment entity');
      return;
    }
    await handlePaymentCaptured(paymentEntity);
  }
  // Future events (payment.failed, refund.created, etc.) extend here
}

// ─── payment.captured handler ─────────────────────────────────────────────────
async function handlePaymentCaptured(
  payment: RazorpayPaymentEntity,
): Promise<void> {
  const { id: paymentId, order_id: orderId, amount: amountPaise } = payment;

  // ── Idempotency: check if already processed ───────────────────────────────
  const existing = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM subscription_records WHERE razorpay_order_id = $1`,
    [orderId],
  );

  if (existing.rows.length === 0) {
    // Unknown order — possibly from a different environment or data race
    logger.warn(`[webhook] payment.captured for unknown order: ${orderId}`);
    return;
  }

  const order = existing.rows[0];

  if (order.status === 'captured') {
    // Already processed (Razorpay can fire the same webhook twice)
    logger.info(
      `[webhook] Duplicate payment.captured for order ${orderId} — skipping`,
    );
    return;
  }

  // ── Fetch full order details for subscription activation ──────────────────
  const orderDetails = await db.query<{
    id: string;
    userId: string;
    plan_id: string;
  }>(
    `SELECT id, user_id AS "userId", plan_id AS "planId" FROM subscription_records WHERE razorpay_order_id = $1`,
    [orderId],
  );

  const { userId, planId } = orderDetails.rows[0];

  // ── Fetch plan details ────────────────────────────────────────────────────
  const planResult = await db.query<{
    leadsAllocated: number;
    validityDays:   number;
    name:           string;
    pricePaise:     number;
  }>(
    `SELECT lead_credits AS "leadsAllocated", duration_days AS "validityDays",
            name, price_paise AS "pricePaise"
     FROM subscription_plans WHERE id = $1`,
    [planId],
  );

  if (planResult.rows.length === 0) {
    logger.error(`[webhook] Plan not found for id: ${planId}`);
    return;
  }

  const plan = planResult.rows[0];

  // ── Atomic transaction: activate subscription + reset leads ───────────────
  const client: PoolClient = await db.connect();
  try {
    await client.query('BEGIN');

    // a) Activate / renew subscription
    await client.query(
      `INSERT INTO subscription_records
         (user_id, plan_id, status, started_at, expires_at, leads_used, created_at)
       VALUES
         ($1, $2, 'active', NOW(), NOW() + INTERVAL '1 day' * $3, 0, NOW())
       ON CONFLICT (razorpay_order_id) DO UPDATE SET
         status     = 'active',
         started_at = EXCLUDED.started_at,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
      [userId, planId, plan.validityDays],
    );

    // b) Mark payment order as captured with Razorpay payment ID
    await client.query(
      `UPDATE subscription_records
       SET status              = 'active',
           razorpay_payment_id = $1,
           updated_at          = NOW()
       WHERE razorpay_order_id = $2`,
      [paymentId, orderId],
    );

    await client.query('COMMIT');
    logger.info(
      `[webhook] Subscription activated for user ${userId}, plan ${planId}`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[webhook] Transaction failed — rolled back:', err);
    throw err;
  } finally {
    client.release();
  }

  // ── FCM push notification (non-blocking) ──────────────────────────────────
  // Template: subscription_confirmed (allowed — Extraordinary event)
  try {
    await sendSubscriptionConfirmedFCM(userId, {
      plan_name: plan.name,
      amountPaise: Math.round(Number(plan.pricePaise)),
      lead_credits: plan.leadsAllocated,
    });
  } catch (err) {
    // FCM failure must NOT prevent WhatsApp or break the overall flow
    logger.error('[webhook] FCM notification failed (non-fatal):', err);
  }

  // ── WhatsApp (subscription_confirmed is Extraordinary — policy allows) ────
  try {
    await sendSubscriptionConfirmedWhatsApp(userId, {
      plan_name: plan.name,
      amountPaise: Math.round(Number(plan.pricePaise)),
    });
  } catch (err) {
    logger.error('[webhook] WhatsApp notification failed (non-fatal):', err);
  }
}

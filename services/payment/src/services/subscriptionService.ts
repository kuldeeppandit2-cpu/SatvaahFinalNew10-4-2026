/**
 * SatvAAh — Subscription Service
 *
 * Rules:
 *  - All monetary values are ALWAYS in PAISE (integer). Never rupees. Never float.
 *  - Rs 49  = 4900  paise
 *  - Rs 99  = 9900  paise
 *  - Rs 199 = 19900 paise
 *
 *  Idempotency key = sha256(userId + planId + monthYear)
 *    e.g. sha256("uuid123plan_pro_consumer2026-04")
 *  This ensures a duplicate purchase attempt in the same billing month
 *  returns the SAME Razorpay order rather than creating a second charge.
 */

import crypto from 'crypto';
import Razorpay from 'razorpay';
import { db } from '../app';

// ─── Razorpay client — lazy init so service starts without keys configured ────
let _razorpay: InstanceType<typeof Razorpay> | null = null;
function getRazorpay() {
  if (!_razorpay) {
    const key_id = process.env.RAZORPAY_KEY_ID ?? '';
    const key_secret = process.env.RAZORPAY_KEY_SECRET ?? '';
    if (!key_id) throw new Error('RAZORPAY_KEY_ID not configured');
    _razorpay = new Razorpay({ key_id, key_secret });
  }
  return _razorpay;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface Plan {
  id: string;
  name: string;
  user_type: 'consumer' | 'provider';
  amountPaise: number;       // ALWAYS paise — integer
  duration_days: number;
  lead_credits: number;
  features: Record<string, unknown>;
  isActive: boolean;
}

export interface PurchaseResult {
  razorpayOrderId:      string;
  razorpayKeyId:        string;   // public key — safe for client
  amountPaise:          number;   // ALWAYS paise — integer
  currency:             'INR';
  idempotencyKey:       string;
  subscriptionRecordId: string;   // for receipt display only
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate the month-year string for idempotency (e.g. "2026-04") */
function getMonthYear(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/** sha256(userId + planId + monthYear) — deterministic, collision-resistant */
function buildIdempotencyKey(userId: string, planId: string): string {
  const monthYear = getMonthYear();
  return crypto
    .createHash('sha256')
    .update(userId + planId + monthYear)
    .digest('hex');
}

// ─── getPlans ─────────────────────────────────────────────────────────────────
/**
 * Fetch active subscription plans for a given user_type from the DB.
 * All prices returned in PAISE.
 */
export async function getPlans(
  userType: 'consumer' | 'provider',
): Promise<Plan[]> {
  const { rows } = await db.query<Plan>(
    `SELECT
       id,
       display_name  AS name,
       user_type,
       price_paise   AS amount_paise,
       validity_days AS duration_days,
       leads_allocated AS lead_credits,
       features,
       is_active
     FROM subscription_plans
     WHERE user_type = $1
       AND is_active = true
     ORDER BY amount_paise ASC`,
    [userType],
  );

  // Paranoia guard: ensure amount_paise is always an integer
  return rows.map((plan) => ({
    ...plan,
    amountPaise: Math.round(Number(plan.amount_paise)), // aliased in SQL
  }));
}

// ─── purchaseSubscription ─────────────────────────────────────────────────────
/**
 * Create a Razorpay order for the given user+plan.
 *
 * Idempotency:
 *   1. Compute sha256(userId + planId + monthYear)
 *   2. Check subscription_records table for an existing row with this key
 *   3. If found → return the existing Razorpay order (no second charge)
 *   4. If not found → call Razorpay API, persist, return new order
 */
export async function purchaseSubscription({
  userId,
  planId,
}: {
  userId: string;
  planId: string;
}): Promise<PurchaseResult> {
  const idempotencyKey = buildIdempotencyKey(userId, planId);

  // ── Step 1: Check for existing order (idempotency) ────────────────────────
  const existing = await db.query<{
    razorpayOrderId: string;
    amountPaise: number;
  }>(
    `SELECT razorpay_order_id AS "razorpayOrderId", amount_paise AS "amountPaise"
     FROM subscription_records
     WHERE idempotency_key = $1`,
    [idempotencyKey],
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const error = new Error('Idempotent order already exists') as any;
    error.code = 'IDEMPOTENT_ORDER_EXISTS';
    error.existingOrder = {
      razorpayOrderId: row.razorpayOrderId,
      amountPaise:     Math.round(Number(row.amountPaise)),
      currency:        'INR' as const,
      idempotencyKey,
    };
    throw error;
  }

  // ── Step 2: Fetch plan from DB ────────────────────────────────────────────
  const planResult = await db.query<{
    amountPaise: number;
    name: string;
  }>(
    `SELECT amount_paise, name
     FROM subscription_plans
     WHERE id = $1 AND is_active = true`,
    [planId],
  );

  if (planResult.rows.length === 0) {
    const err = new Error(`Plan not found or inactive: ${planId}`) as any;
    err.code = 'PLAN_NOT_FOUND';
    throw err;
  }

  const plan = planResult.rows[0];
  // CRITICAL: ensure integer paise — never send floats to Razorpay
  const amountPaise = Math.round(Number(plan.amount_paise));

  // ── Step 3: Create Razorpay order ─────────────────────────────────────────
  // Razorpay amount field is in paise — this is correct.
  const razorpayOrder = await getRazorpay().orders.create({
    amount: amountPaise,          // paise — integer
    currency: 'INR',
    receipt: idempotencyKey.slice(0, 40), // Razorpay receipt max 40 chars
    notes: {
      userId: userId,
      planId: planId,
      plan_name: plan.name,
      idempotencyKey: idempotencyKey,
    },
  });

  // ── Step 4: Persist order for idempotency + audit trail ───────────────────
  await db.query(
    `INSERT INTO subscription_records
       (user_id, plan_id, razorpay_order_id, amount_paise, idempotency_key, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'created', NOW())
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [userId, planId, razorpayOrder.id, amountPaise, idempotencyKey],
  );

  // Fetch subscription_record id for client receipt
  const srRow = await db.query<{ id: string }>(
    `SELECT id FROM subscription_records WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  const subscriptionRecordId = srRow.rows[0]?.id ?? '';

  return {
    razorpayOrderId:      razorpayOrder.id,
    razorpayKeyId:        process.env.RAZORPAY_KEY_ID ?? '',  // public — safe
    amountPaise:          amountPaise,
    currency:             'INR',
    idempotencyKey:       idempotencyKey,
    subscriptionRecordId: subscriptionRecordId,
  };
}

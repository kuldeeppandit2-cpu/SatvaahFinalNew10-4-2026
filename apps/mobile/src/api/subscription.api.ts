/**
 * subscription.api.ts
 * API client for services/payment (port 3007)
 * Endpoints: plans, purchase, order creation, webhook result polling
 *
 * RULE: All monetary amounts are in PAISE (integer).
 *       Rs 1 = 100 paise. Never floats. Never rupees in API payloads.
 */

import { apiClient } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'silver' | 'gold';

export interface SubscriptionPlan {
  id:             string;       // server returns 'id' not 'plan_id'
  tier:           SubscriptionTier;
  userType:       'consumer' | 'provider';
  amountPaise:    number;       // PAISE — server field: amount_paise
  leadsAllocated: number | null;
  durationDays:   number;       // server returns duration_days (not months)
  features:       PlanFeatures;
  name:           string;       // server returns 'name' not 'displayName'
  tagline?:       string;
}

export interface PlanFeatures {
  slot_booking: boolean;
  priority_search: boolean;
  saved_providers: boolean;
  advanced_filters: boolean;
  lead_rollover: boolean;
  [key: string]: boolean | string | number; // JSONB — extensible
}

export interface PurchaseOrderPayload {
  planId: string;  // server uses planId
}

export interface PurchaseOrderResponse {
  razorpayOrderId:      string;
  razorpayKeyId:        string;  // public key — safe to expose
  amountPaise:          number;
  currency:             'INR';
  idempotencyKey:       string;
  subscriptionRecordId: string;
}

export interface VerifyPaymentPayload {
  razorpayOrderId:      string;
  razorpayPaymentId:    string;
  razorpaySignature:    string;  // HMAC-SHA256 — verified on server
  subscriptionRecordId: string;
}

export interface VerifyPaymentResponse {
  success:    boolean;
  tier:       SubscriptionTier;
  // Activation is async via webhook — minimal response
}

export interface ActiveSubscription {
  id:             string;
  planId:         string;
  tier:           SubscriptionTier;
  status:         'active' | 'expired' | 'pending';
  leadsAllocated: number;
  leadsUsed:      number;
  expiresAt:      string;  // ISO timestamp
  startedAt:      string;
}

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/subscriptions/plans?user_type=consumer
 * Fetch all subscription plans for the given user type.
 * NEVER hardcode plan prices or lead counts — always from this endpoint.
 */
export async function fetchSubscriptionPlans(
  userType: 'consumer' | 'provider' = 'consumer',
): Promise<SubscriptionPlan[]> {
  const res = await apiClient.get<{
    success: true;
    data: SubscriptionPlan[];
  }>('/api/v1/subscriptions/plans', { params: { userType } });
  return res.data.data;
}

/**
 * POST /api/v1/subscriptions/purchase
 * Creates a Razorpay order for the selected plan.
 * Returns Razorpay order details needed to open the checkout.
 *
 * idempotency_key must be generated on the client (UUID) before calling,
 * so retries on network error don't create duplicate orders.
 */
export async function createSubscriptionOrder(
  payload: PurchaseOrderPayload,
): Promise<PurchaseOrderResponse> {
  const res = await apiClient.post<{
    success: true;
    data: PurchaseOrderResponse;
  }>('/api/v1/subscriptions/purchase', payload);  // server generates its own idempotency key
  return res.data.data;
}

/**
 * POST /api/v1/payments/webhook/razorpay (server-side only)
 * Send Razorpay payment result to backend for HMAC-SHA256 signature verification.
 * Called AFTER Razorpay SDK returns success callback.
 *
 * NOTE: Subscription activation is also triggered by the Razorpay webhook
 * (POST /api/v1/payments/webhook/razorpay). Verify call is belt-and-suspenders.
 */
export async function verifyPayment(
  payload: VerifyPaymentPayload,
): Promise<VerifyPaymentResponse> {
  const res = await apiClient.post<{
    success: true;
    data: VerifyPaymentResponse;
  }>('/api/v1/payments/webhook/razorpay', payload);  // stub — not called
  return res.data.data;
}

/**
 * GET /api/v1/subscriptions/me
 * Fetch the consumer's current active subscription (if any).
 */
export async function fetchMySubscription(): Promise<ActiveSubscription | null> {
  const res = await apiClient.get<{
    success: true;
    data: ActiveSubscription | null;
  }>('/api/v1/subscriptions/me');
  return res.data.data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert paise integer to formatted rupee string.
 * e.g. 4900 → "₹49"   9900 → "₹99"   29900 → "₹299"
 */
export function paiseToRupees(paise: number): string {
  const rupees = paise / 100;
  if (Number.isInteger(rupees)) {
    return `₹${rupees}`;
  }
  return `₹${rupees.toFixed(2)}`;
}

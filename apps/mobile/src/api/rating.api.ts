/**
 * rating.api.ts
 * API client for services/rating (port 3005)
 * Endpoints: eligibility check, submit rating, open community rating, flag
 */

import { apiClient } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RatingDimension {
  key: string;
  label: string;
  icon?: string; // optional emoji / icon name
}

export interface RatingEligibility {
  eligible: boolean;
  reason?: string; // shown if ineligible
  contactEventId: string | null;
  providerId: string;
  providerName: string;
  provider_tab: 'services' | 'expertise' | 'products' | 'establishments';
  skipCount: number; // 0–3; expiry nudge shown at ≥3
  ratingBonusLeads: number; // from system_config
  expiresAt: string | null; // ISO timestamp; null if no expiry set yet
  ratingDimensions: RatingDimension[]; // from taxonomy_node.ratingDimensions JSONB
}

export interface DimensionRating {
  key: string;
  stars: number; // 1–5
}

export interface SubmitRatingPayload {
  providerId:     string;
  contactEventId: string | null; // verified_contact weight; null = open community
  overallStars:   number; // 1–5
  text?:          string; // max 1000 chars (server field: text)
  dimensions?:    Record<string, number>; // {key: stars} — server expects this shape
}

export interface SubmitRatingResponse {
  ratingId:          string;
  bonusLeadsGranted: number;
  weightType:        string;
  moderationStatus:  string;
  isBurstFlagged:    boolean;
}

export interface OpenRatingPayload {
  providerId: string;
  tab: 'products' | 'establishments'; // only these two tabs allow open ratings
  overallStars: number; // 1–5
  text?:       string; // max 1000 chars
  dimensions?: Record<string, number>;
  photo_keys?: string[]; // max 3
}

export interface OpenRatingResponse {
  ratingId: string;
  daily_used: number;
  daily_limit: number;
}

export interface DailyRatingUsage {
  tab: 'products' | 'establishments';
  used: number;
  limit: number; // from system_config — products:10, establishments:8
}

export interface FlagRatingPayload {
  ratingId: string;
  reason: 'fake' | 'spam' | 'inappropriate' | 'conflict_of_interest' | 'other';
  details?: string;
}

// ─── API Functions ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/ratings/eligibility/:providerId
 * Check if the consumer is eligible to rate a specific provider.
 * Called before showing RateProviderScreen.
 */
export async function fetchRatingEligibility(
  providerId: string,
): Promise<RatingEligibility> {
  const res = await apiClient.get<{ success: true; data: RatingEligibility }>(
    `/api/v1/ratings/eligibility/${providerId}`,
  );
  return res.data.data;
}

/**
 * POST /api/v1/ratings
 * Submit a verified-contact rating (weight 1.0).
 * Linked to a specific contact_event. Earns bonus leads.
 */
export async function submitVerifiedRating(
  payload: SubmitRatingPayload,
): Promise<SubmitRatingResponse> {
  const res = await apiClient.post<{
    success: true;
    data: SubmitRatingResponse;
  }>('/api/v1/ratings', payload);
  return res.data.data;
}

/**
 * POST /api/v1/ratings (contact_event_id omitted → open community, weight=0.5)
 * MASTER_CONTEXT: V010 contact_event_id NULLABLE. NULL = open_community. No separate endpoint.
 * Submit an open community rating (weight 0.5).
 * Only allowed for Products and Establishments tabs.
 * Subject to daily limits enforced by daily_rating_usage table.
 */
export async function submitOpenRating(
  payload: OpenRatingPayload,
): Promise<OpenRatingResponse> {
  const res = await apiClient.post<{
    success: true;
    data: OpenRatingResponse;
  }>('/api/v1/ratings', payload); // same endpoint as verified; backend sets weight=0.5 when contact_event_id is null
  return res.data.data;
}

/**
 * GET /api/v1/ratings/daily-usage?tab=products|establishments
 * Returns today's open-community rating count for the given tab.
 */
export async function fetchDailyRatingUsage(
  tab: 'products' | 'establishments',
): Promise<DailyRatingUsage> {
  const res = await apiClient.get<{
    success: true;
    data: DailyRatingUsage;
  }>('/api/v1/ratings/daily-usage', { params: { tab } });
  return res.data.data;
}

/**
 * POST /api/v1/ratings/:id/flag
 * Flag a rating for moderation review.
 */
export async function flagRating(payload: FlagRatingPayload): Promise<void> {
  await apiClient.post(`/api/v1/ratings/${payload.ratingId}/flag`, {
    reason: payload.reason,
    details: payload.details,
  });
}

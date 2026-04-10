/**
 * savedProviders.api.ts
 * SatvAAh — Phase 21
 *
 * Endpoints:
 *   GET    /api/v1/saved-providers           (user :3002)
 *   POST   /api/v1/saved-providers           (user :3002)
 *   DELETE /api/v1/saved-providers/:id       (user :3002)
 *
 * Critical:
 *   - Returns LIVE trust_score, not the score at time of save.
 *   - trust_score_at_save is stored separately for the change indicator.
 *   - trust_score is NEVER written from app code (Rule #4 — DB trigger via SQS).
 *   - All responses follow { success: true, data: {...} } format.
 */

import { apiClient } from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TrustTier = 'unverified' | 'basic' | 'trusted' | 'highly_trusted';

export type ListingType =
  | 'individual_service'
  | 'individual_product'
  | 'expertise'
  | 'establishment'
  | 'product_brand';

export interface SavedProviderItem {
  /** Composite PK row — composite (consumer_id + provider_id), V016 */
  saved_at: string; // ISO 8601 UTC
  providerId: string;
  /** LIVE score — fetched at request time, not cached at save time */
  trust_score_at_save: number;
  provider: {
    id: string;
    displayName: string;
    listingType: ListingType;
    tab: 'products' | 'services' | 'expertise' | 'establishments';
    /** LIVE trust score (auto-maintained by V018 DB trigger) */
    trustScore: number;
    trustTier: TrustTier;
    cityId: string;
    primary_taxonomy_label: string;
    photo_url: string | null;
    /** Real-time availability — augmented client-side via WebSocket */
    is_available: boolean;
    avg_rating: number | null;
    rating_count: number;
    area_label: string | null;
  };
}

export interface SavedProvidersResponse {
  providers: SavedProviderItem[];
  total: number;
}

export interface SaveProviderPayload {
  providerId: string;
}

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * Fetch all saved providers for the authenticated consumer.
 * Returns live trust_score on each provider (not the cached score at save time).
 * trust_score_at_save is returned for the change-delta indicator.
 */
export async function fetchSavedProviders(): Promise<SavedProvidersResponse> {
  const response = await apiClient.get<{ success: true; data: SavedProvidersResponse }>(
    '/api/v1/saved-providers',
  );
  return response.data.data;
}

/**
 * Save a provider to the authenticated consumer's saved list.
 * POST /api/v1/saved-providers
 * Records current trust_score as trust_score_at_save on backend.
 *
 * @throws ALREADY_SAVED (409) if duplicate
 * @throws PROVIDER_NOT_FOUND (404)
 */
export async function saveProvider(
  providerId: string,
): Promise<{ saved_at: string; trust_score_at_save: number }> {
  const payload: SaveProviderPayload = { provider_id: providerId };
  const response = await apiClient.post<{
    success: true;
    data: { saved_at: string; trust_score_at_save: number };
  }>('/api/v1/saved-providers', payload);
  return response.data.data;
}

/**
 * Remove a provider from the authenticated consumer's saved list.
 * DELETE /api/v1/saved-providers/:id
 * :id is the provider_id (composite PK resolved server-side by consumer_id from JWT)
 */
export async function unsaveProvider(providerId: string): Promise<void> {
  await apiClient.delete(`/api/v1/saved-providers/${providerId}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the score delta between current live score and score at time of save.
 * Returns null if no meaningful change (±0).
 */
export function computeScoreDelta(
  currentScore: number,
  scoreAtSave: number,
): { delta: number; direction: 'up' | 'down' } | null {
  const delta = currentScore - scoreAtSave;
  if (delta === 0) return null;
  return { delta: Math.abs(delta), direction: delta > 0 ? 'up' : 'down' };
}

/**
 * Map trust_tier enum to human-readable label.
 */
export function trustTierLabel(tier: TrustTier): string {
  const labels: Record<TrustTier, string> = {
    unverified: 'Unverified',
    basic: 'Basic',
    trusted: 'Trusted',
    highly_trusted: 'Highly Trusted',
  };
  return labels[tier];
}

/**
 * Map trust_tier enum to brand colour hex.
 * Matches MASTER_CONTEXT BRAND section exactly.
 */
export function trustTierColour(tier: TrustTier): string {
  const colours: Record<TrustTier, string> = {
    unverified: '#6B6560',
    basic: '#C8691A',
    trusted: '#6BA89E',
    highly_trusted: '#2E7D72',
  };
  return colours[tier];
}

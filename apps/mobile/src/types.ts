/**
 * apps/mobile/src/types.ts
 * Shared type re-exports — single import point for common domain types.
 */

// Subscription tier — schema enum: free | silver | gold  (V036 removed bronze/platinum — they do not exist in DB)
export type SubscriptionTier = 'free' | 'silver' | 'gold';

// Listing type (provider_profiles.listing_type)
export type ListingType =
  | 'individual_service'
  | 'individual_product'
  | 'expertise'
  | 'establishment'
  | 'product_brand';

// Trust tier enum — matches schema TrustTier enum exactly
export type TrustTier = 'unverified' | 'basic' | 'trusted' | 'highly_trusted';

// Trust score history entry (trust_score_history table — IMMUTABLE)
export interface TrustScoreHistory {
  event_type:        string;
  delta_pts:         number;
  new_display_score: number;
  new_tier:          TrustTier;
  event_at:          string; // ISO UTC
  correlation_id:    string;
}

/**
 * apps/mobile/src/api/trust.api.ts
 * SatvAAh Phase 19 — Trust Score API
 * Service: trust :3004 (JWT required)
 *
 * Trust Tiers & Ring Colours — CANONICAL (MASTER_CONTEXT v2.0 Coherence Review):
 *
 *   0–19   Unverified     Grey            #6B6560
 *   20–39  Basic          Saffron         #C8691A
 *   40–59  (gap — no tier defined in MASTER_CONTEXT)
 *          Scores 40–59: trust_tier_basic_threshold=20, trust_tier_trusted_threshold=60
 *          → below Trusted, above Basic → rendered as Basic / Saffron.
 *   60–79  Trusted        Light Verdigris #6BA89E
 *   80–100 Highly Trusted Verdigris       #2E7D72
 *
 * Config keys (V031 seed — admin-editable, NEVER hardcode thresholds in UI):
 *   trust_tier_basic_threshold          = 20
 *   trust_tier_trusted_threshold        = 60
 *   trust_tier_highly_trusted_threshold = 80
 *
 * MASTER_CONTEXT Phase 19 prompt trust ring spec:
 *   0-19:   Grey #6B6560
 *   20-39:  Saffron #C8691A
 *   60-79:  Light Verdigris #6BA89E
 *   80-100: Verdigris #2E7D72
 */

import { apiClient } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrustTier =
  | 'unverified'
  | 'basic'
  | 'trusted'
  | 'highly_trusted';

export interface TrustSignal {
  signalName:   string;
  displayName:  string;    // human-readable label shown in signal table
  max_pts:       number;
  earned_pts:    number;
  is_verified:   boolean;   // true = signal earned / active
  category:      'verification' | 'customer_voice' | 'credential';
}

export interface TrustScore {
  providerId:              string;
  displayScore:            number;   // 0–100, shown to consumers
  raw_score:                number;   // pre-normalisation raw total
  verification_score:       number;
  customer_voice_score:     number;
  customerVoiceWeight:    number;   // 0.10–0.70 (dynamic curve)
  verification_weight:      number;   // 1.0 − customer_voice_weight
  trustTier:               TrustTier;
  rating_count:             number;
  peer_context_percentage:  number;   // % of providers in same category with lower score
  signals:                  TrustSignal[];
  has_certificate:          boolean;
  certificate_id?:          string;   // SAT-HYD-YYYY-NNNNN format
  has_calendar:             boolean;  // provider has published slot calendar (Gold gate)
  updatedAt:               string;   // UTC — display as Asia/Kolkata
}

export interface TrustHistoryEntry {
  eventType:        string;
  delta_pts:         number;
  new_display_score: number;
  new_tier:          TrustTier;
  event_at:          string;  // UTC — display as Asia/Kolkata
}

// TrustBreakdown is the same shape as TrustScore but
// explicitly requested by name in GitHub structure spec.
export type TrustBreakdown = TrustScore;

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/trust/:id  →  trust :3004  (JWT)
 * Full trust score including all signals, customer voice blend,
 * peer context, certificate status.
 * Called by ProviderProfileScreen and TrustBreakdownModal.
 */
export async function getTrustScore(providerId: string): Promise<TrustScore> {
  const { data } = await apiClient.get(`/api/v1/trust/${providerId}`);
  if (!data.success) throw new Error(data.error?.message ?? 'Failed to load trust score');
  return data.data as TrustScore;
}

/**
 * GET /api/v1/trust/:id/history  →  trust :3004  (JWT)
 * Immutable trust history — belongs to provider forever (V008 migration).
 * Events ordered ascending. Used in trust biography timeline.
 */
export async function getTrustHistory(providerId: string): Promise<TrustHistoryEntry[]> {
  const { data } = await apiClient.get(`/api/v1/trust/${providerId}/history`);
  if (!data.success) throw new Error(data.error?.message ?? 'Failed to load trust history');
  return data.data as TrustHistoryEntry[];
}

/**
 * GET /api/v1/trust/:id  →  trust :3004  (JWT)
 * Alias of getTrustScore — GitHub structure spec requires getTrustBreakdown(id).
 * Returns same full TrustScore shape used by TrustBreakdownModal signal table.
 */
export async function getTrustBreakdown(providerId: string): Promise<TrustBreakdown> {
  return getTrustScore(providerId);
}

// ─── Trust Ring Colour Helpers ─────────────────────────────────────────────────
//
// Single source of truth for ring colour across the entire app.
// All screens must import trustRingColor from here — never derive locally.
//
// NOTE on 40–59 gap:
//   MASTER_CONTEXT defines Basic (20–39) and Trusted (60–79).
//   Scores 40–59 sit between the two thresholds. Since
//   trust_tier_basic_threshold=20 and trust_tier_trusted_threshold=60,
//   a score of 50 is above Basic threshold but below Trusted threshold
//   → rendered as Basic/Saffron. This matches the Phase 19 prompt spec
//   which lists only 4 bands (0-19 / 20-39 / 60-79 / 80-100).

/** Returns the brand hex colour for a trust ring given a display score. */
export function trustRingColor(score: number): string {
  if (score >= 80) return '#2E7D72';  // Verdigris        — Highly Trusted (80–100)
  if (score >= 60) return '#6BA89E';  // Light Verdigris  — Trusted        (60–79)
  if (score >= 20) return '#C8691A';  // Saffron          — Basic          (20–59)
  return '#6B6560';                   // Grey             — Unverified     (0–19)
}

/** Returns the TrustTier enum value from a display score. */
export function trustTierFromScore(score: number): TrustTier {
  if (score >= 80) return 'highly_trusted';
  if (score >= 60) return 'trusted';
  if (score >= 20) return 'basic';
  return 'unverified';
}

/** Returns the human-readable tier label shown in UI badges and ring. */
export function trustTierLabel(tier: TrustTier): string {
  switch (tier) {
    case 'highly_trusted': return 'Highly Trusted';
    case 'trusted':        return 'Trusted';
    case 'basic':          return 'Basic';
    default:               return 'Unverified';
  }
}

/**
 * Returns a short narrative description of the trust tier.
 * Shown on provider profile below the trust ring.
 * Mirrors server-side AI narration (Lambda:ai-narration nightly).
 */
export function trustNarrative(tier: TrustTier, score: number): string {
  switch (tier) {
    case 'highly_trusted':
      return (
        `Verified by SatvAAh with a trust score of ${score}/100. ` +
        'Identity confirmed, credentials checked, and rated by the community.'
      );
    case 'trusted':
      return (
        `Partially verified with a trust score of ${score}/100. ` +
        'Identity or credentials confirmed.'
      );
    case 'basic':
      return (
        `Phone-verified with a trust score of ${score}/100. ` +
        'Listed on SatvAAh and reachable.'
      );
    default:
      return 'Not yet verified on SatvAAh. Use caution.';
  }
}

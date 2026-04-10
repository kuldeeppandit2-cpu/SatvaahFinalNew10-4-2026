/**
 * trustCalculator.ts
 *
 * Core trust formula engine for SatvAAh.
 *
 * Formula (MASTER_CONTEXT):
 *   display_score = (verification_score × verification_weight)
 *                 + (customer_voice_score × customer_voice_weight)
 *
 *   customer_voice_weight = f(rating_count) via customer_weight_curve (system_config)
 *   verification_weight   = 1.0 − customer_voice_weight
 *
 * ALL signal weights and thresholds are read from DB (trust_score_config, system_config).
 * NOTHING is hardcoded. Admin-editable without code deploy.
 */

import { prisma } from '@satvaaah/db';
import { loadSystemConfig } from '@satvaaah/config';
import { logger } from '@satvaaah/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignalBreakdown {
  signalName: string;
  label: string;          // Human-readable: "Aadhaar Verified"
  achieved: boolean;
  achievedPts: number;    // maxPts if achieved, 0 otherwise
  maxPts: number;
}

export interface TrustBreakdown {
  providerId: string;
  displayScore: number;
  rawMaxTotal: number;      // Max possible verification pts for listing type
  trustTier: string;        // 'unverified' | 'basic' | 'trusted' | 'highly_trusted'
  tierColor: string;        // Brand hex colour
  tierLabel: string;        // "Trusted"
  verificationScore: number;    // 0-100
  verificationWeight: number;   // 0.0-1.0
  customerVoiceScore: number;   // 0-100
  customerVoiceWeight: number;  // 0.0-1.0
  ratingCount: number;          // Approved, non-stale rating count (drives weight curve)
  signals: SignalBreakdown[];
  calculatedAt: string;         // ISO timestamp
}

interface TierInfo {
  tier: string;
  label: string;
  color: string;
}

// ─── Weight Curve Interpolation ───────────────────────────────────────────────
/**
 * Parse customer_weight_curve string from system_config.
 * Format: "0:0.10, 3:0.20, 10:0.30, 50:0.65, 200:0.70"
 * Returns sorted array of [ratingCount, weight] breakpoints.
 */
function parseWeightCurve(curveStr: string): Array<[number, number]> {
  return curveStr
    .split(',')
    .map((segment) => {
      const parts = segment.trim().split(':');
      return [parseFloat(parts[0]), parseFloat(parts[1])] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Linear interpolation between weight curve breakpoints.
 * Clamps to min/max of curve at the extremes.
 */
function interpolateWeight(ratingCount: number, curve: Array<[number, number]>): number {
  if (curve.length === 0) return 0.10; // Fallback

  // Clamp to min breakpoint
  if (ratingCount <= curve[0][0]) return curve[0][1];

  // Clamp to max breakpoint
  if (ratingCount >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];

  // Linear interpolation
  for (let i = 0; i < curve.length - 1; i++) {
    const [x0, y0] = curve[i];
    const [x1, y1] = curve[i + 1];
    if (ratingCount >= x0 && ratingCount <= x1) {
      const t = (ratingCount - x0) / (x1 - x0);
      return parseFloat((y0 + t * (y1 - y0)).toFixed(4));
    }
  }

  return curve[curve.length - 1][1];
}

// ─── Tier Resolution ──────────────────────────────────────────────────────────
/**
 * Determine trust tier from score and system_config thresholds.
 * Thresholds (from config): basic=20, trusted=60, highly_trusted=80
 * Gap at 40-59 is classified as basic (below trusted threshold).
 */
function resolveTrustTier(score: number, config: Record<string, string>): TierInfo {
  const highlyTrustedThreshold = parseInt(config['trust_tier_highly_trusted_threshold'] ?? '80', 10);
  const trustedThreshold       = parseInt(config['trust_tier_trusted_threshold'] ?? '60', 10);
  const basicThreshold         = parseInt(config['trust_tier_basic_threshold'] ?? '20', 10);

  if (score >= highlyTrustedThreshold) {
    return { tier: 'highly_trusted', label: 'Highly Trusted', color: '#2E7D72' };
  }
  if (score >= trustedThreshold) {
    return { tier: 'trusted', label: 'Trusted', color: '#6BA89E' };
  }
  if (score >= basicThreshold) {
    return { tier: 'basic', label: 'Basic', color: '#C8691A' };
  }
  return { tier: 'unverified', label: 'Unverified', color: '#6B6560' };
}

// ─── Signal Name → Human Label ────────────────────────────────────────────────
const SIGNAL_LABELS: Record<string, string> = {
  phoneVerified:       'Phone Verified',
  aadhaar_verified:     'Identity Verified (Aadhaar)',
  credential_verified:  'Professional Credential Verified',
  geo_verified:         'Location Verified',
  photo_uploaded:       'Profile Photo Uploaded',
  bio_added:            'Bio / Description Added',
  experience_added:     'Experience Details Added',
  profile_complete:     'Profile Complete',
  tsaas_consent:        'Trust Data Sharing (TSaaS)',
  isClaimed:           'Listing Claimed',
  rating_count_min:     'Has Received Ratings',
  subscription_active:  'Subscription Active',
};

function signalLabel(signalName: string): string {
  return SIGNAL_LABELS[signalName] ?? signalName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── snake_case → camelCase (for Prisma field access) ─────────────────────────
function toCamelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ─── Signal Evaluator ─────────────────────────────────────────────────────────
/**
 * Evaluate whether a signal is achieved for a given provider.
 * First checks special-case signals, then falls back to dynamic boolean
 * field lookup on the provider_profiles record (using camelCase Prisma field names).
 */
function evaluateSignal(
  signalName: string,
  provider: Record<string, unknown>,
  extras: {
    hasTsaasConsent: boolean;
    approvedRatingCount: number;
  },
): boolean {
  switch (signalName) {
    // Consent record — checked separately from provider_profiles booleans
    case 'tsaas_consent':
      return extras.hasTsaasConsent;

    // Photo — check photo_url or profile_photo_url field presence
    case 'photo_uploaded':
      return !!(provider['photoUrl'] || provider['profilePhotoUrl']);

    // Bio — non-empty bio/description
    case 'bio_added':
      return typeof provider['bio'] === 'string' && (provider['bio'] as string).trim().length > 0;

    // Experience — check experience_years or experience_text
    case 'experience_added':
      return !!(provider['experienceYears'] || provider['experienceText']);

    // Has at least N ratings (min defined by signal config context, use any count > 0)
    case 'rating_count_min':
      return extras.approvedRatingCount > 0;

    // Fallthrough: dynamic boolean field on provider_profiles
    // e.g. 'phone_verified' → provider.phoneVerified
    default: {
      const camelKey = toCamelCase(signalName);
      return provider[camelKey] === true;
    }
  }
}

// ─── Main Calculator ──────────────────────────────────────────────────────────
/**
 * Compute full trust breakdown for a provider.
 * Reads: trust_score_config, provider_profiles, ratings, consent_records, system_config.
 * Returns null if provider has no trust_score_config (misconfigured listing_type).
 */
export async function calculateTrustBreakdown(providerId: string): Promise<TrustBreakdown | null> {
  // ── Load config and provider in parallel ──────────────────────────────────
  const [config, provider] = await Promise.all([
    loadSystemConfig(),
    prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        user_id: true,
        listing_type: true,
        bio: true,
        profile_photo_s3_key: true,
        is_phone_verified: true,
        is_aadhaar_verified: true,
        is_geo_verified: true,
        has_credentials: true,
        slot_calendar_enabled: true,
        has_profile_photo: true,
        is_claimed: true,
        created_at: true,
      },
    }),
  ]);

  if (!provider) return null;

  // ── Load trust_score_config for this listing_type ─────────────────────────
  const signalConfigs = await prisma.trustScoreConfig.findMany({
    where: { listing_type: provider.listing_type, is_active: true },
    orderBy: { max_pts: 'desc' },
  });

  if (signalConfigs.length === 0) {
    logger.warn('trustCalculator: no active signals for listing type');
    return null;
  }

  // ── Load approved ratings ─────────────────────────────────────────────────
  const ratings = await prisma.rating.findMany({
    where: {
      provider_id: providerId,
      moderation_status: 'approved',
    },
    select: {
      overall_stars: true,
      weight_value: true,
      weight_type: true,
    },
  });

  // ── Check TSaaS consent ───────────────────────────────────────────────────
  const tsaasConsent = provider.user_id ? await prisma.consentRecord.findFirst({
    where: {
      user_id: provider.user_id,
      consent_type: 'DATA_SHARING_TSAAS',
      withdrawn_at: null,
    },
    select: { id: true },
  }) : null;

  // ── Evaluate signals ──────────────────────────────────────────────────────
  const providerAsRecord = provider as unknown as Record<string, unknown>;
  const approvedRatingCount = ratings.length;

  const evaluatedSignals: SignalBreakdown[] = signalConfigs.map((sig) => {
    const achieved = evaluateSignal(
      sig.signal_name,
      providerAsRecord,
      { hasTsaasConsent: tsaasConsent !== null, approvedRatingCount },
    );
    return {
      signal_name: sig.signal_name,
      label: signalLabel(sig.signal_name),
      achieved,
      achievedPts: achieved ? sig.max_pts : 0,
      max_pts: sig.max_pts,
    };
  });

  // ── Verification score (0-100) ─────────────────────────────────────────────
  // Sum achieved pts / raw_max_total from first config row (stored for this listing_type)
  const rawMaxTotal = signalConfigs[0].raw_max_total ?? signalConfigs.reduce((sum, s) => sum + s.max_pts, 0);
  const achievedPts = evaluatedSignals.reduce((sum, s) => sum + s.achievedPts, 0);
  const verificationScore = rawMaxTotal > 0
    ? Math.min(100, Math.round((achievedPts / rawMaxTotal) * 100))
    : 0;

  // ── Customer voice score (0-100) ──────────────────────────────────────────
  const totalWeight = ratings.reduce((sum, r) => sum + r.weight_value, 0);
  const weightedStarSum = ratings.reduce((sum, r) => sum + r.overall_stars * r.weight_value, 0);
  const weightedAvgStars = totalWeight > 0 ? weightedStarSum / totalWeight : 0;
  // 5 stars = 100 pts
  const customerVoiceScore = Math.round((weightedAvgStars / 5) * 100);

  // ── Customer voice weight via interpolated curve ───────────────────────────
  const curveStr = config['customer_weight_curve'] ?? '0:0.10, 3:0.20, 10:0.30, 50:0.65, 200:0.70';
  const maxVoiceWeight = parseFloat(config['customer_voice_max_weight'] ?? '0.70');
  const curve = parseWeightCurve(curveStr);
  const rawVoiceWeight = interpolateWeight(approvedRatingCount, curve);
  const customerVoiceWeight = Math.min(rawVoiceWeight, maxVoiceWeight);
  const verificationWeight = parseFloat((1.0 - customerVoiceWeight).toFixed(4));

  // ── Display score ─────────────────────────────────────────────────────────
  const displayScore = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        verificationScore * verificationWeight + customerVoiceScore * customerVoiceWeight,
      ),
    ),
  );

  // ── Tier ──────────────────────────────────────────────────────────────────
  const tierInfo = resolveTrustTier(displayScore, config);

  logger.debug('trustCalculator.result');

  return {
    provider_id: providerId,
    displayScore,
    rawMaxTotal,
    trust_tier: tierInfo.tier,
    trustTier: tierInfo.tier,
    tierColor: tierInfo.color,
    tierLabel: tierInfo.label,
    verificationScore,
    verificationWeight,
    verification_weight: verificationWeight,
    customerVoiceScore,
    customerVoiceWeight,
    rating_count: approvedRatingCount,
    ratingCount: approvedRatingCount,
    signals: evaluatedSignals,
    calculatedAt: new Date().toISOString(),
    peer_context_percentage: 0,
    has_certificate: false,
    certificate_id: null,
    has_calendar: false,
  };
}

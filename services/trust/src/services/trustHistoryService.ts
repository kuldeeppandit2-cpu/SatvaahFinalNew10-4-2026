/**
 * trustHistoryService.ts
 *
 * Trust biography — immutable chronological timeline of trust events.
 *
 * Returns:
 *   - Paginated list of trust events from trust_score_history (immutable, append-only)
 *   - Human-readable description of each event
 *   - Peer context: "You score higher than X% of [category] providers in Hyderabad"
 *
 * MASTER_CONTEXT: trust_score_history is IMMUTABLE. Never update or delete rows.
 */

import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrustEvent {
  id: string;
  eventType: string;
  eventLabel: string;       // Human-readable event name
  description: string;      // Full sentence: "Aadhaar identity verified — +30 pts"
  deltaPts: number;         // Can be positive or negative
  newDisplayScore: number;
  newTier: string | null;
  tierColor: string | null;
  eventAt: string;          // ISO timestamp
  isPositive: boolean;
}

export interface PeerContext {
  percentile: number;         // 0-100: "higher than X% of peers"
  peerCount: number;          // Total providers in same category + city
  categoryLabel: string;      // "individual_service providers"
  cityName: string;
  message: string;            // "You score higher than 73% of plumbers in Hyderabad"
}

export interface TrustHistoryResult {
  data: TrustEvent[];
  peerContext: PeerContext | null;
  meta: {
    total: number;
    page: number;
    pages: number;
    providerId: string;
    currentScore: number | null;
    currentTier: string | null;
  };
}

// ─── Event Type → Human Labels ────────────────────────────────────────────────
interface EventMeta {
  label: string;
  descriptionTemplate: (delta: number, tier?: string | null) => string;
}

const EVENT_META: Record<string, EventMeta> = {
  phone_otp_verified: {
    label: 'Phone Verified',
    descriptionTemplate: (d) => `Phone number verified via OTP${formatDelta(d)}`,
  },
  aadhaar_verified: {
    label: 'Aadhaar Verified',
    descriptionTemplate: (d) => `Identity verified via Aadhaar (DigiLocker)${formatDelta(d)}`,
  },
  geo_verified: {
    label: 'Location Verified',
    descriptionTemplate: (d) => `Service location verified${formatDelta(d)}`,
  },
  credential_submitted: {
    label: 'Credential Submitted',
    descriptionTemplate: (d) => `Professional credential submitted for review${formatDelta(d)}`,
  },
  credential_verified: {
    label: 'Credential Verified',
    descriptionTemplate: (d) => `Professional credential verified by SatvAAh${formatDelta(d)}`,
  },
  credential_rejected: {
    label: 'Credential Rejected',
    descriptionTemplate: (d) => `Credential verification unsuccessful${formatDelta(d)}`,
  },
  photo_uploaded: {
    label: 'Profile Photo Added',
    descriptionTemplate: (d) => `Profile photo uploaded${formatDelta(d)}`,
  },
  profile_completed: {
    label: 'Profile Completed',
    descriptionTemplate: (d) => `Profile completed with bio and experience details${formatDelta(d)}`,
  },
  rating_received: {
    label: 'Rating Received',
    descriptionTemplate: (d) => `New customer rating contributed to trust score${formatDelta(d)}`,
  },
  scrape_rating_imported: {
    label: 'External Rating Imported',
    descriptionTemplate: (d) => `Ratings imported from an external platform${formatDelta(d)}`,
  },
  tier_upgraded: {
    label: 'Tier Upgraded',
    descriptionTemplate: (d, tier) =>
      `Trust tier upgraded to ${formatTierLabel(tier ?? '')}${formatDelta(d)}`,
  },
  tier_downgraded: {
    label: 'Tier Downgraded',
    descriptionTemplate: (d, tier) =>
      `Trust tier changed to ${formatTierLabel(tier ?? '')}${formatDelta(d)}`,
  },
  tsaas_consent_granted: {
    label: 'TSaaS Consent Granted',
    descriptionTemplate: (d) => `Opted in to Trust-as-a-Service data sharing${formatDelta(d)}`,
  },
  tsaas_consent_withdrawn: {
    label: 'TSaaS Consent Withdrawn',
    descriptionTemplate: (d) => `Trust-as-a-Service data sharing consent withdrawn${formatDelta(d)}`,
  },
  certificate_issued: {
    label: 'Certificate of Verification Issued',
    descriptionTemplate: (d) =>
      `SatvAAh Certificate of Verification issued — score reached Highly Trusted${formatDelta(d)}`,
  },
  score_recalculated: {
    label: 'Score Recalculated',
    descriptionTemplate: (d) => `Trust score recalculated${formatDelta(d)}`,
  },
  trust_flag_raised: {
    label: 'Trust Flag Raised',
    descriptionTemplate: (d) => `A trust concern was raised for review${formatDelta(d)}`,
  },
  trust_flag_resolved: {
    label: 'Trust Flag Resolved',
    descriptionTemplate: (d) => `Trust concern resolved in your favour${formatDelta(d)}`,
  },
  subscription_upgraded: {
    label: 'Subscription Upgraded',
    descriptionTemplate: (d) => `Subscription plan upgraded${formatDelta(d)}`,
  },
};

function formatDelta(delta: number): string {
  if (delta === 0) return '';
  return delta > 0 ? ` (+${delta} pts)` : ` (${delta} pts)`;
}

function formatTierLabel(tier: string): string {
  const labels: Record<string, string> = {
    highly_trusted: 'Highly Trusted',
    trusted: 'Trusted',
    basic: 'Basic',
    unverified: 'Unverified',
  };
  return labels[tier] ?? tier;
}

const TIER_COLORS: Record<string, string> = {
  highly_trusted: '#2E7D72',
  trusted: '#6BA89E',
  basic: '#C8691A',
  unverified: '#6B6560',
};

function eventFromRow(row: {
  id: string;
  event_type: string;
  delta_pts: number;
  new_display_score: number;
  new_tier: string | null;
  event_at: Date;
}): TrustEvent {
  const meta = EVENT_META[row.event_type];
  const label = meta?.label ?? row.event_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const description = meta
    ? meta.descriptionTemplate(row.delta_pts, row.new_tier)
    : `Trust event: ${label}${formatDelta(row.delta_pts)}`;

  return {
    id:                row.id,
    eventType:         row.event_type,        // mobile reads eventType
    eventLabel:        label,
    description,
    delta_pts:         row.delta_pts,          // mobile reads delta_pts
    new_display_score: row.new_display_score,  // mobile reads new_display_score
    newTier:           row.new_tier,           // mobile reads newTier
    tierColor:         row.new_tier ? (TIER_COLORS[row.new_tier] ?? null) : null,
    event_at:          row.event_at.toISOString(), // mobile reads event_at
    isPositive:        row.delta_pts >= 0,
    // also expose camelCase aliases for the TrustEvent interface
    deltaPts:          row.delta_pts,
    newDisplayScore:   row.new_display_score,
    eventAt:           row.event_at.toISOString(),
  };
}

// ─── Peer Context ─────────────────────────────────────────────────────────────
/**
 * Calculate peer percentile:
 *   How many providers in the same listing_type + city_id have a LOWER score?
 *   percentile = countLower / total × 100
 *
 * Returns null if there are fewer than 5 peers (not enough data for context).
 */
async function buildPeerContext(
  providerId: string,
  currentScore: number,
): Promise<PeerContext | null> {
  try {
    const provider = await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: {
        listing_type: true,
        city_id: true,
        city: { select: { name: true } },
      },
    });

    if (!provider?.city_id) return null;

    // Count peers in same listing_type + city
    const [countLower, total] = await Promise.all([
      prisma.trustScore.count({
        where: {
          display_score: { lt: currentScore },
          provider: {
            listing_type: provider.listing_type,
            city_id: provider.city_id,
          },
        },
      }),
      prisma.trustScore.count({
        where: {
          provider: {
            listing_type: provider.listing_type,
            city_id: provider.city_id,
          },
        },
      }),
    ]);

    // Need at least 5 peers for meaningful context
    if (total < 5) return null;

    const percentile = Math.round((countLower / total) * 100);
    const categoryLabel = provider.listing_type.toLowerCase().replace(/_/g, ' ') + ' providers';
    const cityName = provider.city?.name ?? 'your city';

    const message =
      percentile >= 50
        ? `You score higher than ${percentile}% of ${categoryLabel} in ${cityName}`
        : `You score in the bottom ${100 - percentile}% of ${categoryLabel} in ${cityName} — keep building trust!`;

    return {
      percentile,
      peerCount: total,
      categoryLabel,
      cityName,
      message,
    };
  } catch (err) {
    // Peer context is best-effort — never fail the main response
    logger.warn('trustHistory.peerContext.failed');
    return null;
  }
}

// ─── Main Service Function ────────────────────────────────────────────────────
export async function getTrustHistory(
  providerId: string,
  page: number,
  limit: number,
): Promise<TrustHistoryResult> {
  const skip = (page - 1) * limit;

  // ── Parallel: history count + page + current trust score ─────────────────
  const [total, historyRows, trustScore] = await Promise.all([
    prisma.trustScoreHistory.count({ where: { provider_id: providerId } }),
    prisma.trustScoreHistory.findMany({
      where: { provider_id: providerId },
      orderBy: { event_at: 'desc' }, // Most recent first
      skip,
      take: limit,
      select: {
        id: true,
        event_type: true,
        delta_pts: true,
        new_display_score: true,
        new_tier: true,
        event_at: true,
      },
    }),
    prisma.trustScore.findUnique({
      where: { provider_id: providerId },
      select: { display_score: true, trust_tier: true },
    }),
  ]);

  const events: TrustEvent[] = historyRows.map(eventFromRow);

  // ── Peer context from current score ──────────────────────────────────────
  const peerContext = trustScore?.display_score != null
    ? await buildPeerContext(providerId, trustScore.display_score)
    : null;

  logger.info('trustHistory.fetched');

  return {
    data: events,
    peerContext,
    meta: {
      total,
      page,
      pages: Math.ceil(total / limit),
      provider_id: providerId,
      currentScore: trustScore?.display_score ?? null,
      currentTier: trustScore?.trust_tier ?? null,
    },
  };
}

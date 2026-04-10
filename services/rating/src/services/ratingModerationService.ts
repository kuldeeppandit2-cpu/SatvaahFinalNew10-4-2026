/**
 * Rating Moderation Service — services/rating/src/services/ratingModerationService.ts
 *
 * 10-step moderation pipeline for POST /api/v1/ratings.
 *
 * STEP 1:  Is contact_event required for this tab?  (services/expertise: YES, products/establishments: NO)
 * STEP 2:  Does contact_event exist and is status=accepted?
 * STEP 3:  Is daily tab limit exceeded?             (from system_config — NEVER hardcoded)
 * STEP 4:  Is same-provider 30-day cooldown active?
 * STEP 5:  Is account ≥7 days old?
 * STEP 6:  Is burst threshold exceeded?             (3 ratings in 60 min — FLAG ONLY, never block)
 * STEP 7:  Assign weight: verified_contact=1.0 | open_community=0.5 | scraped_external=0.3
 * STEPS 8-10: Handled by ratingService (INSERT, UPDATE usage, SQS)
 */
import { prisma } from '@satvaaah/db';
import { loadSystemConfig } from '@satvaaah/config';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';

export type WeightType = 'verified_contact' | 'open_community' | 'scraped_external';
export type ModerationStatus = 'approved' | 'held' | 'rejected';

export interface ModerationInput {
  consumerId: string;
  providerId: string;
  contactEventId: string | null;
  overallStars: number;
  correlationId: string;
}

export interface ModerationResult {
  allowed: boolean;
  blockReason?: string;
  blockMessage?: string;
  weightType: WeightType;
  weightValue: number;
  burstFlagged: boolean;
  moderationStatus: ModerationStatus;
  providerTab: string;
  consumerUserId: string;
  consumerProfileId: string;  // consumer_profiles.id — FK for rating INSERT
}

// tabs requiring contact_event (services + expertise)
const CONTACT_EVENT_REQUIRED_TABS = new Set(['services', 'expertise']);

// maps tab → system_config key for daily limit
export const TAB_CONFIG_KEYS: Record<string, string> = {
  products:       'rating_daily_limit_products',
  services:       'rating_daily_limit_services',
  expertise:      'rating_daily_limit_expertise',
  establishments: 'rating_daily_limit_establishments',
};

export async function runModerationPipeline(input: ModerationInput): Promise<ModerationResult> {
  const { consumerId, providerId, contactEventId, correlationId } = input;

  const config = await loadSystemConfig();

  // Pre-fetch required data in parallel
  const [provider, consumerProfile, consumerUser] = await Promise.all([
    prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { id: true, tab: true, user_id: true },
    }),
    prisma.consumerProfile.findFirst({
      where: { user_id: consumerId },
      select: { id: true, user_id: true },
    }),
    prisma.user.findUnique({
      where: { id: consumerId },
      select: { id: true, created_at: true, deleted_at: true },
    }),
  ]);

  if (!provider) throw new AppError('PROVIDER_NOT_FOUND', 'Provider not found.', 404);
  if (!consumerUser || consumerUser.deleted_at) throw new AppError('CONSUMER_NOT_FOUND', 'Consumer account not found.', 404);
  if (!consumerProfile) throw new AppError('CONSUMER_PROFILE_REQUIRED', 'Complete your consumer profile before submitting ratings.', 400);

  // consumerProfileId = consumer_profiles.id — used for ALL FK comparisons and DB inserts
  // consumerId (user.id) is only used for fetching the user/profile records above
  const consumerProfileId = consumerProfile.id;
  const providerTab = provider.tab;

  // ─── STEP 1: Is contact_event required for this tab? ──────────────────────
  const requiresContactEvent = CONTACT_EVENT_REQUIRED_TABS.has(providerTab);
  if (requiresContactEvent && !contactEventId) {
    logger.warn('rating');
    return _blocked('CONTACT_EVENT_REQUIRED',
      `Ratings for ${providerTab} providers require a verified interaction.`,
      providerTab, consumerId);
  }

  // ─── STEP 2: Does contact_event exist and is status=accepted? ─────────────
  let contactEvent: { id: string; consumer_id: string; provider_id: string; status: string } | null = null;
  if (contactEventId) {
    contactEvent = await prisma.contactEvent.findUnique({
      where: { id: contactEventId },
      select: { id: true, consumer_id: true, provider_id: true, status: true },
    });
    if (!contactEvent) {
      return _blocked('CONTACT_EVENT_NOT_FOUND', 'The interaction record was not found.', providerTab, consumerId);
    }
    if (contactEvent.consumer_id !== consumerProfileId || contactEvent.provider_id !== providerId) {
      return _blocked('CONTACT_EVENT_MISMATCH', 'This interaction does not belong to you or this provider.', providerTab, consumerId);
    }
    if (contactEvent.status !== 'accepted') {
      return _blocked('CONTACT_EVENT_NOT_ACCEPTED',
        'You can only rate a provider after they have accepted your contact request.',
        providerTab, consumerId);
    }
  }

  // ─── STEP 3: Daily tab limit exceeded? (ALL from system_config) ───────────
  const dailyLimitKey = TAB_CONFIG_KEYS[providerTab];
  if (!dailyLimitKey) throw new AppError('UNKNOWN_TAB', `Unknown provider tab: ${providerTab}`, 500);

  const dailyLimit = parseInt(config[dailyLimitKey] ?? '5', 10);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const usageRecord = await prisma.dailyRatingUsage.findUnique({
    where: { consumerId_tab_date: { consumer_id: consumerProfileId, tab: providerTab, date: today } },
    select: { ratings_submitted: true },
  });
  const usedToday = usageRecord?.ratings_submitted ?? 0;

  if (usedToday >= dailyLimit) {
    logger.warn('rating');
    return _blocked('DAILY_LIMIT_EXCEEDED',
      `You have reached your daily limit of ${dailyLimit} ratings for ${providerTab}. Resets at midnight.`,
      providerTab, consumerId);
  }

  // ─── STEP 4: Same-provider 30-day cooldown ────────────────────────────────
  const cooldownDays = parseInt(config['rating_same_provider_cooldown_days'] ?? '30', 10);
  const cooldownSince = new Date();
  cooldownSince.setDate(cooldownSince.getDate() - cooldownDays);

  const recentRating = await prisma.rating.findFirst({
    where: {
      consumer_id: consumerProfileId, provider_id: providerId,
      created_at: { gte: cooldownSince },
      moderation_status: { not: 'rejected' },
    },
    select: { id: true, created_at: true },
    orderBy: { created_at: 'desc' },
  });

  if (recentRating) {
    const nextEligible = new Date(recentRating.created_at);
    nextEligible.setDate(nextEligible.getDate() + cooldownDays);
    logger.warn('rating');
    return _blocked('COOLDOWN_ACTIVE',
      `One rating per provider every ${cooldownDays} days. Next eligible: ${nextEligible.toLocaleDateString('en-IN')}.`,
      providerTab, consumerId);
  }

  // ─── STEP 5: Account ≥7 days old ─────────────────────────────────────────
  const minAccountAgeDays = parseInt(config['rating_min_account_age_days'] ?? '7', 10);
  const accountAgeDays = (Date.now() - consumerUser.created_at.getTime()) / (1000 * 60 * 60 * 24);
  if (accountAgeDays < minAccountAgeDays) {
    const daysRemaining = Math.ceil(minAccountAgeDays - accountAgeDays);
    logger.warn('rating');
    return _blocked('ACCOUNT_TOO_NEW',
      `Account must be ≥${minAccountAgeDays} days old. You can rate in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}.`,
      providerTab, consumerId);
  }

  // ─── STEP 6: Burst threshold (FLAG ONLY — never block) ───────────────────
  const burstWindowMinutes = parseInt(config['rating_burst_window_minutes'] ?? '60', 10);
  const burstThreshold = parseInt(config['rating_burst_threshold'] ?? '3', 10);
  const burstWindowSince = new Date(Date.now() - burstWindowMinutes * 60 * 1000);

  const recentCount = await prisma.rating.count({
    where: { consumer_id: consumerProfileId, created_at: { gte: burstWindowSince } },
  });

  const burstFlagged = recentCount >= burstThreshold;
  if (burstFlagged) {
    logger.warn('rating');
  }

  // ─── STEP 7: Assign weight ────────────────────────────────────────────────
  // verified_contact: contact_event present + accepted → 1.0 (from system_config)
  // open_community: no contact_event → 0.5 (from system_config)
  let weightType: WeightType;
  let weightValue: number;

  if (contactEvent && contactEvent.status === 'accepted') {
    weightType = 'verified_contact';
    weightValue = parseFloat(config['rating_weight_verified_contact'] ?? '1.0');
  } else {
    weightType = 'open_community';
    weightValue = parseFloat(config['rating_weight_open_community'] ?? '0.5');
  }

  logger.info('rating');

  return {
    allowed: true,
    weightType, weightValue, burstFlagged,
    moderationStatus: 'approved',
    providerTab, consumerUserId: consumerId, consumerProfileId: consumerProfile!.id,
  };
}

function _blocked(reason: string, message: string, providerTab: string, consumerUserId: string): ModerationResult {
  return {
    allowed: false, blockReason: reason, blockMessage: message,
    weightType: 'open_community', weightValue: 0,
    burstFlagged: false, moderationStatus: 'rejected',
    providerTab, consumerUserId, consumerProfileId: '',
  };
}

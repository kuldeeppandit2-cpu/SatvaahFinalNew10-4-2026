/**
 * SatvAAh — services/rating/src/services/ratingService.ts
 *
 * Orchestrates the full rating submission flow.
 *
 * Steps 1–7 → ratingModerationService.runModerationPipeline()
 * Step  8   → INSERT rating (this file)
 * Step  9   → UPSERT daily_rating_usage (this file)
 * Step  10  → SQS → trust-score-updates (this file)
 *
 * Also exposes:
 *   getRatingEligibility()  — for GET /api/v1/ratings/eligibility/:providerId
 *
 * Rating bonus:
 *   Consumer earns +N leads after any successful rating submission.
 *   N = system_config.rating_bonus_leads (default 2). Never hardcoded.
 */

import { prisma } from '@satvaaah/db';
import { loadSystemConfig } from '@satvaaah/config';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';
import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandInput,
} from '@aws-sdk/client-sqs';
import { runModerationPipeline, TAB_CONFIG_KEYS } from './ratingModerationService';

// ── SQS ───────────────────────────────────────────────────────────────────────

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  ...(process.env.AWS_ENDPOINT_URL
    ? { endpoint: process.env.AWS_ENDPOINT_URL }
    : {}),
});
const TRUST_SCORE_UPDATES_QUEUE_URL =
  process.env.SQS_TRUST_SCORE_UPDATES_URL ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SubmitRatingInput {
  consumerId: string;
  providerId: string;
  contactEventId?: string | null;
  overallStars: number;
  text?: string;
  dimensionsData?: Record<string, number>;
  correlationId: string;
}

export interface RatingEligibilityResult {
  eligible: boolean;
  reason?: string;
  daily_remaining: number;
  tab?: string;
  // Echoed back so mobile can pass to submitRating without storing separately
  providerId?: string;
  contactEventId?: string | null;
  ratingDimensions?: Record<string, unknown>[] | null;
}

export interface SubmitRatingResult {
  ratingId: string;
  weightType: string;
  weightValue: number;
  isBurstFlagged: boolean;
  moderationStatus: string;
  bonusLeadsGranted: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayAtMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function getDailyRemaining(
  consumerId: string,
  tab: string,
  config: Record<string, string>
): Promise<number> {
  const limitKey = TAB_CONFIG_KEYS[tab];
  const dailyLimit = limitKey ? parseInt(config[limitKey] ?? '5', 10) : 5;
  const today = todayAtMidnight();

  const usageRow = await prisma.dailyRatingUsage.findUnique({
    where: { consumerId_tab_date: { consumer_id: consumerId, tab, date: today } },
    select: { ratings_submitted: true },
  });

  return Math.max(0, dailyLimit - (usageRow?.ratings_submitted ?? 0));
}

// ── Eligibility ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/ratings/eligibility/:providerId
 *
 * Lightweight pre-submission check — does NOT run the full pipeline.
 * Checks: daily limit, 30-day cooldown, account age.
 * Returns { eligible, reason?, daily_remaining }.
 */
export async function getRatingEligibility(
  userId: string,
  providerId: string,
  correlationId: string
): Promise<RatingEligibilityResult> {
  const config = await loadSystemConfig();

  const [provider, consumerProfile] = await Promise.all([
    prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { tab: true },
    }),
    prisma.consumerProfile.findFirst({
      where: { user_id: userId },
      select: { id: true },
    }),
  ]);

  if (!provider) {
    return { eligible: false, reason: 'Provider not found.', daily_remaining: 0 };
  }
  if (!consumerProfile) {
    return { eligible: false, reason: 'Consumer profile not found.', daily_remaining: 0 };
  }

  const consumerId = consumerProfile.id;  // consumer_profiles.id — FK for daily_rating_usage
  const tab = provider.tab;
  const dailyRemaining = await getDailyRemaining(consumerId, tab, config);

  if (dailyRemaining <= 0) {
    return {
      eligible: false,
      reason: `Daily ${tab} rating limit reached. Resets at midnight.`,
      daily_remaining: 0,
      tab,
    };
  }

  // 30-day cooldown
  const cooldownDays = parseInt(
    config['rating_same_provider_cooldown_days'] ?? '30', 10
  );
  const cooldownSince = new Date();
  cooldownSince.setDate(cooldownSince.getDate() - cooldownDays);

  const recentRating = await prisma.rating.findFirst({
    where: {
      consumer_id: consumerId, provider_id: providerId,
      created_at: { gte: cooldownSince },
      moderation_status: { not: 'rejected' },
    },
    select: { created_at: true },
    orderBy: { created_at: 'desc' },
  });

  if (recentRating) {
    const nextAllowed = new Date(recentRating.created_at);
    nextAllowed.setDate(nextAllowed.getDate() + cooldownDays);
    return {
      eligible: false,
      reason: `Cooldown active. Next allowed: ${nextAllowed.toLocaleDateString('en-IN')}.`,
      daily_remaining: dailyRemaining,
      tab,
    };
  }

  // Account age
  const minAgeDays = parseInt(config['rating_min_account_age_days'] ?? '7', 10);
  const consumerUser = await prisma.user.findUnique({
    where: { id: consumerId },
    select: { created_at: true },
  });

  if (consumerUser) {
    const ageDays = (Date.now() - consumerUser.created_at.getTime()) / 86_400_000;
    if (ageDays < minAgeDays) {
      const daysLeft = Math.ceil(minAgeDays - ageDays);
      return {
        eligible: false,
        reason: `Account must be ≥${minAgeDays} days old. Eligible in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}.`,
        daily_remaining: dailyRemaining,
        tab,
      };
    }
  }

  logger.info('rating');

  // Find most recent accepted contact event for this consumer + provider
  // Used by mobile to determine verified vs open-community rating weight
  const recentEvent = await prisma.contactEvent.findFirst({
    where: {
      consumer_id: consumerProfile.id,
      provider_id: providerId,
      status: 'accepted',
    },
    orderBy: { created_at: 'desc' },
    select: { id: true },
  });

  // Fetch rating dimensions for this provider's tab (shown in rating UI)
  const taxonomyNode = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { taxonomy_node: { select: { rating_dimensions: true } } },
  });

  return {
    eligible:          true,
    daily_remaining:   dailyRemaining,
    tab,
    providerId,
    contactEventId:    recentEvent?.id ?? null,
    ratingDimensions:  taxonomyNode?.taxonomy_node?.rating_dimensions ?? null,
  };
}

// ── Submit Rating (Steps 8, 9, 10) ────────────────────────────────────────────

/**
 * POST /api/v1/ratings
 *
 * Runs the full 10-step moderation pipeline, then:
 *  Step 8:  INSERT rating
 *  Step 9:  UPSERT daily_rating_usage
 *  Step 10: SQS → trust-score-updates
 *  Bonus:   +N leads granted to consumer
 */
export async function submitRating(
  input: SubmitRatingInput
): Promise<SubmitRatingResult> {
  const {
    consumerId, providerId, contactEventId,
    overallStars, text, dimensionsData, correlationId,
  } = input;

  const config = await loadSystemConfig();

  // ── Steps 1–7: Moderation pipeline ──────────────────────────────────────
  const modResult = await runModerationPipeline({
    consumer_id: consumerId,
    provider_id: providerId,
    contactEventId: contactEventId ?? null,
    overallStars,
    correlationId,
  });

  if (!modResult.allowed) {
    throw new AppError(
      modResult.blockReason ?? 'MODERATION_FAILED',
      modResult.blockMessage ?? 'Rating did not pass moderation.',
      422
    );
  }

  const { weightType, weightValue, burstFlagged, providerTab, consumerProfileId } = modResult;

  // Burst-flagged ratings enter as FLAGGED (still counted, but under review)
  const initialStatus = burstFlagged ? 'flagged' : 'approved';

  // ── Step 8: INSERT rating ────────────────────────────────────────────────
  const newRating = await prisma.rating.create({
    data: {
      provider_id:       providerId,
      consumer_id:       consumerProfileId,  // consumer_profiles.id FK
      contact_event_id:  contactEventId ?? null,
      overall_stars:     overallStars,
      weight_type:       weightType as any,
      weight_value:      weightValue,
      moderation_status: initialStatus as any,
      review_text:       text ?? null,
      dimension_scores:  dimensionsData ?? {},
    },
    select: {
      id: true,
      moderation_status: true,
      weight_type: true,
      weight_value: true,
    },
  });

  logger.info('rating');

  // ── Step 9: UPSERT daily_rating_usage ───────────────────────────────────
  const today = todayAtMidnight();

  await prisma.dailyRatingUsage.upsert({
    where: { consumerId_tab_date: { consumer_id: consumerProfileId, tab: providerTab, date: today } },
    create: { consumer_id: consumerProfileId, tab: providerTab, date: today, ratings_submitted: 1 },
    update: { ratings_submitted: { increment: 1 } },
  });

  logger.info('rating');

  // ── Step 10: SQS → trust-score-updates ─────────────────────────────────
  await sendTrustScoreUpdate({
    event: 'rating_submitted',
    provider_id: providerId,
    ratingId: newRating.id,
    weight_type: weightType,
    weight_value: weightValue,
    correlation_id: correlationId,
    timestamp: new Date().toISOString(),
  });

  logger.info('rating');

  // ── Bonus: consumer earns +N leads ───────────────────────────────────────
  // CRITICAL_RULE #20 — rating_bonus_leads from system_config, never hardcoded
  const bonusLeads = parseInt(config['rating_bonus_leads'] ?? '2', 10);
  let bonusLeadsGranted = 0;

  try {
    const now = new Date();
    const activeUsage = await prisma.consumerLeadUsage.findFirst({
      where: {
        consumer_id: consumerId,
        period_start: { lte: now },
        period_end:   { gte: now },
      },
      select: { id: true },
    });

    if (activeUsage) {
      await prisma.consumerLeadUsage.update({
        where: { id: activeUsage.id },
        data:  { leads_allocated: { increment: bonusLeads } },
      });
      bonusLeadsGranted = bonusLeads;

      logger.info('rating');
    } else {
      logger.info('rating');
    }
  } catch (err) {
    // Never fail the submission over bonus lead failure
    logger.error('rating');
  }

  return {
    ratingId:          newRating.id,
    weightType:        newRating.weight_type as string,
    weightValue:       Number(newRating.weight_value),
    isBurstFlagged:    burstFlagged,
    moderationStatus:  newRating.moderation_status as string,
    bonusLeadsGranted,
  };
}

// ── SQS helpers ───────────────────────────────────────────────────────────────

interface TrustUpdateMessage {
  event: string;
  providerId: string;
  ratingId: string;
  weightType: string;
  weightValue: number;
  correlation_id: string;
  timestamp: string;
}

async function sendTrustScoreUpdate(payload: TrustUpdateMessage): Promise<void> {
  if (!TRUST_SCORE_UPDATES_QUEUE_URL) {
    logger.warn('rating');
    return;
  }

  const params: SendMessageCommandInput = {
    QueueUrl: TRUST_SCORE_UPDATES_QUEUE_URL,
    MessageBody: JSON.stringify(payload),
    MessageGroupId: payload.providerId,
    MessageDeduplicationId: `${payload.event}-${payload.ratingId}-${Date.now()}`,
    MessageAttributes: {
      correlationId: { DataType: 'String', StringValue: payload.correlationId },
      eventType:     { DataType: 'String', StringValue: payload.event },
    },
  };

  try {
    const result = await sqsClient.send(new SendMessageCommand(params));
    logger.info('rating');
  } catch (err) {
    // Never fail the API over SQS — rating already committed to DB
    logger.error('rating');
  }
}

/**
 * SatvAAh — services/rating/src/services/consumerTrustService.ts
 *
 * Two responsibilities:
 *
 * 1. POST /api/v1/consumer-ratings  (provider → consumer)
 *    Provider rates a consumer after an accepted contact_event.
 *    Validates contact_event ownership + accepted status.
 *    Inserts consumer_rating record.
 *    Sends SQS → trust-score-updates so Lambda recalculates
 *    consumer_profiles.trust_score.
 *    NEVER writes trust_score directly from app code.
 *
 * 2. GET /api/v1/consumers/me/trust
 *    Returns the stored trust_score from consumer_profiles
 *    plus a real-time 6-signal breakdown for display.
 *
 * CONSUMER TRUST MODEL:
 *   Baseline: 75 (consumer_profiles.trust_score DEFAULT 75)
 *   Range:    0–100
 *   Written:  ONLY via SQS → Lambda (lambdas/trust-recalculate/)
 *
 *   6 Signals (all weights from system_config — never hardcoded):
 *     1. phone_verified            — OTP-verified mobile number
 *     2. profile_complete          — display_name + city_id filled
 *     3. ratings_given             — submitted ≥N approved ratings
 *     4. completed_interactions    — at least N accepted contact_events
 *     5. no_abuse_flags            — no unresolved fraud flags (last 90 days)
 *     6. subscription_tier         — active Silver or Gold subscription
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

export interface SubmitConsumerRatingInput {
  /** JWT sub of the caller — must be a registered provider */
  callerUserId: string;
  /** consumerId being rated (user.id) */
  consumerId: string;
  /** The contact_event that backs this rating */
  contactEventId: string;
  overallStars: number;
  reviewText?: string;
  correlationId: string;
}

export interface ConsumerRatingResult {
  message: string;
  consumerId: string;
  trustRecalculation: 'queued';
}

export interface TrustSignal {
  signal: string;
  label: string;
  achieved: boolean;
  pts: number;
  max_pts: number;
  description: string;
}

export interface ConsumerTrustResult {
  trustScore: number;
  signals: TrustSignal[];
  totalPossible: number;
  baseline: number;
  note: string;
}

// ── Submit consumer rating (provider → consumer) ──────────────────────────────

export async function submitConsumerRating(
  input: SubmitConsumerRatingInput
): Promise<ConsumerRatingResult> {
  const {
    callerUserId,
    consumerId,
    contactEventId,
    overallStars,
    reviewText,
    correlationId,
  } = input;

  // Validate stars range
  if (overallStars < 1 || overallStars > 5 || !Number.isInteger(overallStars)) {
    throw new AppError(
      'INVALID_STARS',
      'overall_stars must be an integer between 1 and 5.',
      422
    );
  }

  // ── Confirm caller is a registered provider ───────────────────────────────
  const providerProfile = await prisma.providerProfile.findFirst({
    where: { user_id: callerUserId },
    select: { id: true },
  });

  if (!providerProfile) {
    throw new AppError(
      'NOT_A_PROVIDER',
      'Only registered providers can submit consumer ratings.',
      403
    );
  }

  // ── Validate contact_event exists, belongs to this pair, is accepted ──────
  const contactEvent = await prisma.contactEvent.findUnique({
    where: { id: contactEventId },
    select: {
      id: true,
      consumer_id: true,
      provider_id: true,
      status: true,
    },
  });

  if (!contactEvent) {
    throw new AppError(
      'CONTACT_EVENT_NOT_FOUND',
      'The specified interaction was not found.',
      404
    );
  }

  // The contact_event's provider must be the caller
  if (contactEvent.provider_id !== providerProfile.id) {
    throw new AppError(
      'CONTACT_EVENT_NOT_YOURS',
      'You can only rate consumers from your own accepted interactions.',
      403
    );
  }

  // The contact_event's consumer must match the target
  if (contactEvent.consumer_id !== consumerId) {
    throw new AppError(
      'CONSUMER_MISMATCH',
      'This interaction does not involve the specified consumer.',
      400
    );
  }

  // Only rate after the consumer's contact was accepted
  if (contactEvent.status !== 'accepted') {
    throw new AppError(
      'CONTACT_EVENT_NOT_ACCEPTED',
      'You can only rate a consumer after accepting their contact request.',
      422
    );
  }

  // ── Prevent duplicate rating on same contact_event ────────────────────────
  const existing = await prisma.consumerRating.findFirst({
    where: { provider_id: providerProfile.id, contact_event_id: contactEventId },
    select: { id: true },
  });

  if (existing) {
    throw new AppError(
      'ALREADY_RATED',
      'You have already submitted a rating for this interaction.',
      409
    );
  }

  // ── Validate consumer profile exists ─────────────────────────────────────
  const consumerProfile = await prisma.consumerProfile.findFirst({
    where: { user_id: consumerId },
    select: { id: true },
  });

  if (!consumerProfile) {
    throw new AppError('CONSUMER_NOT_FOUND', 'Consumer profile not found.', 404);
  }

  // ── INSERT consumer_rating ────────────────────────────────────────────────
  const consumerRating = await prisma.consumerRating.create({
    data: {
      provider_id: providerProfile.id,
      consumer_id: consumerId,
      contactEventId,
      overallStars,
      reviewNote: reviewText ?? null,  // schema field: review_note → Prisma: reviewNote
    },
    select: { id: true },
  });

  logger.info('rating');

  // ── SQS → trust-score-updates ─────────────────────────────────────────────
  // Lambda (lambdas/trust-recalculate/) recalculates consumer_profiles.trust_score
  // CRITICAL: Never write trust_score directly — CRITICAL_RULE #4 equivalent
  await sendConsumerTrustUpdate({
    event: 'CONSUMER_RATING_SUBMITTED',
    consumer_id: consumerId,
    provider_id: providerProfile.id,
    contact_event_id: contactEventId,
    consumer_rating_id: consumerRating.id,
    stars: overallStars,
    correlation_id: correlationId,
    timestamp: new Date().toISOString(),
  });

  logger.info('rating');

  return {
    message: 'Consumer rating submitted. Trust score will be updated shortly.',
    consumerId: consumerId,
    trustRecalculation: 'queued',
  };
}

// ── Get consumer trust breakdown ──────────────────────────────────────────────

export async function getConsumerTrust(
  consumerId: string,
  correlationId: string
): Promise<ConsumerTrustResult> {
  const config = await loadSystemConfig();

  // ── Parallel data fetch ───────────────────────────────────────────────────
  const [consumerUser, consumerProfile, ratingCount, completedEventCount] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: consumerId },
        select: {
          id: true,
          phone_verified: true,
          subscription_tier: true,
          deleted_at: true,
        },
      }),
      prisma.consumerProfile.findFirst({
        where: { user_id: consumerId },
        select: {
          id: true,
          trust_score: true,
          display_name: true,
          city_id: true,
        },
      }),
      // Signal 3: ratings given (approved only)
      // NOTE: ratings.consumer_id is consumer_profiles.id — NOT users.id
      // consumerProfile is resolved above in the same Promise.all — but since
      // we need consumerProfile.id here and it's fetched in parallel, we
      // resolve it in a second pass below after consumerProfile is known.
      Promise.resolve(0),
      // Signal 4: accepted contact events (same FK issue — resolved below)
      Promise.resolve(0),
    ]);

  if (!consumerUser || consumerUser.deleted_at) {
    throw new AppError('CONSUMER_NOT_FOUND', 'Consumer account not found.', 404);
  }

  if (!consumerProfile) {
    throw new AppError(
      'CONSUMER_PROFILE_NOT_FOUND',
      'Consumer profile not found. Please complete your profile setup.',
      404
    );
  }

  // Signal 3 + 4: now that consumerProfile is resolved, use consumerProfile.id
  // ratings.consumer_id and contact_events.consumer_id are consumer_profiles.id (NOT users.id)
  // Note: ratingCount and completedEventCount were placeholder 0s in the parallel fetch above.
  // Re-assign here with real values using the now-resolved consumerProfile.id.
  const [ratingCountReal, completedEventCountReal] = await Promise.all([
    prisma.rating.count({
      where: { consumer_id: consumerProfile.id, moderation_status: 'approved' },
    }),
    prisma.contactEvent.count({
      where: { consumer_id: consumerProfile.id, status: 'accepted' },
    }),
  ]);
  // Use the real values for signal computation below
  const ratingCountFinal = ratingCountReal;
  const completedEventCountFinal = completedEventCountReal;

  // Signal 5: abuse flags — query separately to enable subquery
  const consumerRatingIds = await prisma.rating
    .findMany({ where: { consumer_id: consumerId }, select: { id: true } })
    .then((rs) => rs.map((r) => r.id));

  const abuseWindowDays = parseInt(
    config['consumer_trust_abuse_window_days'] ?? '90',
    10
  );
  const abuseWindowStart = new Date(
    Date.now() - abuseWindowDays * 24 * 60 * 60 * 1000
  );

  const abuseFlagCount =
    consumerRatingIds.length > 0
      ? await prisma.trustFlag.count({
          where: {
            ratingId: { in: consumerRatingIds },
            flag_type: { in: ['FAKE_REVIEW', 'BURST_SUBMISSION', 'COMPETITOR_REVIEW'] as any[] },
            status: { not: 'RESOLVED' as any },
            created_at: { gte: abuseWindowStart },
          },
        })
      : 0;

  // ── Signal weights from system_config (CRITICAL_RULE #20) ────────────────
  const sigPhoneVerified = parseInt(
    config['consumer_trust_signal_phone_verified'] ?? '5', 10
  );
  const sigProfileComplete = parseInt(
    config['consumer_trust_signal_profile_complete'] ?? '5', 10
  );
  const sigRatingsGiven = parseInt(
    config['consumer_trust_signal_ratings_given'] ?? '5', 10
  );
  const sigCompletedInteractions = parseInt(
    config['consumer_trust_signal_completed_interactions'] ?? '5', 10
  );
  const sigNoAbuse = parseInt(
    config['consumer_trust_signal_no_abuse'] ?? '10', 10
  );
  const sigSubscription = parseInt(
    config['consumer_trust_signal_subscription'] ?? '5', 10
  );
  const minRatingsForSignal = parseInt(
    config['consumer_trust_min_ratings_for_signal'] ?? '3', 10
  );
  const minEventsForSignal = parseInt(
    config['consumer_trust_min_events_for_signal'] ?? '1', 10
  );

  // ── Evaluate all 6 signals ────────────────────────────────────────────────

  // 1. Phone verified (baseline — all users are OTP-verified; this is always true)
  const sig1 = Boolean(consumerUser.phone_verified);

  // 2. Profile complete: display_name + city_id filled
  const sig2 = Boolean(consumerProfile.display_name && consumerProfile.city_id);

  // 3. Has submitted ≥N approved ratings (engaged community member)
  const sig3 = ratingCountFinal >= minRatingsForSignal;

  // 4. Has ≥N accepted contact events (real-world interactions)
  const sig4 = completedEventCountFinal >= minEventsForSignal;

  // 5. No unresolved abuse flags on their ratings in the last N days
  const sig5 = abuseFlagCount === 0;

  // 6. Paid subscriber (Silver or Gold tier)
  const sig6 =
    consumerUser.subscription_tier === 'silver' ||
    consumerUser.subscription_tier === 'gold';

  const signals: TrustSignal[] = [
    {
      signal: 'phone_verified',
      label: 'Phone Verified',
      achieved: sig1,
      pts: sig1 ? sigPhoneVerified : 0,
      max_pts: sigPhoneVerified,
      description: 'Your account has an OTP-verified mobile number.',
    },
    {
      signal: 'profile_complete',
      label: 'Profile Complete',
      achieved: sig2,
      pts: sig2 ? sigProfileComplete : 0,
      max_pts: sigProfileComplete,
      description: 'Your display name and city are set on your profile.',
    },
    {
      signal: 'ratings_given',
      label: `${minRatingsForSignal}+ Ratings Submitted`,
      achieved: sig3,
      pts: sig3 ? sigRatingsGiven : 0,
      max_pts: sigRatingsGiven,
      description: `Submitted at least ${minRatingsForSignal} approved ratings. Yours: ${ratingCountFinal}.`,
    },
    {
      signal: 'completed_interactions',
      label: 'Completed Interactions',
      achieved: sig4,
      pts: sig4 ? sigCompletedInteractions : 0,
      max_pts: sigCompletedInteractions,
      description: `At least ${minEventsForSignal} accepted contact event(s). Yours: ${completedEventCountFinal}.`,
    },
    {
      signal: 'no_abuse_flags',
      label: 'No Abuse Flags',
      achieved: sig5,
      pts: sig5 ? sigNoAbuse : 0,
      max_pts: sigNoAbuse,
      description: `No unresolved fraud or abuse flags on your ratings in the past ${abuseWindowDays} days.`,
    },
    {
      signal: 'subscription_tier',
      label: 'Paid Subscriber',
      achieved: sig6,
      pts: sig6 ? sigSubscription : 0,
      max_pts: sigSubscription,
      description: 'Active Silver or Gold subscription.',
    },
  ];

  const totalPossible =
    sigPhoneVerified +
    sigProfileComplete +
    sigRatingsGiven +
    sigCompletedInteractions +
    sigNoAbuse +
    sigSubscription;

  logger.info('rating');

  return {
    trustScore:    consumerProfile.trust_score,   // camelCase for mobile
    trust_score:   consumerProfile.trust_score,   // snake alias
    signals,
    totalPossible,
    baseline: 75,
    note: 'Consumer trust starts at 75 and is updated by provider ratings and engagement signals.',
  };
}

// ── SQS helper ────────────────────────────────────────────────────────────────

interface ConsumerTrustUpdateMessage {
  event: string;
  consumerId: string;
  providerId: string;
  contactEventId: string;
  consumer_rating_id: string;
  stars: number;
  correlation_id: string;
  timestamp: string;
}

async function sendConsumerTrustUpdate(
  payload: ConsumerTrustUpdateMessage
): Promise<void> {
  if (!TRUST_SCORE_UPDATES_QUEUE_URL) {
    logger.warn('rating');
    return;
  }

  const params: SendMessageCommandInput = {
    QueueUrl: TRUST_SCORE_UPDATES_QUEUE_URL,
    MessageBody: JSON.stringify(payload),
    // Group by consumerId so Lambda processes sequentially per consumer
    MessageGroupId: payload.consumer_id,
    MessageDeduplicationId: `${payload.event}-${payload.consumer_rating_id}-${Date.now()}`,
    MessageAttributes: {
      correlationId: {
        DataType: 'String',
        StringValue: payload.correlation_id,
      },
      eventType: {
        DataType: 'String',
        StringValue: payload.event,
      },
    },
  };

  try {
    const command = new SendMessageCommand(params);
    const result = await sqsClient.send(command);
    logger.info('rating');
  } catch (err) {
    // Never fail the API over SQS unavailability
    logger.error('rating');
  }
}

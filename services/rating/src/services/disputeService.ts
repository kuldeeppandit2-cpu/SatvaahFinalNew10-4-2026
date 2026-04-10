/**
 * SatvAAh — services/rating/src/services/disputeService.ts
 *
 * POST /api/v1/ratings/:id/flag
 *
 * Access policy:
 *   Only the provider whose profile was rated may flag a rating.
 *   Consumers cannot self-flag ratings they submitted.
 *   Admin resolves via PATCH /api/v1/admin/disputes/:id (port 3009).
 *
 * What flagRating() does:
 *  1. Validate: rating exists
 *  2. Validate: caller is the rated provider (JWT userId → providerProfile.id match)
 *  3. Guard: prevent double-flagging (HELD or REJECTED already)
 *  4. Set rating.moderationStatus = HELD         (excluded from trust calc)
 *  5. Set rating.weightValue = rating_held_weight (system_config, default 0.1)
 *  6. INSERT trust_flags record                  (surfaced in admin dispute queue)
 *  7. SQS → trust-score-updates                  (Lambda recalculates immediately)
 *
 * On admin resolution:
 *   DISMISSED → rating.moderationStatus=APPROVED, weight restored
 *   UPHELD    → rating.moderationStatus=REJECTED, weight=0
 *   (handled in services/admin/ — port 3009)
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

export interface FlagRatingInput {
  ratingId: string;
  /** JWT sub of the caller (users.id — NOT provider_profile.id) */
  callerUserId: string;
  reason: string;
  evidenceNotes?: string;
  correlationId: string;
}

export interface FlagRatingResult {
  flag_id: string;
  rating_id: string;
  moderationStatus: 'HELD';
  weightValue: number;
  message: string;
}

// ── Reason → enum mappings ────────────────────────────────────────────────────

/** Maps the user-facing reason key to the trust_flags.flagType DB enum (V026). */
const FLAG_TYPE_MAP: Record<string, string> = {
  // Maps user-facing reason → TrustFlagType enum values (schema.prisma)
  fake_review:      'rating_manipulation',
  competitor:       'rating_manipulation',
  blackmail:        'policy_violation',
  wrong_provider:   'policy_violation',
  abusive_content:  'policy_violation',
  other:            'OTHER',
};

/**
 * Admin prioritisation severity.
 * Matched against trust_flags.severity ENUM from V026.
 */
const SEVERITY_MAP: Record<string, string> = {
  fake_review:     'HIGH',
  competitor:      'HIGH',
  blackmail:       'CRITICAL',
  wrong_provider:  'MEDIUM',
  abusive_content: 'HIGH',
  other:           'LOW',
};

// ── flagRating ────────────────────────────────────────────────────────────────

export async function flagRating(
  input: FlagRatingInput
): Promise<FlagRatingResult> {
  const { ratingId, callerUserId, reason, evidenceNotes, correlationId } = input;

  const config = await loadSystemConfig();
  // Weight applied to the rating while it is under review — from system_config
  const heldWeight = parseFloat(config['rating_held_weight'] ?? '0.1');

  // ── Fetch rating ──────────────────────────────────────────────────────────
  const rating = await prisma.rating.findUnique({
    where: { id: ratingId },
    select: {
      id: true,
      provider_id: true,
      consumer_id: true,
      weight_type: true,
      weight_value: true,
      moderation_status: true,
    },
  });

  if (!rating) {
    throw new AppError('RATING_NOT_FOUND', 'Rating not found.', 404);
  }

  // ── Authorisation: caller must be the provider on this rating ─────────────
  const providerProfile = await prisma.providerProfile.findFirst({
    where: { user_id: callerUserId },
    select: { id: true },
  });

  if (!providerProfile || providerProfile.id !== rating.provider_id) {
    throw new AppError(
      'NOT_AUTHORIZED',
      'You are not authorised to dispute this rating.',
      403
    );
  }

  // ── Guard: double-flagging ────────────────────────────────────────────────
  if (rating.moderation_status === 'HELD') {
    throw new AppError(
      'ALREADY_HELD',
      'This rating is already under review.',
      409
    );
  }

  if (rating.moderation_status === 'rejected') {
    throw new AppError(
      'ALREADY_REJECTED',
      'This rating has already been resolved and removed.',
      409
    );
  }

  // ── Guard: active flag already exists for this rating ─────────────────────
  const existingFlag = await prisma.trustFlag.findFirst({
    where: {
      ratingId,
      status: { in: ['OPEN', 'UNDER_REVIEW'] as any[] },
    },
    select: { id: true },
  });

  if (existingFlag) {
    throw new AppError(
      'FLAG_ALREADY_OPEN',
      'An active dispute already exists for this rating.',
      409
    );
  }

  const flagType = FLAG_TYPE_MAP[reason] ?? 'OTHER';
  const severity = SEVERITY_MAP[reason] ?? 'LOW';

  // ── Atomic transaction: update rating + insert trust_flag ─────────────────
  const [updatedRating, trustFlag] = await prisma.$transaction([
    // Set status=HELD + reduce weight to held_weight
    prisma.rating.update({
      where: { id: ratingId },
      data: {
        moderation_status: 'HELD' as any,
        weight_value: heldWeight,
      },
      select: {
        id: true,
        moderation_status: true,
        weight_value: true,
      },
    }),

    // Create trust_flag for admin review queue
    prisma.trustFlag.create({
      data: {
        provider_id: rating.provider_id,
        ratingId,
        flag_type: flagType as any,
        severity: severity as any,
        status: 'OPEN' as any,
        evidence: {
          reason,
          evidence_notes: evidenceNotes ?? null,
          reported_by_user_id: callerUserId,
          original_weight_type: rating.weight_type,
          original_weight_value: Number(rating.weight_value),
          held_weight: heldWeight,
          correlation_id: correlationId,
          flagged_at: new Date().toISOString(),
        },
      },
      select: { id: true },
    }),
  ]);

  logger.info({
    service: 'rating',
    action: 'rating_flagged',
    ratingId,
    flagId: trustFlag.id,
    provider_id: rating.provider_id,
    callerUserId,
    reason,
    flagType,
    severity,
    previousWeight: Number(rating.weight_value),
    heldWeight,
    correlationId,
  });

  // ── SQS → trust-score-updates ─────────────────────────────────────────────
  // Lambda recalculates provider trust score with the reduced weight (0.1)
  // immediately — consumer-visible score update without waiting for daily batch.
  if (TRUST_SCORE_UPDATES_QUEUE_URL) {
    const params: SendMessageCommandInput = {
      QueueUrl: TRUST_SCORE_UPDATES_QUEUE_URL,
      MessageBody: JSON.stringify({
        event: 'RATING_FLAGGED',
        provider_id: rating.provider_id,
        rating_id: ratingId,
        flag_id: trustFlag.id,
        held_weight: heldWeight,
        correlation_id: correlationId,
        timestamp: new Date().toISOString(),
      }),
      MessageGroupId: rating.provider_id,
      MessageDeduplicationId: `RATING_FLAGGED-${ratingId}-${Date.now()}`,
      MessageAttributes: {
        correlation_id: {
          DataType: 'String',
          StringValue: correlationId,
        },
        event_type: {
          DataType: 'String',
          StringValue: 'RATING_FLAGGED',
        },
      },
    };

    try {
      const result = await sqsClient.send(new SendMessageCommand(params));
      logger.info('rating.dispute.operation');
    } catch (err) {
      // SQS failure must NOT fail the API — rating is already HELD in DB.
      // Trust score will re-sync via the nightly ratings-refresh Lambda.
      logger.error('rating.dispute.operation');
    }
  } else {
    logger.warn('rating.dispute.operation');
  }

  return {
    flag_id: trustFlag.id,
    rating_id: updatedRating.id,
    moderation_status: 'HELD',
    weight_value: Number(updatedRating.weight_value),
    message:
      'Dispute submitted. The rating is now under review and its weight has been reduced. Our team will review it within 5 business days.',
  };
}

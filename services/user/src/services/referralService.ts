/**
 * Referral Service
 * Validates and applies referral codes.
 * Referral rewards (leads, subscriptions) are granted by the payment service.
 * This service records the referral relationship and notifies payment service via SQS.
 */

import { prisma }     from '@satvaaah/db';
import { sqsPublish } from './sqsHelper';
import { logger }     from '@satvaaah/logger';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '@satvaaah/errors';

interface ApplyCodeInput {
  referredUserId: string;
  code:           string;
  correlationId:  string;
}

interface ApplyCodeResult {
  referrerId: string;
  rewardType: string;
}

/**
 * Apply a referral code for a newly-joined user.
 *
 * Rules:
 * 1. Code must correspond to an existing, active user (referrer).
 * 2. User cannot apply their own referral code.
 * 3. Each user can apply only one referral code (one referral event per referred_id).
 * 4. Code can only be applied within referral_apply_window_days of account creation
 *    (default: 7 days, from system_config).
 * 5. Reward type is resolved from system_config (referral_reward_type).
 */
async function applyCode(input: ApplyCodeInput): Promise<ApplyCodeResult> {
  const { referredUserId, code, correlationId } = input;

  // Load config
  const configs = await prisma.systemConfig.findMany({
    where: { key: { in: ['referral_apply_window_days', 'referral_reward_type'] } },
    select: { key: true, value: true },
  });
  const configMap = Object.fromEntries(configs.map((c) => [c.key, c.value]));
  const windowDays = parseInt(configMap['referral_apply_window_days'] ?? '7', 10);
  const rewardType = configMap['referral_reward_type'] ?? 'bonus_leads';

  // Validate referral window — check referred user's account age
  const referredUser = await prisma.user.findUnique({
    where:  { id: referredUserId },
    select: { id: true, created_at: true, deleted_at: true },
  });
  if (!referredUser || referredUser.deleted_at) {
    throw new NotFoundError('USER_NOT_FOUND', 'User not found');
  }

  const accountAgeMs = Date.now() - new Date(referredUser.created_at).getTime();
  const windowMs     = windowDays * 24 * 60 * 60 * 1000;
  if (accountAgeMs > windowMs) {
    throw new ValidationError(
      'REFERRAL_WINDOW_EXPIRED',
      `Referral codes must be applied within ${windowDays} days of account creation`
    );
  }

  // Check for existing referral application (one per user)
  const existingEvent = await prisma.referralEvent.findFirst({
    where: { referred_id: referredUserId },
  });
  if (existingEvent) {
    throw new ConflictError(
      'REFERRAL_ALREADY_APPLIED',
      'A referral code has already been applied to your account'
    );
  }

  // Resolve referrer by code
  const referrer = await prisma.user.findFirst({
    where:  { referral_code: code, deleted_at: null },
    select: { id: true, referral_code: true },
  });
  if (!referrer) {
    throw new NotFoundError('INVALID_REFERRAL_CODE', 'This referral code is not valid or has expired');
  }

  // Prevent self-referral
  if (referrer.id === referredUserId) {
    throw new ValidationError('SELF_REFERRAL', 'You cannot use your own referral code');
  }

  // Record referral event
  const event = await prisma.referralEvent.create({
    data: {
      referrer_id:   referrer.id,
      referred_id:   referredUserId,
      referral_code: code,
      converted_at:  new Date(),
      reward_type:   rewardType,
      reward_granted: false,   // Payment service grants the reward
    },
    select: { id: true },
  });

  // Notify payment service via SQS to grant reward
  // payment service will mark reward_granted = true after processing
  await sqsPublish({
    queueKey:       'TRUST_SCORE_UPDATES_QUEUE_URL',  // reuse queue; payment lambda handles referral_reward_type
    messageGroupId: referredUserId,
    body: {
      event:          'referral_applied',
      referralEventId: event.id,
      referrer_id:    referrer.id,
      referred_id:    referredUserId,
      referral_code:  code,
      reward_type: rewardType,
      correlation_id: correlationId,
    },
    correlationId,
  });

  logger.info('Referral code applied');

  return { referrer_id: referrer.id, reward_type: rewardType };
}

export const referralService = { applyCode };

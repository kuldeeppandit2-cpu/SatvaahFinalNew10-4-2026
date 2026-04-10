/**
 * User Controller
 * Handles cross-cutting user operations: mode switch, DPDP, referrals.
 */

import { Request, Response } from 'express';
import { prisma }          from '@satvaaah/db';
import { verificationService } from '../services/verificationService';
import { referralService }     from '../services/referralService';
import { sqsPublish }          from '../services/sqsHelper';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '@satvaaah/errors';
import { logger } from '@satvaaah/logger';

const VALID_MODES    = ['consumer', 'provider'] as const;
const VALID_CONSENTS = ['dpdp_processing', 'aadhaar_hash', 'data_sharing_tsaas'] as const;

// ── Mode Switch ───────────────────────────────────────────────────────────────

/**
 * PATCH /api/v1/users/me/mode
 * Body: { mode: 'consumer' | 'provider' }
 */
export async function switchMode(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  const { mode } = req.body;

  if (!mode || !VALID_MODES.includes(mode)) {
    throw new ValidationError('INVALID_MODE', `mode must be one of: ${VALID_MODES.join(', ')}`);
  }

  // If switching to provider, ensure provider_profile exists
  if (mode === 'provider') {
    const profile = await prisma.providerProfile.findUnique({ where: { user_id: userId } });
    if (!profile) {
      throw new ConflictError(
        'NO_PROVIDER_PROFILE',
        'Create a provider profile first via POST /api/v1/providers/register'
      );
    }
  }

  const updated = await prisma.user.update({
    where:  { id: userId },
    data:   { mode },
    select: { id: true, mode: true, phone: true },
  });

  logger.info('User mode switched', { user_id: userId, mode, correlation_id: correlationId });

  res.json({ success: true, data: { user: updated } });
}

// ── DPDP Data Export ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/users/me/data-export
 * DPDP Act 2023 — Right to Access.
 * Aggregates all personal data across user-owned tables.
 * Does NOT include trust_score_history (immutable audit trail, belongs to provider forever).
 */
export async function dataExport(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  logger.info('DPDP data export requested', { user_id: userId, correlationId });

  const [
    user,
    providerProfile,
    consumerProfile,
    consentRecords,
    savedProviders,
    contactEvents,
    referralEvents,
    notificationLog,
  ] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: {
        id:                 true,
        phone:              true,
        phone_verified:     true,
        mode:               true,
        subscription_tier:  true,
        wa_opted_out:       true,
        created_at:         true,
        deleted_at:         true,
        // NEVER include fcm_token (device identifier)
      },
    }),
    prisma.providerProfile.findUnique({
      where:  { user_id: userId },
      select: {
        id:           true,
        listing_type: true,
        tab:          true,
        display_name: true,
        city:         true,
        area:         true,
        created_at:   true,
        // Omit geo_point raw coords — export as human-readable boolean
        is_geo_verified:     true,
        is_aadhaar_verified: true,
        // NEVER include aadhaar_hash
      },
    }),
    prisma.consumerProfile.findUnique({
      where:  { user_id: userId },
      select: {
        id:           true,
        display_name: true,
        city_id:      true,
        trust_score:  true,
        created_at:   true,
      },
    }),
    prisma.consentRecord.findMany({
      where:  { user_id: userId },
      select: {
        consent_type: true,
        granted_at:   true,
        withdrawn_at: true,
      },
    }),
    prisma.savedProvider.findMany({
      where:  { consumer_id: userId },
      select: { provider_id: true, created_at: true },
    }),
    prisma.contactEvent.findMany({
      where:  { consumer_id: userId },
      select: {
        id:                       true,
        provider_id:              true,
        contact_type:             true,
        status:                   true,
        consumer_lead_deducted:   true,
        created_at:               true,
      },
      orderBy: { created_at: 'desc' },
      take: 500,
    }),
    prisma.referralEvent.findMany({
      where:   { referred_id: userId },
      select:  { referral_code: true, converted_at: true, reward_type: true, reward_granted: true },
    }),
    prisma.notificationLog.findMany({
      where:  { user_id: userId },
      select: { channel: true, event_type: true, sent_at: true, delivered_at: true },
      orderBy: { sent_at: 'desc' },
      take: 200,
    }),
  ]);

  if (!user) throw new NotFoundError('USER_NOT_FOUND', 'User not found');

  res.json({
    success: true,
    data: {
      exported_at:       new Date().toISOString(),
      jurisdiction:      'India',
      legal_basis:       'DPDP Act 2023 — Section 11 (Right of Access)',
      user,
      provider_profile:  providerProfile ?? null,
      consumer_profile:  consumerProfile ?? null,
      consent_records:   consentRecords,
      saved_providers:   savedProviders,
      contact_events:    contactEvents,
      referral_events:   referralEvents,
      notification_log:  notificationLog,
    },
  });
}

// ── Account Deletion ──────────────────────────────────────────────────────────

/**
 * DELETE /api/v1/users/me
 * DPDP Act 2023 — Right to Erasure.
 * Step 1: Soft-delete (deleted_at = NOW()).
 * Step 2: Publish SQS anonymisation message → lambdas/anonymisation handles within 72 h.
 */
export async function deleteAccount(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  // Check not already deleted
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, deleted_at: true },
  });

  if (!user) throw new NotFoundError('USER_NOT_FOUND', 'User not found');
  if (user.deleted_at) {
    throw new ConflictError('ALREADY_DELETED', 'Account has already been scheduled for deletion');
  }

  // Soft delete
  await prisma.user.update({
    where: { id: userId },
    data:  { deleted_at: new Date() },
  });

  // Publish anonymisation SQS message
  // lambdas/anonymisation will process within 72 h per DPDP Act
  await sqsPublish({
    queueKey:       'ANONYMISATION_QUEUE_URL',
    messageGroupId: userId,
    body: {
      event:          'user_delete_requested',
      user_id:        userId,
      requested_at:   new Date().toISOString(),
      correlation_id: correlationId,
      deadline_iso:   new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    },
    correlationId,
  });

  logger.info('Account soft-deleted, anonymisation queued', { user_id: userId, correlation_id: correlationId });

  res.json({
    success: true,
    data: {
      deleted: true,
      message:
        'Your account has been scheduled for deletion. All personal data will be anonymised within 72 hours per the DPDP Act 2023.',
    },
  });
}

// ── Consent Withdrawal ────────────────────────────────────────────────────────

/**
 * DELETE /api/v1/users/me/consent/:type
 * DPDP Act 2023 — Right to Withdraw Consent.
 */
export async function withdrawConsent(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;
  const consentType = req.params.type as string;

  if (!VALID_CONSENTS.includes(consentType as any)) {
    throw new ValidationError(
      'INVALID_CONSENT_TYPE',
      `Consent type must be one of: ${VALID_CONSENTS.join(', ')}`
    );
  }

  const consent = await prisma.consentRecord.findFirst({
    where: { user_id: userId, consent_type: consentType },
  });

  if (!consent) {
    throw new NotFoundError('CONSENT_NOT_FOUND', `No active consent record found for type: ${consentType}`);
  }

  if (consent.withdrawn_at) {
    throw new ConflictError('CONSENT_ALREADY_WITHDRAWN', 'This consent has already been withdrawn');
  }

  await prisma.consentRecord.updateMany({
    where: { user_id: userId, consent_type: consentType, withdrawn_at: null },
    data:  { withdrawn_at: new Date() },
  });

  logger.info('Consent withdrawn', { user_id: userId, consent_type: consentType, correlation_id: correlationId });

  res.json({
    success: true,
    data: {
      consent_type:  consentType,
      withdrawn:     true,
      withdrawn_at:  new Date().toISOString(),
      message:       `Consent for '${consentType}' has been withdrawn. This may affect certain features.`,
    },
  });
}

// ── Referral Apply ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/referrals/apply
 * Body: { referral_code }
 */
export async function applyReferral(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  const { referral_code } = req.body;

  if (!referral_code || typeof referral_code !== 'string') {
    throw new ValidationError('MISSING_FIELDS', 'referral_code is required');
  }

  const result = await referralService.applyCode({
    referredUserId: userId,
    code:           referral_code.trim().toUpperCase(),
    correlationId,
  });

  res.json({
    success: true,
    data: {
      applied:       true,
      referrer_id:  result.referrer_id,
      reward_type:   result.reward_type,
      message:       'Referral code applied. Reward will be processed shortly.',
    },
  });
}

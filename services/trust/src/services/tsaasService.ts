/**
 * tsaasService.ts
 *
 * Trust-as-a-Service (TSaaS) B2B logic:
 *   1. Consent check — provider must have active data_sharing_tsaas consent
 *   2. Trust data assembly — curated B2B response (not full internal breakdown)
 *   3. Usage logging — billable event written to tsaas_usage_log
 *   4. Monthly quota increment — calls_used++ in tsaas_api_keys
 *   5. Consent bonus — provider earns tsaas_consent_trust_pts on first consent
 *      (enqueueing SQS message; actual score update done by Lambda)
 */

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { prisma } from '@satvaaah/db';
import { loadSystemConfig } from '@satvaaah/config';
import { logger } from '@satvaaah/logger';
import { calculateTrustBreakdown } from './trustCalculator';

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });
const TRUST_SCORE_UPDATES_QUEUE_URL = process.env.SQS_TRUST_SCORE_UPDATES_URL ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TsaasClientInfo {
  clientId: string;
  monthlyLimit: number;
  callsUsed: number;
}

export interface TsaasTrustResponse {
  providerId: string;
  displayScore: number;
  trustTier: string;
  tierLabel: string;
  tierColor: string;
  verificationScore: number;
  customerVoiceScore: number;
  ratingCount: number;
  hasAadhaarVerified: boolean;
  hasCredentialVerified: boolean;
  hasGeoVerified: boolean;
  calculatedAt: string;
  // Note: individual signal details NOT exposed to B2B clients
}

export interface TsaasTrustResult {
  data?: TsaasTrustResponse;
  consentError?: true;
  notFound?: true;
}

export interface LogTsaasUsageParams {
  clientId: string;
  providerId: string;
  responseCode: number;
  correlationId?: string;
}

// ─── Main Service Function ────────────────────────────────────────────────────
/**
 * Fetch trust data for a provider, enforcing TSaaS consent gate.
 *
 * Gate rule: provider must have an active consent_record of type DATA_SHARING_TSAAS.
 * "Active" means: granted_at IS NOT NULL AND withdrawn_at IS NULL.
 *
 * First-consent bonus: when a new consent is detected (grantedAt within last
 * 10 seconds — freshly created), enqueue SQS to award tsaas_consent_trust_pts.
 * The Lambda:trust-recalculate handles the actual DB update.
 */
export async function getTsaasTrustData(params: {
  providerId: string;
  tsaasClient: TsaasClientInfo;
}): Promise<TsaasTrustResult> {
  const { providerId } = params;

  // ── 1. Fetch provider to get userId ───────────────────────────────────────
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      user_id: true,
      aadhaarVerified: true,
      credentialVerified: true,
      geoVerified: true,
    },
  });

  if (!provider) {
    return { notFound: true };
  }

  // ── 2. Consent gate — DATA_SHARING_TSAAS ──────────────────────────────────
  const consentRecord = await prisma.consentRecord.findFirst({
    where: {
      user_id: provider.user_id,
      consent_type: 'DATA_SHARING_TSAAS',
      withdrawn_at: null,
    },
    select: { id: true, granted_at: true },
  });

  if (!consentRecord) {
    logger.info('tsaas.consent.not_given');
    return { consentError: true };
  }

  // ── 3. First-consent bonus — enqueue trust pts if newly consented ─────────
  await maybeAwardConsentBonus(provider.user_id, providerId, consentRecord.granted_at);

  // ── 4. Calculate trust breakdown ─────────────────────────────────────────
  const breakdown = await calculateTrustBreakdown(providerId);
  if (!breakdown) {
    return { notFound: true };
  }

  // ── 5. Build B2B response — curated, not full internal breakdown ──────────
  const tsaasResponse: TsaasTrustResponse = {
    provider_id: breakdown.provider_id,
    display_score: breakdown.display_score,
    trust_tier: breakdown.trust_tier,
    tierLabel: breakdown.tierLabel,
    tierColor: breakdown.tierColor,
    verification_score: breakdown.verification_score,
    customer_voice_score: breakdown.customer_voice_score,
    rating_count: breakdown.rating_count,
    hasAadhaarVerified: provider.aadhaarVerified ?? false,
    hasCredentialVerified: provider.credentialVerified ?? false,
    hasGeoVerified: provider.geoVerified ?? false,
    calculatedAt: breakdown.calculatedAt,
  };

  return { data: tsaasResponse };
}

// ─── Consent Bonus ────────────────────────────────────────────────────────────
/**
 * If the consent was granted within the last 10 seconds (fresh grant),
 * enqueue an SQS message so Lambda:trust-recalculate can credit
 * tsaas_consent_trust_pts (from system_config) to the provider.
 *
 * This is idempotent at the Lambda level — the Lambda checks if the
 * bonus has already been awarded before crediting.
 */
async function maybeAwardConsentBonus(
  userId: string,
  providerId: string,
  grantedAt: Date,
): Promise<void> {
  const ageSec = (Date.now() - grantedAt.getTime()) / 1000;
  if (ageSec > 10) return; // Not a fresh grant

  try {
    const config = await loadSystemConfig();
    const bonusPts = parseInt(config['tsaas_consent_trust_pts'] ?? '3', 10);

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: TRUST_SCORE_UPDATES_QUEUE_URL,
        MessageBody: JSON.stringify({
          provider_id: providerId,
          user_id: userId,
          trigger: 'tsaas_consent_bonus',
          bonusPts,
          enqueuedAt: new Date().toISOString(),
        }),
        MessageAttributes: {
          trigger: { DataType: 'String', StringValue: 'tsaas_consent_bonus' },
        },
      }),
    );

    logger.info('tsaas.consentBonus.enqueued');
  } catch (err) {
    // Non-blocking — bonus failure must not block the TSaaS response
    logger.error('tsaas.consentBonus.failed');
  }
}

// ─── Usage Logging ────────────────────────────────────────────────────────────
/**
 * Write a billable event to tsaas_usage_log and increment calls_used.
 * Called non-blocking (fire-and-forget) from the controller.
 *
 * Two writes in a single transaction:
 *   1. INSERT into tsaas_usage_log
 *   2. UPDATE tsaas_api_keys SET calls_used = calls_used + 1
 */
export async function logTsaasUsage(params: LogTsaasUsageParams): Promise<void> {
  const { clientId, providerId, responseCode } = params;

  await prisma.$transaction([
    prisma.tsaasUsageLog.create({
      data: {
        clientId,
        provider_id: providerId,
        calledAt: new Date(),
        responseCode,
      },
    }),
    prisma.tsaasApiKey.updateMany({
      where: { client_id: clientId },
      data: { calls_used: { increment: 1 } },
    }),
  ]);

  logger.info('tsaas.usage.logged');
}

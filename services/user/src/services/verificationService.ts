/**
 * Verification Service
 * Aggregates verification status for a provider.
 * Used by controllers and trust service queries.
 *
 * Note: trust_score is NEVER modified here.
 * Verification flags (geo_verified, aadhaar_verified, etc.) are set by their respective services.
 * Trust recalculation is triggered via SQS → Lambda:trust-recalculate.
 */

import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';

export interface VerificationStatus {
  providerId:              string;
  phoneVerified:           boolean;
  isGeoVerified:           boolean;
  isAadhaarVerified:       boolean;
  credentialsCount:        number;
  credentialsVerifiedCount: number;
  verificationScore:       number | null;
  trustTier:               string | null;
}

/**
 * Returns aggregated verification status for a provider.
 * Safe to expose — never includes aadhaar_hash.
 */
async function getVerificationStatus(providerId: string): Promise<VerificationStatus | null> {
  const provider = await prisma.providerProfile.findUnique({
    where:  { id: providerId },
    select: {
      id:               true,
      is_phone_verified: true,
      is_geo_verified: true,
      is_aadhaar_verified: true,
      verifications:      {
        select: { id: true, status: true },
      },
      trust_score_record: {
        select: {
          verification_score: true,
          trust_tier:         true,
        },
      },
    },
  });

  if (!provider) return null;

  const totalCreds    = provider.verifications?.length ?? 0;
  const verifiedCreds = provider.verifications?.filter((c) => c.status === 'verified').length ?? 0;

  return {
    providerId:               provider.id,
    phoneVerified:            provider.is_phone_verified,
    isGeoVerified:            provider.is_geo_verified,
    isAadhaarVerified:        provider.is_aadhaar_verified,
    credentialsCount:         totalCreds,
    credentialsVerifiedCount: verifiedCreds,
    verificationScore:        provider.trust_score_record?.verification_score ?? null,
    trustTier:                provider.trust_score_record?.trust_tier ?? null,
  };
}

/**
 * Mark a credential as verified (called by admin service via internal X-Service-Key).
 * Publishes trust-score-updates SQS message after marking.
 */
async function markCredentialVerified(
  credentialId:  string,
  adminUserId:   string,
  correlationId: string
): Promise<void> {
  const { sqsPublish } = await import('./sqsHelper');

  const cred = await prisma.providerVerification.update({
    where: { id: credentialId },
    data:  { status: 'verified', verified_at: new Date(), verified_by_admin_id: adminUserId },
    select: { id: true, provider_id: true, verification_type: true },
  });

  await sqsPublish({
    queueKey:       'SQS_TRUST_SCORE_UPDATES_URL',
    messageGroupId: cred.provider_id,
    body: {
      event:           'signal_updated',
      provider_id:      cred.provider_id,
      signalName:      'credential_verified',
      signalValue:     true,
      verification_type: cred.verification_type,
      correlation_id:  correlationId,
    },
    correlationId,
  });

  logger.info('Credential marked verified, trust SQS published');
}

export const verificationService = {
  getVerificationStatus,
  markCredentialVerified,
};

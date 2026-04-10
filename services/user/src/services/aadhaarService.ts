/**
 * Aadhaar Service — DigiLocker OAuth2 PKCE integration
 *
 * ════════════════════════════════════════════════════════════════════
 * SECURITY CONTRACT (MASTER_CONTEXT critical rules #1 and #2):
 *
 *   NEVER store Aadhaar number — not in DB, logs, Redis, S3, anywhere.
 *   NEVER store the raw DigiLocker UID.
 *   NEVER store DigiLocker access_token beyond the request lifetime.
 *   NEVER log any PII from DigiLocker responses.
 *
 *   Store ONLY:
 *     bcrypt(digilocker_uid + per_record_salt, cost=12)
 *     — 72-byte irreversible hash. Purpose: duplicate-verification check only.
 * ════════════════════════════════════════════════════════════════════
 */

import crypto    from 'crypto';
import bcrypt    from 'bcryptjs';
import { createClient } from 'redis';
import axios     from 'axios';
import { prisma }     from '@satvaaah/db';
import { sqsPublish } from './sqsHelper';
import { logger }     from '@satvaaah/logger';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  ExternalServiceError,
  DigiLockerError } from '@satvaaah/errors';

const BCRYPT_COST = 12;   // critical rule #7
const STATE_TTL_SECONDS = 600;  // 10 minutes

// Redis client — shared via env REDIS_URL
const redis = createClient({ url: process.env.REDIS_URL });
redis.connect().catch((err) => logger.error('aadhaarService: Redis connect failed', { err }));

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ── Initiate DigiLocker PKCE flow ─────────────────────────────────────────────

async function initiateDigiLockerFlow(
  userId:       string,
  correlationId: string
): Promise<{ redirectUrl: string }> {
  const provider = await prisma.providerProfile.findUnique({ where: { user_id: userId } });
  if (!provider) throw new NotFoundError('PROVIDER_NOT_FOUND', 'Create a provider profile first');

  if (provider.is_aadhaar_verified) {
    throw new ConflictError(
      'AADHAAR_ALREADY_VERIFIED',
      'Identity has already been verified via DigiLocker'
    );
  }

  const codeVerifier    = generateCodeVerifier();
  const codeChallenge   = generateCodeChallenge(codeVerifier);
  const state           = generateState();
  const redisKey        = `digilocker:state:${userId}`;

  // Store code_verifier and state in Redis (TTL = 10 min)
  // NEVER store in DB — session only
  await redis.setEx(
    redisKey,
    STATE_TTL_SECONDS,
    JSON.stringify({ code_verifier: codeVerifier, state, provider_id: provider.id })
  );

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             process.env.DIGILOCKER_CLIENT_ID ?? '',
    redirect_uri:          process.env.DIGILOCKER_REDIRECT_URI ?? '',
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
    scope:                 'openid',
  });

  const redirectUrl = `${process.env.DIGILOCKER_AUTH_URL}?${params.toString()}`;

  logger.info('DigiLocker PKCE flow initiated', {
    user_id: userId,
    provider_id: provider.id,
    // Do NOT log state or code_verifier
    correlationId,
  });

  return { redirectUrl };
}

// ── Handle callback ───────────────────────────────────────────────────────────

async function handleCallback(input: {
  userId:       string;
  auth_code:    string;
  state:        string;
  correlationId: string;
}): Promise<void> {
  const { userId, auth_code, state, correlationId } = input;

  // Retrieve and validate PKCE state from Redis
  const redisKey   = `digilocker:state:${userId}`;
  const raw        = await redis.get(redisKey);

  if (!raw) {
    throw new ValidationError(
      'DIGILOCKER_STATE_EXPIRED',
      'DigiLocker session has expired. Please restart the verification process.'
    );
  }

  const session = JSON.parse(raw) as {
    code_verifier: string;
    state:         string;
    providerId:   string;
  };

  // Validate state — CSRF protection
  if (session.state !== state) {
    logger.warn('DigiLocker state mismatch — possible CSRF', { user_id: userId, correlationId });
    throw new ValidationError('DIGILOCKER_STATE_MISMATCH', 'Invalid verification session');
  }

  // Invalidate Redis key immediately (one-time use)
  await redis.del(redisKey);

  // Exchange auth_code for access_token (server-to-server)
  let digilockerUid: string;
  try {
    const tokenResponse = await axios.post(
      process.env.DIGILOCKER_TOKEN_URL ?? '',
      new URLSearchParams({
        grant_type:    'authorization_code',
        code:          auth_code,
        redirect_uri:  process.env.DIGILOCKER_REDIRECT_URI ?? '',
        client_id:     process.env.DIGILOCKER_CLIENT_ID ?? '',
        client_secret: process.env.DIGILOCKER_CLIENT_SECRET ?? '',
        code_verifier: session.code_verifier,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10_000,
      }
    );

    const accessToken = tokenResponse.data.access_token as string;
    if (!accessToken) throw new DigiLockerError('DigiLocker OAuth did not return an access_token');

    // Fetch DigiLocker user profile to get the immutable sub (digilocker_uid)
    const profileResponse = await axios.get(process.env.DIGILOCKER_PROFILE_URL ?? '', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10_000,
    });

    // DigiLocker sub is the unique immutable identifier
    digilockerUid = profileResponse.data.sub as string;
    if (!digilockerUid) throw new DigiLockerError('DigiLocker profile did not return a sub identifier');

    // access_token is discarded after this point — NEVER persisted

  } catch (err: any) {
    // Log error WITHOUT any DigiLocker response body (could contain PII)
    logger.error('DigiLocker token exchange failed', {
      user_id: userId,
      providerId: session.provider_id,
      errorCode:  err.response?.status,
      correlationId,
      // Do NOT log err.response.data
    });
    throw new ExternalServiceError(
      'DIGILOCKER_EXCHANGE_FAILED',
      'Identity verification failed. Please try again.'
    );
  }

  // ── Hash — the ONLY thing we persist ──────────────────────────────────────
  //
  // perRecordSalt: unique random salt per provider row.
  // Final stored value: bcrypt(digilocker_uid + per_record_salt, cost=12)
  // Purpose: allows checking if two providers verified same identity (duplicate detection)
  //          without ever being able to recover the original UID.
  //
  const perRecordSalt = crypto.randomBytes(16).toString('hex');
  const hashInput     = digilockerUid + perRecordSalt;

  // bcrypt cost=12 (critical rule #7)
  const aadhaarHash = await bcrypt.hash(hashInput, BCRYPT_COST);

  // Overwrite variable immediately — do NOT keep raw UID in scope any longer
  digilockerUid = '';  // explicit memory hint

  // Duplicate verification check:
  // We cannot check bcrypt hashes for equality (they're salted differently per record),
  // so we store per_record_salt alongside the hash.
  // To check duplicate: retrieve all unverified hashes and attempt bcrypt.compare.
  // For production scale, a separate dedup_tokens table with HMAC(UID, server_secret) works better.
  // For Phase 7 MVP, we skip the dedup check (admin team reviews via trust admin panel).

  // Persist hash + salt to provider_verifications (NEVER raw UID or Aadhaar number)
  // ProviderProfile.is_aadhaar_verified is the denormalised flag for fast queries
  const { prisma } = await import('@satvaaah/db');
  await prisma.$transaction(async (tx) => {
    // Upsert provider_verifications row for aadhaar
    await tx.providerVerification.upsert({
      where: {
        // Use a compound unique if it exists, else find and update
        id: (await tx.providerVerification.findFirst({
          where: { provider_id: session.provider_id, verification_type: 'aadhaar' },
          select: { id: true },
        }))?.id ?? '00000000-0000-0000-0000-000000000000',
      },
      create: {
        provider_id:        session.provider_id,
        verification_type:  'aadhaar',
        status:            'verified',
        digilocker_uid_hash: aadhaarHash,
        per_record_salt:     perRecordSalt,
        digilocker_name:     null,
      },
      update: {
        status:            'verified',
        digilocker_uid_hash: aadhaarHash,
        per_record_salt:     perRecordSalt,
      },
    });
    // Update denormalised flag on provider_profiles
    await tx.providerProfile.update({
      where: { id: session.provider_id },
      data:  { is_aadhaar_verified: true },
    });
  });

  // Publish trust-score-updates SQS message
  await sqsPublish({
    queueKey:       'SQS_TRUST_SCORE_UPDATES_URL',
    messageGroupId: session.provider_id,
    body: {
      event:          'signal_updated',
      provider_id:    session.provider_id,
      signal_name:    'aadhaar_verified',
      signal_value:   true,
      correlation_id: correlationId,
    },
    correlationId,
  });

  logger.info('Aadhaar verification completed — only hash stored', {
    user_id: userId,
    provider_id: session.provider_id,
    // hash NOT logged
    correlationId,
  });

  // Return current trust score so mobile can animate the score change
  const trustScore = await prisma.trustScore.findUnique({
    where:  { provider_id: session.provider_id },
    select: { display_score: true, trust_tier: true },
  });

  return {
    newScore:      trustScore?.display_score ?? null,
    previousScore: null,  // score changes async via Lambda — not available immediately
    newTier:       trustScore?.trust_tier ?? null,
    deltaPts:      null,
  };
}

export const aadhaarService = {
  initiateDigiLockerFlow,
  handleCallback,
};

/**
 * Provider routes — /api/v1/providers/*
 */

import { Router } from 'express';
import { requireAuth }   from '@satvaaah/middleware';
import { asyncHandler }  from '@satvaaah/middleware';
import { rateLimiter }   from '@satvaaah/middleware';

import {
  registerProvider,
  getMyProviderProfile,
  updateMyProviderProfile,
  geoVerify,
  getAadhaarRedirectUrl,
  aadhaarCallback,
  uploadCredential,
} from '../controllers/provider.controller';
import { prisma } from '@satvaaah/db';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';
import { mapProviderToApi } from '../services/providerService';

const router = Router();

// ── Tighter rate limits for write / sensitive operations ─────────────────────
const strictLimiter    = rateLimiter({ windowMs: 60_000, max: 10, keyPrefix: 'rl:provider-write' });
const aadhaarLimiter   = rateLimiter({ windowMs: 60_000, max:  5, keyPrefix: 'rl:aadhaar' });
const credLimiter      = rateLimiter({ windowMs: 60_000, max:  5, keyPrefix: 'rl:cred-upload' });

/**
 * POST /api/v1/providers/register
 * Body: { listing_type, tab, category, name, city, area }
 * Creates provider_profile row for authenticated user.
 * JWT required — must already have a users row from auth service.
 */
router.post(
  '/register',
  requireAuth,
  strictLimiter,
  asyncHandler(registerProvider)
);

/**
 * GET /api/v1/providers/me
 * Returns the caller's provider_profile + trust_scores snapshot.
 */
router.get(
  '/me',
  requireAuth,
  asyncHandler(getMyProviderProfile)
);

/**
 * PATCH /api/v1/providers/me
 * Partial update of provider_profile fields.
 * trust_score is NEVER accepted in body — DB trigger owns it.
 */
router.patch(
  '/me',
  requireAuth,
  strictLimiter,
  asyncHandler(updateMyProviderProfile)
);

/**
 * POST /api/v1/providers/me/verify/geo
 * Body: { lat, lng, accuracy }
 * Validates GPS accuracy ≤ 50 m, stores geo_point (ST_MakePoint(lng, lat)),
 * publishes trust-score-updates SQS message (+20 pts signal).
 */
router.post(
  '/me/verify/geo',
  requireAuth,
  strictLimiter,
  asyncHandler(geoVerify)
);

/**
 * GET /api/v1/providers/me/verify/aadhaar
 * Returns { digilocker_redirect_url } — PKCE flow.
 * Stores code_verifier in Redis (TTL 10 min).
 */
router.get(
  '/me/verify/aadhaar',
  requireAuth,
  aadhaarLimiter,
  asyncHandler(getAadhaarRedirectUrl)
);

/**
 * POST /api/v1/providers/me/verify/aadhaar/callback
 * Body: { auth_code, state } OR { code, code_verifier } (mobile PKCE flow)
 * DigiLocker exchanges auth_code → access_token → DigiLocker UID.
 * Stores ONLY bcrypt(digilocker_uid + per_record_salt, 12).
 * NEVER stores Aadhaar number, XML, image, or raw UID.
 */
// Alias for mobile path: /trust/v1/verify/digilocker → same handler
router.post('/trust/v1/verify/digilocker', requireAuth, aadhaarLimiter, asyncHandler(aadhaarCallback));
router.post(
  '/me/verify/aadhaar/callback',
  requireAuth,
  aadhaarLimiter,
  asyncHandler(aadhaarCallback)
);

/**
 * GET /api/v1/providers/me/credentials
 * Returns list of provider's verification records.
 */
router.get(
  '/me/credentials',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.userId;
    const profile = await prisma.providerProfile.findFirst({
      where: { user_id: userId }, select: { id: true },
    });
    if (!profile) throw new AppError('NOT_FOUND', 'Provider profile not found', 404);
    const credentials = await prisma.providerVerification.findMany({
      where: { provider_id: profile.id },
      select: {
        id: true, verification_type: true, status: true,
        credential_name: true, credential_s3_key: true,
        verified_at: true, rejection_reason: true, created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
    res.json({ success: true, data: credentials });
  })
);

/**
 * POST /api/v1/providers/me/credentials/confirm
 * Body: { s3_key, credential_type, file_name }
 * Confirms credential after direct S3 upload — inserts ProviderVerification record.
 */
router.post(
  '/me/credentials/confirm',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId        = (req as any).user.userId;
    const correlationId = req.headers['x-correlation-id'] as string;
    const { s3_key, credential_type, file_name } = req.body;
    if (!s3_key || !credential_type) {
      throw new AppError('VALIDATION_ERROR', 's3_key and credential_type are required', 400);
    }
    const profile = await prisma.providerProfile.findFirst({
      where: { user_id: userId }, select: { id: true },
    });
    if (!profile) throw new AppError('NOT_FOUND', 'Provider profile not found', 404);
    const record = await prisma.providerVerification.create({
      data: {
        provider_id:        profile.id,
        verification_type:  credential_type,
        status:             'pending',
        credential_s3_key:  s3_key,
        credential_name:    file_name ?? null,
        meta:               { uploaded_via: 'mobile_direct_s3' },
      },
      select: { id: true, verification_type: true, status: true, created_at: true },
    });
    logger.info('credential.confirm.created', { correlationId, credentialId: record.id });
    res.status(201).json({ success: true, data: record });
  })
);

/**
 * POST /api/v1/providers/me/credentials
 * Body: { credential_type, file_name, content_type }
 * Returns { upload_url, s3_key } — pre-signed S3 URL (PUT, 10 min TTL).
 * Credential record inserted with status=pending_review.
 */
router.post(
  '/me/credentials',
  requireAuth,
  credLimiter,
  asyncHandler(uploadCredential)
);


// ─── POST /api/v1/providers/:id/claim ────────────────────────────────────────────
// Consumer/provider claims a scraped profile.
// Sets is_claimed=true, links user_id, triggers trust score initialisation.
router.post(
  '/:id/claim',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId      = (req as any).user.userId;
    const scrapedId   = req.params.id;
    const correlationId = req.headers['x-correlation-id'] as string;

    // Verify the target profile is a valid unclaimed scraped record
    const profile = await prisma.providerProfile.findUnique({
      where:  { id: scrapedId },
      select: { id: true, is_claimed: true, user_id: true, is_scrape_record: true },
    });

    if (!profile) throw new AppError('NOT_FOUND', 'Provider profile not found', 404);
    if (profile.is_claimed) throw new AppError('ALREADY_CLAIMED', 'This profile has already been claimed', 409);
    if (!profile.is_scrape_record) throw new AppError('NOT_A_SCRAPED_RECORD', 'Only scraped profiles can be claimed', 400);

    // Ensure this user doesn't already own a provider profile
    const existing = await prisma.providerProfile.findUnique({ where: { user_id: userId } });
    if (existing) throw new AppError('PROFILE_EXISTS', 'You already have a provider profile', 409);

    // Claim: link user_id, set is_claimed, clear is_scrape_record
    const claimed = await prisma.providerProfile.update({
      where: { id: scrapedId },
      data: {
        user_id:         userId,
        is_claimed:      true,
        is_scrape_record: false,
        claimed_at:      new Date(),
      },
    });

    // Publish trust recalculation
    const { sqsPublish } = await import('../services/sqsHelper');
    await sqsPublish({
      queueKey: 'SQS_TRUST_SCORE_UPDATES_URL',
      messageGroupId: claimed.id,
      body: { event: 'profile_claimed', provider_id: claimed.id, correlation_id: correlationId },
      correlationId,
    }).catch(() => {}); // non-fatal

    logger.info('Provider profile claimed');
    res.json({ success: true, data: mapProviderToApi(claimed) });
  })
);

// ─── GET /api/v1/providers/me/availability ────────────────────────────────────
router.get(
  '/me/availability',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user.userId;
    const profile = await prisma.providerProfile.findFirst({
      where: { user_id: userId },
      select: { id: true, availability: true, availability_updated_at: true },
    });
    if (!profile) throw new AppError('NOT_FOUND', 'Provider profile not found', 404);
    res.json({ success: true, data: profile });
  }),
);

// ─── PUT /api/v1/providers/me/availability ────────────────────────────────────
router.put(
  '/me/availability',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { status, mode } = req.body;  // mobile sends 'status', legacy sends 'mode'
    const availabilityValue = status ?? mode;  // accept both
    const userId = (req as any).user.userId;
    const profile = await prisma.providerProfile.findFirst({ where: { user_id: userId }, select: { id: true } });
    if (!profile) throw new AppError('NOT_FOUND', 'Provider profile not found', 404);
    const updated = await prisma.providerProfile.update({
      where: { id: profile.id },
      data: { availability: availabilityValue, availability_updated_at: new Date() },
      select: { availability: true, availability_updated_at: true },
    });
    res.json({ success: true, data: updated });
  }),
);

/**
 * PATCH /api/v1/providers/me/photo
 * Update provider profile photo S3 key after direct S3 upload.
 * Body: { s3Key: string }
 */
router.patch(
  '/me/photo',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId    = (req as any).user.userId;
    const { s3Key } = req.body as { s3Key?: string };
    if (!s3Key || typeof s3Key !== 'string') {
      throw new AppError('VALIDATION_ERROR', 's3Key is required', 400);
    }
    const { prisma } = await import('@satvaaah/db');
    const updated = await prisma.providerProfile.update({
      where: { user_id: userId },
      data:  { profile_photo_s3_key: s3Key, has_profile_photo: true },
      select: { id: true, profile_photo_s3_key: true, has_profile_photo: true },
    });
    res.json({ success: true, data: updated });
  }),
);

export default router;

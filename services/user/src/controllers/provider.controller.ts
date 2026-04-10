/**
 * Provider Controller
 * Thin HTTP layer — delegates all business logic to providerService / aadhaarService / credentialService.
 */

import { Request, Response } from 'express';
import { providerService, mapProviderToApi } from '../services/providerService';
import { aadhaarService }     from '../services/aadhaarService';
import { credentialService }  from '../services/credentialService';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '@satvaaah/errors';
import { logger } from '@satvaaah/logger';

// ── Register ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/providers/register
 */
export async function registerProvider(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  // Mobile sends camelCase payload
  const {
    listingType,
    tab,
    taxonomyNodeId,
    displayName,
    cityId,
    areaName,
    areaLat,
    areaLng,
  } = req.body;

  if (!listingType || !tab || !taxonomyNodeId || !displayName || !cityId || !areaName) {
    throw new ValidationError(
      'MISSING_FIELDS',
      'listingType (or listing_type), tab, category (or taxonomyNodeId), name (or displayName), city (or cityId), and area (or areaName) are required'
    );
  }

  const VALID_LISTING_TYPES = [
    'individual_service',
    'individual_product',
    'expertise',
    'establishment',
    'product_brand',
  ] as const;

  if (!VALID_LISTING_TYPES.includes(listingType)) {
    throw new ValidationError('INVALID_LISTING_TYPE', `listingType must be one of: ${VALID_LISTING_TYPES.join(', ')}`);
  }

  const profile = await providerService.register({
    user_id: userId,
    listingType: listingType as any,
    tab,
    taxonomyNodeId,
    displayName,
    cityId,
    area: areaName,
    correlationId,
  });

  logger.info('Provider registered');

  res.status(201).json({ success: true, data: mapProviderToApi(profile) });
}

// ── Get profile ───────────────────────────────────────────────────────────────

/**
 * GET /api/v1/providers/me
 */
export async function getMyProviderProfile(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;

  const profile = await providerService.getByUserId(userId);
  if (!profile) throw new NotFoundError('PROVIDER_NOT_FOUND', 'No provider profile found for this account');

  res.json({ success: true, data: mapProviderToApi(profile) });
}

// ── Update profile ────────────────────────────────────────────────────────────

/**
 * PATCH /api/v1/providers/me
 */
export async function updateMyProviderProfile(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  // Silently strip trust_score — DB trigger owns it
  const { trustScore: _stripped, ...rawFields } = req.body;

  if (_stripped !== undefined) {
    logger.warn('Attempt to write trust_score via API rejected');
  }

  if (Object.keys(rawFields).length === 0) {
    throw new ValidationError('EMPTY_BODY', 'No updatable fields provided');
  }

  // Map camelCase from mobile → snake_case Prisma field names
  const FIELD_MAP: Record<string, string> = {
    displayName:        'display_name',
    homeVisitAvailable: 'home_visit_available',
    listingType:        'listing_type',
    profilePhotoS3Key:  'profile_photo_s3_key',
    businessName:       'business_name',
    websiteUrl:         'website_url',
    whatsappPhone:      'whatsapp_phone',
  };
  const allowedFields: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rawFields)) {
    allowedFields[FIELD_MAP[key] ?? key] = val;
  }

  const updated = await providerService.update(userId, allowedFields, correlationId);

  res.json({ success: true, data: mapProviderToApi(updated) });
}

// ── Geo Verification ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/providers/me/verify/geo
 * Body: { lat, lng, accuracy }
 * accuracy must be ≤ 50 metres.
 * Stores ST_MakePoint(lng, lat) — longitude FIRST per PostGIS convention.
 */
export async function geoVerify(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  const { lat, lng, accuracy } = req.body;

  if (lat === undefined || lng === undefined || accuracy === undefined) {
    throw new ValidationError('MISSING_FIELDS', 'lat, lng, and accuracy are required');
  }

  const parsedLat      = parseFloat(lat);
  const parsedLng      = parseFloat(lng);
  const parsedAccuracy = parseFloat(accuracy);

  if (isNaN(parsedLat) || isNaN(parsedLng) || isNaN(parsedAccuracy)) {
    throw new ValidationError('INVALID_COORDS', 'lat, lng, and accuracy must be numeric');
  }

  if (parsedAccuracy > 50) {
    throw new ValidationError(
      'GEO_ACCURACY_INSUFFICIENT',
      'GPS accuracy must be within 50 metres. Please verify from a location with better signal.'
    );
  }

  if (parsedLat < -90 || parsedLat > 90) {
    throw new ValidationError('INVALID_LAT', 'Latitude must be between -90 and 90');
  }

  if (parsedLng < -180 || parsedLng > 180) {
    throw new ValidationError('INVALID_LNG', 'Longitude must be between -180 and 180');
  }

  const result = await providerService.verifyGeo({
    user_id: userId,
    lat: parsedLat,
    lng: parsedLng,
    accuracy: parsedAccuracy,
    correlationId,
  });

  logger.info('Geo verification completed');

  res.json({
    success: true,
    data: {
      geo_verified: true,
      message: 'Location verified. Trust score update is in progress.',
      ...result,
    },
  });
}

// ── Aadhaar / DigiLocker ──────────────────────────────────────────────────────

/**
 * GET /api/v1/providers/me/verify/aadhaar
 * Initiates DigiLocker PKCE flow.
 * Returns { digilocker_redirect_url }
 */
export async function getAadhaarRedirectUrl(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  const { redirectUrl } = await aadhaarService.initiateDigiLockerFlow(userId, correlationId);

  res.json({
    success: true,
    data: { digilocker_redirect_url: redirectUrl },
  });
}

/**
 * POST /api/v1/providers/me/verify/aadhaar/callback
 * Body: { auth_code, state }
 *
 * SECURITY CONTRACT:
 *   1. Exchange auth_code for DigiLocker access_token (server-to-server).
 *   2. Fetch DigiLocker profile to extract digilocker_uid.
 *   3. Store ONLY bcrypt(digilocker_uid + per_record_salt, cost=12).
 *   4. NEVER log or store Aadhaar number, XML, image, or raw UID.
 *   5. Check for existing hash to prevent duplicate verifications.
 *   6. Publish trust-score-updates SQS message.
 */
export async function aadhaarCallback(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  // Accept both: code/code_verifier (mobile) and auth_code/state (legacy)
  const auth_code = req.body.auth_code ?? req.body.code;
  const state     = req.body.state ?? req.body.code_verifier ?? 'mobile';

  if (!auth_code) {
    throw new ValidationError('MISSING_FIELDS', 'auth_code (or code) is required');
  }

  const result = await aadhaarService.handleCallback({ userId, auth_code, state, correlationId });

  logger.info('Aadhaar verification completed');

  res.json({
    success: true,
    data: {
      aadhaar_verified: true,
      message:          'Identity verified via DigiLocker. Trust score update is in progress.',
      // Fields mobile AadhaarVerifyScreen reads for the score animation
      new_score:        result?.newScore     ?? null,
      previous_score:   result?.previousScore ?? null,
      new_tier:         result?.newTier      ?? null,
      delta_pts:        result?.deltaPts     ?? null,
    },
  });
}

// ── Credentials ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/providers/me/credentials
 * Body: { credential_type, file_name, content_type }
 * Returns pre-signed S3 PUT URL valid for 10 minutes.
 */
export async function uploadCredential(req: Request, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const correlationId = req.headers['x-correlation-id'] as string;

  const { credential_type, file_name, content_type } = req.body;

  if (!credential_type || !file_name || !content_type) {
    throw new ValidationError(
      'MISSING_FIELDS',
      'credential_type, file_name, and content_type are required'
    );
  }

  const ALLOWED_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  if (!ALLOWED_CONTENT_TYPES.includes(content_type)) {
    throw new ValidationError(
      'INVALID_CONTENT_TYPE',
      'Allowed types: JPEG, PNG, WebP, PDF'
    );
  }

  const result = await credentialService.generateUploadUrl({
    userId,
    credentialType: credential_type,
    fileName:       file_name,
    contentType:    content_type,
    correlationId,
  });

  res.status(201).json({
    success: true,
    data: {
      upload_url: result.uploadUrl,
      s3_key: result.s3_key,
      expires_in_seconds: result.expiresIn,
    },
  });
}

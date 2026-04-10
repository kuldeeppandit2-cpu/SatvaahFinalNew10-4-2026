/**
 * Provider Service
 * Core business logic for provider_profiles.
 *
 * CRITICAL:
 *   - trust_score is NEVER written here — DB trigger + SQS handles it
 *   - ST_MakePoint(lng, lat) — longitude FIRST per PostGIS convention
 */

import { prisma }      from '@satvaaah/db';
import { sqsPublish }  from './sqsHelper';
import { logger }      from '@satvaaah/logger';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@satvaaah/errors';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RegisterInput {
  userId:          string;
  listingType:     string;
  tab:             string;
  taxonomyNodeId:  string;  // UUID of taxonomy_node — server resolves name+tab
  displayName:     string;  // provider's display name
  cityId:          string;  // UUID of city — server resolves name
  areaName:        string;  // free text area / neighbourhood
  areaLat?:        number;  // optional — for future geo pre-fill
  areaLng?:        number;  // optional
  correlationId:   string;
}

interface GeoVerifyInput {
  userId:       string;
  lat:          number;
  lng:          number;
  accuracy:     number;
  correlationId: string;
}

// ── Register ──────────────────────────────────────────────────────────────────

async function register(input: RegisterInput) {
  const { user_id: userId, listingType, tab, taxonomyNodeId, displayName, cityId, areaName, correlationId } = input;

  // Validate city exists by UUID
  const cityRow = await prisma.city.findUnique({
    where:  { id: cityId },
    select: { id: true, name: true },
  });
  if (!cityRow) throw new ValidationError('INVALID_CITY', `City '${cityId}' is not a supported launch city`);

  // Validate area belongs to city (or create/find best match)
  const areaRow = await prisma.area.findFirst({
    where:  { city_id: cityRow.id, name: { contains: areaName, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!areaRow) throw new ValidationError('INVALID_AREA', `Area '${areaName}' not found in ${cityRow.name}`);

  // Idempotency — one profile per user
  const existing = await prisma.providerProfile.findUnique({ where: { user_id: userId } });
  if (existing) {
    throw new ConflictError(
      'PROVIDER_PROFILE_EXISTS',
      'A provider profile already exists for this account. Use PATCH /api/v1/providers/me to update.'
    );
  }

  // Validate taxonomy node by UUID
  const taxNode = await prisma.taxonomyNode.findUnique({
    where:  { id: taxonomyNodeId },
    select: { id: true, display_name: true, tab: true, verification_required: true },
  });
  if (!taxNode) {
    throw new ValidationError('INVALID_CATEGORY', `Taxonomy node '${taxonomyNodeId}' not found`);
  }
  if (taxNode.tab !== tab) {
    throw new ValidationError('TAB_MISMATCH', `Taxonomy node '${taxonomyNodeId}' does not belong to tab '${tab}'`);
  }

  // Create profile — trust_score defaults to 0, DB trigger will set it to Basic (20) on OTP verify
  const profile = await prisma.providerProfile.create({
    data: {
      user_id: userId,
      listing_type:      listingType as any,
      tab:              tab as any,
      taxonomy_node_id:   taxNode.id,
      display_name:      displayName.trim(),
      city_id:           cityRow.id,
      area_id:           areaRow.id,
      is_claimed:          true,
      is_scrape_record:    false,
      is_geo_verified: false,
      is_aadhaar_verified: false,
      is_phone_verified:   true,  // Users row already has phone_verified from auth service
    },
    select: {
      id:               true,
      listing_type:     true,
      tab:              true,
      display_name:     true,
      is_geo_verified:  true,
      is_aadhaar_verified: true,
      is_phone_verified: true,
      created_at:       true,
      city:             { select: { id: true, name: true } },
      area:             { select: { id: true, name: true } },
      taxonomy_node:    { select: { id: true, display_name: true } },
    },
  });

  logger.info('Provider profile created');

  return profile;
}

// ── Get by user ID ────────────────────────────────────────────────────────────

async function getByUserId(userId: string) {
  return prisma.providerProfile.findUnique({
    where:  { user_id: userId },
    select: {
      id:               true,
      listing_type:     true,
      tab:              true,
      display_name:     true,
      bio:              true,
      phone:            true,
      is_geo_verified: true,
      is_aadhaar_verified: true,
      is_phone_verified: true,
      home_visit_available: true,
      is_claimed:       true,
      created_at:       true,
      updated_at:       true,
      city:             { select: { id: true, name: true } },
      area:             { select: { id: true, name: true } },
      taxonomy_node:   { select: { id: true, display_name: true, l1: true, l2: true } },
      trust_score_record: {
        select: {
          display_score:          true,
          trust_tier:             true,
          verification_score:    true,
          customer_voice_score:  true,
          customer_voice_weight: true,
        },
      },
      verifications:      {
        select: {
          id:              true,
          verification_type: true,
          status:          true,
          created_at:      true,
        },
      },
    },
  });
}

// ── mapToApiShape ─────────────────────────────────────────────────────────────
// Converts raw Prisma result → mobile-facing API shape (camelCase, flattened)
export function mapProviderToApi(p: any) {
  if (!p) return null;
  return {
    id:                 p.id,
    userId:             p.user_id,
    listingType:        p.listing_type,
    tab:                p.tab,
    displayName:        p.display_name,
    bio:                p.bio ?? null,
    phone:              p.phone ?? null,
    cityId:             p.city?.id ?? p.city_id,
    cityName:           p.city?.name ?? null,
    areaName:           p.area?.name ?? null,
    trustScore:         p.trust_score_record?.display_score ?? p.trust_score ?? 0,
    trustTier:          p.trust_score_record?.trust_tier ?? 'unverified',
    isClaimed:          p.is_claimed ?? false,
    is_scrape_record:   p.is_scrape_record ?? false,
    geo_verified:       p.is_geo_verified ?? false,
    is_aadhaar_verified: p.is_aadhaar_verified ?? false,
    is_phone_verified:  p.is_phone_verified ?? false,
    photo_url:          p.profile_photo_s3_key ?? null,
    taxonomy_node_id:   p.taxonomy_node?.id ?? p.taxonomy_node_id ?? null,
    category_name:      p.taxonomy_node?.display_name ?? null,
    home_visit_available: p.home_visit_available ?? false,
    created_at:         p.created_at,
    updated_at:         p.updated_at,
  };
}

// ── Update profile ────────────────────────────────────────────────────────────

async function update(userId: string, fields: Record<string, unknown>, correlationId: string) {
  // Guard against fields that must not be written here
  const FORBIDDEN = ['trustScore', 'trustTier', 'userId', 'id', 'isAadhaarVerified'];
  for (const f of FORBIDDEN) {
    if (f in fields) {
      delete fields[f];
      logger.warn(`Stripped forbidden field '${f}' from provider update`, { user_id: userId, correlationId });
    }
  }

  const profile = await prisma.providerProfile.findUnique({ where: { user_id: userId } });
  if (!profile) throw new NotFoundError('PROVIDER_NOT_FOUND', 'No provider profile found');

  const updated = await prisma.providerProfile.update({
    where:  { user_id: userId },
    data:   { ...fields, updated_at: new Date() },
    select: {
      id:           true,
      display_name: true,
      bio:          true,
      phone:        true,
      home_visit_available: true,
      updated_at:   true,
    },
  });

  logger.info('Provider profile updated');

  return updated;
}

// ── Geo Verification ──────────────────────────────────────────────────────────

/**
 * Stores geo_point using ST_MakePoint(lng, lat) — longitude FIRST.
 * Marks is_geo_verified = true.
 * Publishes trust-score-updates SQS message with signal=geo_verified (+20 pts).
 * trust_score itself is NEVER written here — SQS → Lambda → DB trigger.
 */
async function verifyGeo(input: GeoVerifyInput) {
  const { user_id: userId, lat, lng, accuracy, correlationId } = input;

  const profile = await prisma.providerProfile.findUnique({ where: { user_id: userId } });
  if (!profile) throw new NotFoundError('PROVIDER_NOT_FOUND', 'No provider profile found');

  if (profile.is_geo_verified) {
    throw new ConflictError('GEO_ALREADY_VERIFIED', 'Location has already been verified');
  }

  // PostGIS — longitude FIRST per ST_MakePoint(lng, lat) convention
  await prisma.$executeRaw`
    UPDATE provider_profiles
    SET
      geo_point    = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326),
      is_geo_verified = true,
      updated_at   = NOW()
    WHERE user_id = ${userId}
  `;

  // Publish SQS trust-score-updates — Lambda:trust-recalculate processes asynchronously
  await sqsPublish({
    queueKey:       'SQS_TRUST_SCORE_UPDATES_URL',
    messageGroupId: profile.id,
    body: {
      event:          'signal_updated',
      provider_id:    profile.id,
      signalName:    'geo_verified',
      signalValue:   true,
      correlationId,
    },
    correlationId,
  });

  logger.info('Geo verification stored, trust SQS published');

  return { provider_id: profile.id };
}

export const providerService = {
  register,
  getByUserId,
  update,
  verifyGeo,
};

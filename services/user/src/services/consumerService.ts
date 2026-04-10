/**
 * Consumer Service
 * Core business logic for consumer_profiles and saved_providers.
 *
 * trust_score for consumers defaults to 75 (V005 migration default).
 * consumer trust is handled by rating service — not written here.
 */

import { prisma }     from '@satvaaah/db';
import { logger }     from '@satvaaah/logger';
import { ConflictError, NotFoundError } from '@satvaaah/errors';

// ── Get by user ID ────────────────────────────────────────────────────────────

async function getByUserId(userId: string) {
  const profile = await prisma.consumerProfile.findUnique({
    where:  { user_id: userId },
    select: {
      id:           true,
      display_name: true,
      avatar_s3_key: true,
      trust_score:  true,
      city_id:      true,
      created_at:   true,
      city:         { select: { id: true, name: true } },
    },
  });

  if (!profile) return null;

  // Attach current lead usage snapshot
  const leadUsage = await prisma.consumerLeadUsage.findFirst({
    where: {
      consumer_id: profile.id,
      period_end:  { gte: new Date() },
    },
    select: {
      leads_allocated: true,
      leads_used:    true,
      period_start:  true,
      period_end:    true,
    },
    orderBy: { period_start: 'desc' },
  });

  return { ...profile, lead_usage: leadUsage ?? null };
}

// ── Upsert profile ────────────────────────────────────────────────────────────

async function upsertProfile(input: {
  userId:       string;
  displayName: string;
  cityId:      string;
  avatarS3Key?: string;
  correlationId: string;
}): Promise<{ profile: any; created: boolean }> {
  const { userId, displayName, cityId, avatarS3Key, correlationId } = input;

  // Validate city
  const city = await prisma.city.findUnique({ where: { id: cityId }, select: { id: true } });
  if (!city) throw new NotFoundError('INVALID_CITY', `City ${cityId} not found`);

  const existing = await prisma.consumerProfile.findUnique({ where: { user_id: userId } });

  if (existing) {
    // Update
    const updated = await prisma.consumerProfile.update({
      where: { user_id: userId },
      data:  {
        display_name: displayName,
        city_id: cityId,
        ...(avatarS3Key ? { avatar_s3_key: avatarS3Key } : {}),
        updated_at: new Date(),
      },
      select: {
        id: true, display_name: true, trust_score: true, city_id: true, created_at: true,
        city: { select: { id: true, name: true } },
      },
    });

    logger.info('Consumer profile updated');
    return { profile: updated, created: false };
  }

  // Create — trust_score defaults to 75 per V005 migration
  const created = await prisma.consumerProfile.create({
    data: {
      user_id:      userId,
      display_name: displayName,
      city_id:      cityId,
      ...(avatarS3Key ? { avatar_s3_key: avatarS3Key } : {}),
    },
    select: {
      id: true, display_name: true, trust_score: true, city_id: true, created_at: true,
      city: { select: { id: true, name: true } },
    },
  });

  logger.info('Consumer profile created');
  return { profile: created, created: true };
}

// ── Saved Providers ───────────────────────────────────────────────────────────

async function getSavedProviders(userId: string) {
  const consumer = await prisma.consumerProfile.findUnique({
    where:  { user_id: userId },
    select: { id: true },
  });
  if (!consumer) return [];

  const rows = await prisma.savedProvider.findMany({
    where:  { consumer_id: consumer.id },
    select: {
      provider_id: true,
      created_at:  true,
      provider: {
        select: {
          id:                   true,
          display_name:         true,
          listing_type:         true,
          tab:                  true,
          profile_photo_s3_key: true,
          trust_score_record:   { select: { display_score: true, trust_tier: true } },
          taxonomy_node:        { select: { display_name: true } },
          city:                 { select: { name: true } },
          area:                 { select: { name: true } },
        },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  return rows;
}

async function saveProvider(input: {
  consumerId:   string;
  providerId:   string;
  correlationId: string;
}): Promise<{ alreadySaved: boolean }> {
  const { consumerId, providerId, correlationId } = input;

  // Validate provider exists
  const provider = await prisma.providerProfile.findUnique({ where: { id: providerId } });
  if (!provider) throw new NotFoundError('PROVIDER_NOT_FOUND', `Provider ${providerId} not found`);

  // Idempotent upsert — composite PK (consumer_id + provider_id) from V016
  const existing = await prisma.savedProvider.findUnique({
    where: { consumerId_providerId: { consumer_id: consumerId, provider_id: providerId } },
  });

  if (existing) {
    return { alreadySaved: true };
  }

  await prisma.savedProvider.create({
    data: { consumer_id: consumerId, provider_id: providerId },
  });

  logger.info('Provider saved');
  return { alreadySaved: false };
}

async function unsaveProvider(input: {
  consumerId:   string;
  providerId:   string;
  correlationId: string;
}): Promise<void> {
  const { consumerId, providerId, correlationId } = input;

  const deleted = await prisma.savedProvider.deleteMany({
    where: { consumer_id: consumerId, provider_id: providerId },
  });

  if (deleted.count === 0) {
    throw new NotFoundError('SAVED_PROVIDER_NOT_FOUND', 'This provider is not in your saved list');
  }

  logger.info('Provider unsaved');
}

export const consumerService = {
  getByUserId,
  upsertProfile,
  getSavedProviders,
  saveProvider,
  unsaveProvider,
};
